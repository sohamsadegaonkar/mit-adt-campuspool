'use strict';
const {OtpError,normalize}=require('./pg-store');
const {handlePgAuth}=require('./auth-routes');
const defaultMail=require('./email-provider');
const defaultSms=require('../sms-provider');

const COOKIE='__Host-cp_registration';
const PREFIX='/api/auth/';
const existing=new Set(['send-email-otp','verify-email-otp','send-phone-otp','verify-phone-otp','register']);
const own=new Set(['registration-start','registration-status','registration-contacts','registration-recovery-request','registration-recovery-verify']);
const isResumeError=e=>e instanceof OtpError&&e.code==='REGISTRATION_UNAVAILABLE';
function validateOrigin(origin){
  let parsed;
  try{parsed=new URL(origin);}catch{throw Error('REGISTRATION_ORIGIN must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)
    throw Error('REGISTRATION_ORIGIN must be an exact HTTPS origin');
  return origin;
}
function readCookie(header){
  if(typeof header!=='string'||header.length>8192)return null;
  const entries=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
  if(entries.length!==1)return null;
  const token=entries[0].slice(COOKIE.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
function resumeCookie(token,expiresAt){
  if(token&&!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Invalid resume token');
  const maxAge=token?Math.max(0,Math.min(604800,Math.floor((new Date(expiresAt).getTime()-Date.now())/1000))):0;
  if(!Number.isFinite(maxAge))throw Error('Invalid registration expiry');
  return COOKIE+'='+(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
}
function appendCookie(res,value){
  const previous=res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie',previous?[].concat(previous,value):value);
}
function permitted(headers,origin){
  return headers.origin===origin&&headers['x-registration-request']==='1'&&
    typeof headers['content-type']==='string'&&/^application\/json(?:\s*;|$)/i.test(headers['content-type'])&&
    (!headers['sec-fetch-site']||headers['sec-fetch-site']==='same-origin');
}
const generic={success:true,message:'If recovery is possible, a verification code has been requested.'};
function createRegistrationHttp({drafts,store,identity,origin,mailProvider=defaultMail,smsDeliveryProvider=defaultSms}){
  validateOrigin(origin);
  if(!drafts||!store||!identity)throw Error('Registration requires PostgreSQL identity and OTP');
  return async function registrationHttp(ctx){
    const {pathname,method,req,res,parseBody,sendJson,getClientIp,setPostgresCookie}=ctx;
    if(pathname===PREFIX+'registration-config'&&method==='GET'){
      sendJson(200,{enabled:true});return true;
    }
    if(!pathname.startsWith(PREFIX))return false;
    const route=pathname.slice(PREFIX.length);
    if(!own.has(route)&&!existing.has(route))return false;
    if(method!=='POST')return false;
    if(!permitted(req.headers,origin)){
      sendJson(403,{success:false,error:'REGISTRATION_ORIGIN_DENIED',message:'Registration request rejected.'});return true;
    }
    const resume=readCookie(req.headers.cookie);
    async function current(){
      if(!resume)return null;
      try{return await drafts.status(resume);}catch(e){if(isResumeError(e))return null;throw e;}
    }
    async function budget(label,key,limit,seconds){
      await store.tx(client=>store.rate(client,label,key,limit,seconds));
    }
    try{
      if(route==='registration-status'){
        const state=await current();
        if(!state&&resume)appendCookie(res,resumeCookie(null));
        sendJson(200,{success:true,registration:state});return true;
      }
      if(route==='registration-start'){
        const state=await current();
        if(state){sendJson(200,{success:true,registration:state});return true;}
        const body=await parseBody();
        const email=normalize('email',body.email),phone=normalize('sms',body.phone);
        // Separate committed abuse bucket; rejected creates do not roll it back.
        await budget('registration-start-ip',getClientIp()||'unknown',5,600);
        const created=await drafts.start({email,phone});
        appendCookie(res,resumeCookie(created.resumeToken,created.state.expiresAt));
        sendJson(201,{success:true,registration:created.state});return true;
      }
      if(route==='registration-contacts'){
        if(!resume)throw new OtpError('REGISTRATION_UNAVAILABLE',403);
        await budget('registration-edit',resume,10,600);
        const body=await parseBody();
        sendJson(200,{success:true,registration:await drafts.changeContacts(resume,body)});return true;
      }
      if(route==='registration-recovery-request'||route==='registration-recovery-verify'){
        if(await current())throw new OtpError('REGISTRATION_UNAVAILABLE',403);
        const body=await parseBody(),channel=body.channel,target=normalize(channel,body.target);
        const purpose=channel==='email'?'signup_recovery_email':'signup_recovery_phone';
        const ip=getClientIp();
        if(route==='registration-recovery-request'){
          await budget('registration-recovery-ip',ip||'unknown',5,600);
          // Keep the public response and challenge/rate-limit behavior identical for all contacts.
          if(channel==='email'?!mailProvider.configured():!smsDeliveryProvider.isConfigured())
            throw new OtpError('DELIVERY_UNAVAILABLE',503);
          try{
            await store.issue({purpose,channel,target,ip,recovery:drafts,
              deliver:async({target,code})=>{
                // No real delivery to unverified/unknown/ambiguous contacts.
                // A synthetic undelivered challenge keeps shared limits and cooldown uniform.
                if(!await drafts.canRecoverContact(channel,target))return {accepted:true};
                return channel==='email'?mailProvider.sendOtpEmail(target,code):smsDeliveryProvider.sendOtpSms(target,code);
              }});
          }catch(e){
            if(!(e instanceof OtpError)||!['RESEND_COOLDOWN','RATE_LIMITED','DELIVERY_UNAVAILABLE','DELIVERY_EXPIRED'].includes(e.code))throw e;
            // Generic response does not distinguish provider acceptance from rejection.
          }
          sendJson(200,generic);return true;
        }
        const out=await store.verify({purpose,channel,target,ip,code:body.otp,recovery:drafts});
        if(!out.ok||!out.recovery)throw new OtpError('REGISTRATION_UNAVAILABLE',403);
        appendCookie(res,resumeCookie(out.recovery.resumeToken,out.recovery.state.expiresAt));
        sendJson(200,{success:true,registration:out.recovery.state});return true;
      }
      return await handlePgAuth({...ctx,store,identity,mailProvider,smsDeliveryProvider,
        registrationDrafts:drafts,getRegistrationResumeToken:()=>resume,
        setPostgresCookie:token=>{
          const ok=setPostgresCookie(token);
          if(ok&&route==='register')appendCookie(res,resumeCookie(null));
          return ok;
        }});
    }catch(e){
      if(!(e instanceof OtpError))throw e;
      const recovering=route==='registration-recovery-verify';
      const status=recovering&&e.status!==429?403:e.status;
      sendJson(status,{success:false,error:recovering&&status===403?'REGISTRATION_UNAVAILABLE':e.code,
        message:status===429?'Too many requests. Try again later.':status===503?'Verification delivery is unavailable. Try again later.':'Registration could not be completed.'});
      return true;
    }
  };
}
module.exports={createRegistrationHttp,readCookie,resumeCookie,permitted,validateOrigin};
