'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {configured,sendEmail,sendOtpEmail,fromAddress}=require('./stage1-otp/email-provider');
const DB=require('./database');

const resend={EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-resend-unit-only',
  EMAIL_FROM:'CampusPool QA <verified@example.org>'};
const mail={to:'student@students.mituniversity.edu.in',subject:'Your code',
  htmlContent:'<strong>123456</strong>',textContent:'Your code is 123456'};

test('only explicitly selected HTTPS mail providers are configured',()=>{
  assert.equal(configured(resend),true);
  assert.equal(configured({...resend,EMAIL_PROVIDER:'disabled'}),false);
  assert.equal(configured({...resend,EMAIL_FROM:'onboarding@resend.dev',RESEND_API_KEY:''}),false);
  assert.equal(configured({...resend,EMAIL_FROM:'Bad\r\nBcc: theft@example.org'}),false);
  assert.equal(configured({...resend,EMAIL_FROM:''}),false);
  assert.deepEqual(fromAddress(resend.EMAIL_FROM),{email:'verified@example.org',name:'CampusPool QA'});
});

test('Resend HTTPS uses configured sender and requires accepted message id',async()=>{
  let calls=0;
  const result=await sendEmail(mail,{env:resend,fetchImpl:async (url,opts)=>{
    calls++;
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(opts.headers.Authorization,'Bearer '+resend.RESEND_API_KEY);
    const body=JSON.parse(opts.body);
    assert.equal(body.from,resend.EMAIL_FROM);
    assert.equal(body.to[0],mail.to);
    assert.equal(body.text,mail.textContent);
    return {ok:true,json:async()=>({id:'synthetic-message-id'})};
  }});
  assert.deepEqual(result,{accepted:true,provider:'resend'});
  assert.equal(calls,1);
  await assert.rejects(sendEmail(mail,{env:resend,
    fetchImpl:async()=>({ok:true,json:async()=>({})})}),/EMAIL_PROVIDER_REJECTED/);
  await assert.rejects(sendEmail(mail,{env:resend,
    fetchImpl:async()=>({ok:false,status:403})}),/EMAIL_PROVIDER_REJECTED/);
  await assert.rejects(sendEmail(mail,{env:resend,
    fetchImpl:async()=>{throw Error('sensitive raw provider detail');}}),/EMAIL_PROVIDER_UNAVAILABLE/);
});

test('Brevo HTTPS sends a verified configurable sender and requires message id',async()=>{
  const env={EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'synthetic-brevo-only',EMAIL_FROM:'CampusPool <verified@example.org>'};
  const result=await sendEmail(mail,{env,fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://api.brevo.com/v3/smtp/email');
    assert.equal(opts.headers['api-key'],env.BREVO_API_KEY);
    const body=JSON.parse(opts.body);
    assert.deepEqual(body.sender,{email:'verified@example.org',name:'CampusPool'});
    assert.deepEqual(body.to,[{email:mail.to}]);
    return {ok:true,json:async()=>({messageId:'synthetic-brevo-message-id'})};
  }});
  assert.equal(result.accepted,true);
  assert.equal(result.provider,'brevo');
});

test('legacy SMTP credentials cannot trigger a fallback or fake acceptance',async()=>{
  let calls=0;
  const env={EMAIL_PROVIDER:'disabled',SMTP_USER:'test@example.org',SMTP_PASS:'synthetic-private',
    SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'465'};
  await assert.rejects(sendEmail(mail,{env,fetchImpl:async()=>{calls++;throw Error('network not allowed');}}),
    /EMAIL_PROVIDER_NOT_CONFIGURED/);
  assert.equal(calls,0);
});

test('PostgreSQL OTP mail still uses the shared HTTPS provider and five-minute copy',async()=>{
  await sendOtpEmail(mail.to,'123456',{env:resend,fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.resend.com/emails');
    const body=JSON.parse(init.body);
    assert.match(body.text,/5 minutes/);
    assert.match(body.text,/123456/);
    return {ok:true,json:async()=>({id:'synthetic-id'})};
  }});
});

test('SQLite rejects a failed OTP by exact id without deleting verified or newer requests',()=>{
  const db=new DB(':memory:');
  const now=Date.now();
  const base={identifier:'example@students.mituniversity.edu.in',type:'EMAIL',
    hashedOtp:'synthetic-digest-only',attemptsLeft:5,expiresAt:now+600000,
    resendCooldownUntil:now+45000,isVerified:false,createdAt:now};
  db.saveOtp({...base,id:'failed-request'});
  assert.equal(db.deleteOtp('failed-request'),true);
  assert.equal(db.findOtp(base.identifier,'EMAIL'),null);
  db.saveOtp({...base,id:'verified-request',isVerified:true});
  assert.equal(db.deleteOtp('verified-request'),false);
  db.saveOtp({...base,id:'newer-request',createdAt:now+1});
  assert.equal(db.deleteOtp('failed-request'),false);
  assert.equal(db.findOtp(base.identifier,'EMAIL').id,'newer-request');
  db.db.close();
});
