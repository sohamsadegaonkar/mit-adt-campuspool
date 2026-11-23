'use strict';
// QA fixture delivery transport. Never bypasses real PgOtpStore verification.
// No OTP codes are written to a database, logs, UI bundle, or response except
// the secret-token-protected test receipt on the *exact* staging service.
const crypto=require('node:crypto');
const emailProvider=require('./email-provider');
const smsProvider=require('../sms-provider');
const STAGING_ID='srv-dbjof8fb9u1s73eks0bg';
const STAGING_HOST='mit-adt-campuspool-staging.onrender.com';
const MAX_AGE_MS=5*60*1000;
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
  const left=crypto.createHash('sha256').update(a).digest();
  const right=crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left,right);
}
function qaConfig(env){
  if(env.STAGING_QA_OTP_MODE===undefined||env.STAGING_QA_OTP_MODE===''||
     env.STAGING_QA_OTP_MODE==='off')return null;
  if(env.STAGING_QA_OTP_MODE!=='fixture' ||
     env.NODE_ENV!=='production' || env.APP_ENV!=='staging' ||
     env.RENDER_SERVICE_ID!==STAGING_ID ||
     env.RENDER_EXTERNAL_HOSTNAME!==STAGING_HOST ||
     env.RENDER_GIT_BRANCH!=='staging' ||
     env.AUTH_OTP_BACKEND!=='postgres' || env.RIDES_BACKEND!=='postgres' ||
     env.ENABLE_CLUSTER!=='false' || env.OTP_DB_SSL!=='true' ||
     typeof env.STAGING_BASIC_AUTH_PASSWORD!=='string' ||
     env.STAGING_BASIC_AUTH_PASSWORD.length<20 ||
     typeof env.STAGING_QA_READ_TOKEN!=='string' ||
     env.STAGING_QA_READ_TOKEN.length<48 ||
     [env.OTP_SECRET,env.OTP_HMAC_KEY,env.STAGING_BASIC_AUTH_PASSWORD]
       .some(x=>safeEqual(x,env.STAGING_QA_READ_TOKEN)) ||
     !/^qa-[a-z0-9._+-]{3,64}@students\.mituniversity\.edu\.in$/.test(env.STAGING_QA_TEST_EMAIL||'') ||
     !/^[6-9][0-9]{9}$/.test(env.STAGING_QA_TEST_PHONE||'')){
    throw Error('STAGING_QA_OTP_CONFIGURATION_BLOCKED');
  }
  return {email:env.STAGING_QA_TEST_EMAIL,phone:env.STAGING_QA_TEST_PHONE,
    token:env.STAGING_QA_READ_TOKEN};
}
function makeStagingQaOtp(env=process.env,{clock=Date.now}={}){
  const config=qaConfig(env);
  if(!config)return {enabled:false};
  const pending=new Map();
  function store(channel,target,code){
    if(!/^[0-9]{6}$/.test(code))throw Error('INVALID_QA_OTP');
    pending.set(channel+':'+target,{code,until:clock()+MAX_AGE_MS});
    return {accepted:true,provider:'staging-qa-fixture'};
  }
  function readOtp({channel,target,token}={}){
    if(!safeEqual(token,config.token))return null;
    if(channel!=='email'&&channel!=='sms')return null;
    if(target!==(channel==='email'?config.email:config.phone))return null;
    const item=pending.get(channel+':'+target);
    if(!item)return null;
    if(clock()>=item.until){pending.delete(channel+':'+target);return null;}
    return item.code;
  }
  return {
    enabled:true,
    mailProvider:{
      configured:()=>true,
      sendOtpEmail:(target,code)=>
        target===config.email?Promise.resolve(store('email',target,code)):
          emailProvider.sendOtpEmail(target,code,{env})
    },
    smsDeliveryProvider:{
      isConfigured:()=>true,
      sendOtpSms:(target,code)=>
        target===config.phone?Promise.resolve(store('sms',target,code)):
          smsProvider.sendOtpSms(target,code,{env})
    },
    readOtp
  };
}
module.exports={makeStagingQaOtp,qaConfig,STAGING_ID,STAGING_HOST};
