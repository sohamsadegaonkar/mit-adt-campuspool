'use strict';
// Drop-in PostgreSQL-backed auth workflow for existing CampusPool routes.
// Existing Rides/profile storage remains SQLite until a separate migration.
const {OtpError,normalize} = require('./pg-store');
const emailProvider=require('./email-provider');
const smsProvider=require('../sms-provider');

const paths=new Set([
  '/api/auth/login-request','/api/auth/send-email-otp',
  '/api/auth/verify-email-otp','/api/auth/send-phone-otp',
  '/api/auth/verify-phone-otp','/api/auth/register'
]);
function validateText(x,max) {
  return typeof x==='string' && x.trim().length>0 && x.length<=max &&
    !/[<>\u0000-\u001f]/.test(x);
}
function errorPayload(error) {
  return {success:false,error:error.code,message:
    error.code==='RATE_LIMITED'||error.code==='RESEND_COOLDOWN'
      ? 'Too many requests. Try again later.'
      : error.code==='DELIVERY_UNAVAILABLE'?'Verification delivery is unavailable. Try again later.'
      : error.code==='INVALID_OTP'?'Incorrect verification code.'
      : error.code==='VERIFICATION_REQUIRED'?'Verify both email and phone again.'
      : error.code==='OTP_LOCKED'?'Too many attempts. Request another code.'
      : error.code==='OTP_EXPIRED'?'Code expired. Request another code.'
      : 'Verification could not be completed.',
    ...(error.retryAfter?{retryAfter:error.retryAfter}:{})
  };
}
function resultOrError(out,sendJson) {
  if(out.ok)return false;
  const status=out.error==='OTP_LOCKED'?403:400;
  sendJson(status,{success:false,error:out.error,attemptsRemaining:out.attemptsRemaining,
    message:out.error==='OTP_LOCKED'?'Too many attempts. Request a new code.':'Incorrect verification code.'});
  return true;
}

async function handlePgAuth({pathname,method,parseBody,sendJson,db,setSessionCookie,getClientIp,store,
  mailProvider=emailProvider,smsDeliveryProvider=smsProvider,identity=null,setPostgresCookie=null}) {
  if(method!=='POST'||!paths.has(pathname))return false;
  try {
    if(pathname==='/api/auth/login-request') {
      const body=await parseBody();
      if(typeof body.identifier!=='string'||body.identifier.trim().length>254) {
        throw new OtpError('INVALID_IDENTIFIER');
      }
      const user=identity?await identity.getProfileByIdentifier(body.identifier.trim()):db.getProfileByIdentifier(body.identifier.trim());
      if(!user||!user.isVerified) {
        sendJson(404,{success:false,error:'USER_NOT_FOUND',message:'No verified campus account found.'});
        return true;
      }
      if(!mailProvider.configured())throw new OtpError('EMAIL_PROVIDER_NOT_CONFIGURED',503);
      const issued=await store.issue({
        purpose:'login',channel:'email',target:user.email,ip:getClientIp(),
        deliver:({target,code})=>mailProvider.sendOtpEmail(target,code)
      });
      sendJson(200,{success:true,email:user.email,expiresInSeconds:issued.expiresInSeconds,
        deliveredToInbox:true,message:'Verification code submitted to email provider.'});
      return true;
    }
    if(pathname==='/api/auth/send-email-otp') {
      const body=await parseBody(),email=normalize('email',body.email);
      if(!validateText(body.name,100)||typeof body.phone!=='string') throw new OtpError('INVALID_PROFILE');
      const phone=normalize('sms',body.phone);
      const check=identity?await identity.checkUniqueness(body.name.trim(),email,phone):db.checkUniqueness(body.name.trim(),email,phone);
      if(!check.unique) {
        sendJson(409,{success:false,error:'NOT_UNIQUE',message:'These details could not be registered.'});
        return true;
      }
      if(!mailProvider.configured())throw new OtpError('EMAIL_PROVIDER_NOT_CONFIGURED',503);
      const result=await store.issue({
        purpose:'signup_email',channel:'email',target:email,ip:getClientIp(),
        deliver:({target,code})=>mailProvider.sendOtpEmail(target,code)
      });
      sendJson(200,{success:true,expiresInSeconds:result.expiresInSeconds,deliveredToInbox:true,
        message:'Verification code submitted to email provider.'});
      return true;
    }
    if(pathname==='/api/auth/verify-email-otp') {
      const body=await parseBody(),email=normalize('email',body.email);
      const user=identity?await identity.getProfileByEmail(email):db.getProfileByEmail(email);
      const out=await store.verify({
        purpose:user?'login':'signup_email',channel:'email',
        target:email,code:body.otp,ip:getClientIp()
      });
      if(resultOrError(out,sendJson))return true;
      if(user) {
        if(identity){
          const session=await identity.sessionForEmail(user.email);
          if(!session||!setPostgresCookie(session))throw new OtpError('SESSION_FAILED',500);
        }else if(!setSessionCookie(user.email))throw new OtpError('SESSION_FAILED',500);
        sendJson(200,{success:true,isLogin:true,user,
          message:'Campus email verified. You are signed in.'});
      } else {
        sendJson(200,{success:true,isLogin:false,emailToken:out.proof,
          message:'Campus email verified.'});
      }
      return true;
    }
    if(pathname==='/api/auth/send-phone-otp') {
      const body=await parseBody(),phone=normalize('sms',body.phone);
      const exists=identity?await identity.phoneExists(phone):db.getProfiles().some(x=>{
        const digits=String(x.phone||'').replace(/\D/g,'').slice(-10);
        return digits===phone;
      });
      if(exists) {
        sendJson(409,{success:false,error:'PHONE_ALREADY_REGISTERED',
          message:'This phone number is already registered.'});
        return true;
      }
      if(!smsDeliveryProvider.isConfigured())throw new OtpError('SMS_PROVIDER_NOT_CONFIGURED',503);
      const issued=await store.issue({
        purpose:'signup_phone',channel:'sms',target:phone,ip:getClientIp(),
        deliver:({target,code})=>smsDeliveryProvider.sendOtpSms(target,code)
      });
      sendJson(200,{success:true,expiresInSeconds:issued.expiresInSeconds,
        message:'SMS code accepted by provider for delivery.'});
      return true;
    }
    if(pathname==='/api/auth/verify-phone-otp') {
      const body=await parseBody(),phone=normalize('sms',body.phone);
      const out=await store.verify({
        purpose:'signup_phone',channel:'sms',target:phone,code:body.otp,ip:getClientIp()
      });
      if(resultOrError(out,sendJson))return true;
      sendJson(200,{success:true,phoneToken:out.proof,message:'Phone number verified.'});
      return true;
    }
    if(pathname==='/api/auth/register') {
      const body=await parseBody();
      const email=normalize('email',body.email),phone=normalize('sms',body.phone);
      if(!validateText(body.name,100)||!validateText(body.dept,100)) throw new OtpError('INVALID_PROFILE');
      const check=identity?await identity.checkUniqueness(body.name.trim(),email,phone):db.checkUniqueness(body.name.trim(),email,phone);
      if(!check.unique) {
        sendJson(409,{success:false,error:'NOT_UNIQUE',message:'An account already exists with these details.'});
        return true;
      }
      if(identity){
        const result=await identity.register({
          name:body.name,email,phone,dept:body.dept,
          emailProof:body.emailToken,phoneProof:body.phoneToken
        });
        if(!setPostgresCookie(result.token))throw new OtpError('SESSION_FAILED',500);
        sendJson(201,{success:true,user:result.user,message:'Campus account created and verified.'});
        return true;
      }
      // Compatibility only while legacy SQLite identity remains enabled.
      await store.consumeRegistration({
        email,phone,emailProof:body.emailToken,phoneProof:body.phoneToken
      });
      let profile;
      try{
        profile=db.createProfile({name:body.name.trim(),email,phone,dept:body.dept.trim()});
      }catch(_){
        sendJson(409,{success:false,error:'PROFILE_CREATION_FAILED'});
        return true;
      }
      if(!setSessionCookie(profile.email))throw new OtpError('SESSION_FAILED',500);
      sendJson(201,{success:true,user:profile,message:'Campus account created and verified.'});
      return true;
    }
    return false;
  } catch(error) {
    if(error instanceof OtpError) {
      sendJson(error.status,errorPayload(error));
      return true;
    }
    throw error;
  }
}
module.exports={handlePgAuth};
