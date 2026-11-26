'use strict';
// Test-only preload for the real server. Never imported by application code.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const db=new URL(process.env.OTP_DATABASE_URL||'http://invalid');
if(process.env.QA_DISPOSABLE_REGISTRATION!=='YES'||db.hostname!=='127.0.0.1'||
   db.pathname!=='/campuspool_registration_browser_test'||
   process.env.REGISTRATION_ORIGIN!=='https://127.0.0.1:4199'||
   !process.env.REGISTRATION_FIXTURE_DIR)
  throw Error('Refusing non-disposable registration test fixture');
const dir=process.env.REGISTRATION_FIXTURE_DIR;
function deliver(channel,target,code){
  if(channel==='sms'&&fs.existsSync(path.join(dir,'sms-down')))return {accepted:false};
  const filename=crypto.createHash('sha256').update(channel+':'+target).digest('hex');
  fs.writeFileSync(path.join(dir,filename),code,{mode:0o600});
  return {accepted:true};
}
const mail=require('../stage1-otp/email-provider');
mail.configured=()=>true;
mail.sendOtpEmail=async(target,code)=>deliver('email',target,code);
const sms=require('../sms-provider');
sms.isConfigured=()=>true;
sms.sendOtpSms=async(target,code)=>deliver('sms',target,code);
