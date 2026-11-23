'use strict';
// Approved-fixture-only LIVE staging test. Creates/uses one fake QA account.
// No production hostname, real provider delivery, free-form student target,
// migration, payment, penalty or remote database management is allowed.
const {runSmoke,readConfig,BASE}=require('./staging-live-acceptance');
function config(env){
  const base=readConfig(env);
  if(typeof env.STAGING_QA_READ_TOKEN!=='string'||
     env.STAGING_QA_READ_TOKEN.length<48||
     !/^qa-[a-z0-9._+-]{3,64}@students\.mituniversity\.edu\.in$/.test(env.STAGING_QA_TEST_EMAIL||'')||
     !/^[6-9][0-9]{9}$/.test(env.STAGING_QA_TEST_PHONE||''))
    throw Error('QA_FIXTURE_SECRETS_REQUIRED');
  return {...base,token:env.STAGING_QA_READ_TOKEN,email:env.STAGING_QA_TEST_EMAIL,
    phone:env.STAGING_QA_TEST_PHONE};
}
async function runFixture({env=process.env,fetchImpl=globalThis.fetch,
  baseline=runSmoke}={}){
  const q=config(env);
  await baseline({env,fetchImpl});
  const basic='Basic '+Buffer.from('staging:'+q.pass).toString('base64');
  let cookie='';
  async function api(endpoint,body,withQaToken=false){
    const headers={'Content-Type':'application/json',Authorization:basic};
    if(withQaToken)headers['X-CampusPool-QA-Token']=q.token;
    if(cookie)headers.Cookie=cookie;
    const response=await fetchImpl(BASE+endpoint,{
      method:'POST',headers,redirect:'manual',
      body:JSON.stringify(body),signal:AbortSignal.timeout(25000)
    });
    const setCookie=response.headers?.get?.('set-cookie');
    if(setCookie&&/^cp_session=[A-Za-z0-9_-]{43}/.test(setCookie))
      cookie=setCookie.split(';',1)[0];
    let data;
    try{data=await response.json();}catch(_){throw Error('STAGING_API_INVALID_RESPONSE');}
    return {status:response.status,body:data};
  }
  async function obtain(channel,target){
    const r=await api('/api/_staging/qa-otp',{channel,target},true);
    if(r.status!==200||!/^[0-9]{6}$/.test(r.body?.otp||''))
      throw Error('STAGING_QA_RECEIPT_MISSING');
    return r.body.otp;
  }
  const profile={name:'CampusPool QA Fixture',email:q.email,phone:q.phone,dept:'QA Testing'};
  const start=await api('/api/auth/send-email-otp',profile);
  let route;
  if(start.status===200){
    route='registration';
    const code=await obtain('email',q.email);
    const email=await api('/api/auth/verify-email-otp',{email:q.email,otp:code});
    if(email.status!==200||typeof email.body.emailToken!=='string')
      throw Error('QA_EMAIL_VERIFICATION_FAILED');
    const phoneStart=await api('/api/auth/send-phone-otp',{phone:q.phone});
    if(phoneStart.status!==200)throw Error('QA_PHONE_ISSUE_FAILED');
    const pCode=await obtain('sms',q.phone);
    const phone=await api('/api/auth/verify-phone-otp',{phone:q.phone,otp:pCode});
    if(phone.status!==200||typeof phone.body.phoneToken!=='string')
      throw Error('QA_PHONE_VERIFICATION_FAILED');
    const created=await api('/api/auth/register',{...profile,
      emailToken:email.body.emailToken,phoneToken:phone.body.phoneToken});
    if(created.status!==201||!cookie)throw Error('QA_REGISTRATION_FAILED');
  }else if(start.status===409){
    route='login';
    const requested=await api('/api/auth/login-request',{identifier:q.email});
    if(requested.status!==200)throw Error('QA_LOGIN_REQUEST_FAILED');
    const code=await obtain('email',q.email);
    const verified=await api('/api/auth/verify-email-otp',{
      email:q.email,isLoginFlow:true,otp:code});
    if(verified.status!==200||!verified.body?.isLogin||!cookie)
      throw Error('QA_LOGIN_VERIFY_FAILED');
  }else throw Error('QA_SIGNUP_REQUEST_UNEXPECTED');
  const session=await fetchImpl(BASE+'/api/auth/me',{
    method:'GET',headers:{Authorization:basic,Cookie:cookie},
    signal:AbortSignal.timeout(25000),redirect:'manual'});
  if(session.status!==200)throw Error('QA_SESSION_NOT_ESTABLISHED');
  const user=await session.json();
  if(user?.user?.email!==q.email)throw Error('QA_SESSION_IDENTITY_MISMATCH');
  return {status:'STAGING_FIXTURE_OTP_FLOW_PASS',flow:route,
    normalOtpVerification:true,productionTouched:false,
    realEmailOrSmsSent:false,qaFixtureOnly:true};
}
if(require.main===module){
  runFixture().then(out=>process.stdout.write(JSON.stringify(out)+'\n'))
    .catch(err=>{const code=/^(QA_|STAGING_)[A-Z0-9_]+$/.test(err.message)?err.message:'STAGING_FIXTURE_UNCLASSIFIED';process.stderr.write('BLOCK '+code+'\n');process.exitCode=1;});
}
module.exports={runFixture,config};
