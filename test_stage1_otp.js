'use strict';
// Requires isolated PostgreSQL test DB: OTP_DATABASE_URL. Never points to Render production.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migrate}=require('./stage1-otp/migrate');
const {PgOtpStore,OtpError}=require('./stage1-otp/pg-store');
const {sendOtpEmail,configured}=require('./stage1-otp/email-provider');

const connectionString=process.env.OTP_DATABASE_URL;
const hmacKey='stage1-test-key-'+crypto.randomBytes(32).toString('hex');
const ready=connectionString?migrate({connectionString,ssl:false}):Promise.resolve();
const stores=[];

async function makeStore() {
  await ready;
  const store=new PgOtpStore({connectionString,hmacKey,ssl:false});
  await store.ready();
  stores.push(store);
  return store;
}
function unique(prefix) {
  return prefix+'-'+crypto.randomBytes(8).toString('hex')+'@students.mituniversity.edu.in';
}
function capture() {
  const sent=[];
  return {sent,deliver:async payload=>{sent.push(payload);return {accepted:true,provider:'fake'};}};
}
test('Stage 1 PostgreSQL OTP lifecycle', {skip:!connectionString?'OTP_DATABASE_URL test database required':false}, async t=>{
  const store=await makeStore();
  await t.test('only HMACs stored; verified proof is one-time',async()=>{
    const target=unique('happy'), d=capture();
    const issued=await store.issue({purpose:'signup_email',channel:'email',target,ip:'203.0.113.11',deliver:d.deliver});
    assert.equal(issued.expiresInSeconds,300);
    assert.equal(issued.resendAfterSeconds,60);
    assert.equal(d.sent.length,1);
    assert.match(d.sent[0].code,/^[0-9]{6}$/);
    assert.equal(issued.code,undefined);
    const db=await store.pool.query('SELECT * FROM otp_challenges WHERE target_hash=$1',
      [store.targetDigest('email',target)]);
    assert.equal(db.rowCount,1);
    assert.equal(db.rows[0].state,'active');
    assert.equal(db.rows[0].code_hmac.includes(d.sent[0].code),false);
    assert.equal(JSON.stringify(db.rows[0]).includes(target),false);
    const result=await store.verify({purpose:'signup_email',channel:'email',target,
      code:d.sent[0].code,ip:'203.0.113.11'});
    assert.equal(result.ok,true);
    assert.match(result.proof,/^[A-Za-z0-9_-]{43}$/);
    await assert.rejects(store.verify({purpose:'signup_email',channel:'email',target,
      code:d.sent[0].code,ip:'203.0.113.11'}),e=>e.code==='OTP_ALREADY_USED');
  });

  await t.test('wrong attempts persist and lock after five tries',async()=>{
    const target=unique('wrong'),d=capture();
    await store.issue({purpose:'login',channel:'email',target,ip:'203.0.113.12',deliver:d.deliver});
    let wrong='000000';if(d.sent[0].code===wrong)wrong='999999';
    for(let i=1;i<=5;i++){
      const result=await store.verify({purpose:'login',channel:'email',target,code:wrong,ip:'203.0.113.12'});
      assert.equal(result.ok,false);
      assert.equal(result.attemptsRemaining,5-i);
    }
    await assert.rejects(store.verify({purpose:'login',channel:'email',target,
      code:d.sent[0].code,ip:'203.0.113.12'}),e=>e.code==='OTP_LOCKED');
    const row=await store.pool.query('SELECT attempt_count,state FROM otp_challenges WHERE target_hash=$1',
      [store.targetDigest('email',target)]);
    assert.equal(row.rows[0].attempt_count,5);
    assert.equal(row.rows[0].state,'locked');
  });

  await t.test('simultaneous resend permits only one provider delivery',async()=>{
    const target=unique('resend'),d=capture();
    const attempts=await Promise.allSettled([1,2].map(n=>store.issue({
      purpose:'signup_email',channel:'email',target,ip:'198.51.100.21',deliver:d.deliver
    })));
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.code==='RESEND_COOLDOWN').length,1);
    assert.equal(d.sent.length,1);
  });

  await t.test('simultaneous verification only succeeds once, even across workers',async()=>{
    const target=unique('concurrent'),d=capture();
    await store.issue({purpose:'login',channel:'email',target,ip:'203.0.113.22',deliver:d.deliver});
    const second=await makeStore();
    const results=await Promise.allSettled([store,second].map(s=>s.verify({
      purpose:'login',channel:'email',target,code:d.sent[0].code,ip:'203.0.113.22'
    })));
    assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.ok).length,1);
    assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='OTP_ALREADY_USED').length,1);
  });

  await t.test('expired challenge cannot verify',async()=>{
    const target=unique('expired'),d=capture();
    await store.issue({purpose:'login',channel:'email',target,ip:'203.0.113.23',deliver:d.deliver});
    await store.pool.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE target_hash=$1",
      [store.targetDigest('email',target)]);
    await assert.rejects(store.verify({purpose:'login',channel:'email',target,
      code:d.sent[0].code,ip:'203.0.113.23'}),e=>e.code==='OTP_EXPIRED');
  });

  await t.test('provider rejection fails closed and never leaves active challenge',async()=>{
    const target=unique('fail');
    await assert.rejects(store.issue({purpose:'signup_email',channel:'email',target,
      ip:'198.51.100.38',deliver:async()=>{throw Error('provider timeout');}}),
    e=>e.code==='DELIVERY_UNAVAILABLE');
    const r=await store.pool.query('SELECT state FROM otp_challenges WHERE target_hash=$1',
      [store.targetDigest('email',target)]);
    assert.equal(r.rows[0].state,'failed');
  });

  await t.test('both registration proofs redeemed atomically and never twice',async()=>{
    const email=unique('register'),phone='9876501234',di=capture(),dp=capture();
    await store.issue({purpose:'signup_email',channel:'email',target:email,ip:'203.0.113.31',deliver:di.deliver});
    await store.issue({purpose:'signup_phone',channel:'sms',target:phone,ip:'203.0.113.31',deliver:dp.deliver});
    const e=await store.verify({purpose:'signup_email',channel:'email',target:email,
      code:di.sent[0].code,ip:'203.0.113.31'});
    const p=await store.verify({purpose:'signup_phone',channel:'sms',target:phone,
      code:dp.sent[0].code,ip:'203.0.113.31'});
    const payload={email,emailProof:e.proof,phone,phoneProof:p.proof};
    const first=await Promise.allSettled([store.consumeRegistration(payload),store.consumeRegistration(payload)]);
    assert.equal(first.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(first.filter(x=>x.status==='rejected'&&x.reason.code==='VERIFICATION_REQUIRED').length,1);
  });

  await t.test('IP rate limit shared across targets',async()=>{
    let blocked=false;
    for(let i=0;i<12;i++){
      try{
        await store.issue({purpose:'login',channel:'email',target:unique('ratelimit'),ip:'192.0.2.98',
          deliver:async()=>({accepted:true})});
      }catch(e){if(e.code==='RATE_LIMITED'){blocked=true;break;}throw e;}
    }
    assert.equal(blocked,true);
  });
  await t.test('unknown account lookups are IP and identifier limited in shared PostgreSQL',async()=>{
    const identifier=unique('unknown-login');
    const ip='192.0.2.211';
    await store.throttleLoginLookup({identifier,ip});
    // The second request within 60s is blocked equally for existing and
    // nonexistent identifiers without checking account existence.
    await assert.rejects(
      store.throttleLoginLookup({identifier,ip}),
      e=>e.code==='RATE_LIMITED' && e.status===429
    );
    let capped=false;
    for(let i=0;i<15;i++){
      try{
        await store.throttleLoginLookup({identifier:unique('random-login'),ip:'192.0.2.212'});
      }catch(e){
        if(e.code==='RATE_LIMITED'){capped=true;break;}
        throw e;
      }
    }
    assert.equal(capped,true);
  });

  await Promise.all(stores.map(s=>s.close()));
});

test('Transactional email adapter requires credentials and validates response',async()=>{
  assert.equal(configured({}),false);
  const env={EMAIL_PROVIDER:'resend',RESEND_API_KEY:'test-only',EMAIL_FROM:'CampusPool <verified@example.org>'};
  let called=0;
  const result=await sendOtpEmail('example@students.mituniversity.edu.in','123456',{
    env,fetchImpl:async(url,init)=>{
      called++;
      assert.equal(url,'https://api.resend.com/emails');
      assert.equal(init.headers.Authorization,'Bearer test-only');
      const body=JSON.parse(init.body);
      assert.match(body.text,/123456/);
      assert.match(body.html,/123456/);
      assert.equal(body.to[0],'example@students.mituniversity.edu.in');
      return {ok:true,json:async()=>({id:'fake-id'})};
    }});
  assert.equal(called,1);
  assert.equal(result.accepted,true);
  await assert.rejects(sendOtpEmail('example@students.mituniversity.edu.in','123456',{
    env,fetchImpl:async()=>({ok:false,status:403})}),/EMAIL_PROVIDER_REJECTED/);
  await assert.rejects(sendOtpEmail('example@students.mituniversity.edu.in','123456'),/EMAIL_PROVIDER_NOT_CONFIGURED/);
});


test('Stage 1 API contract: email signup, phone signup, registration and login', {
  skip:!connectionString?'OTP_DATABASE_URL test database required':false
},async()=>{
  const {handlePgAuth}=require('./stage1-otp/auth-routes');
  const store=await makeStore();
  const email=unique('complete-flow'),phone='9123456788';
  const profiles=[];
  const emailCodes=[],smsCodes=[];
  const mockDb={
    getProfiles:()=>profiles,
    getProfileByEmail:identifier=>profiles.find(x=>x.email===identifier)||null,
    getProfileByIdentifier:identifier=>profiles.find(x=>x.email===identifier||x.phone===identifier)||null,
    checkUniqueness:(_name,identifier,mobile)=>({
      unique:!profiles.some(x=>x.email===identifier||x.phone===mobile)
    }),
    createProfile:details=>{
      if(profiles.some(x=>x.email===details.email)) throw Error('duplicate');
      const user={...details,id:crypto.randomUUID(),isVerified:true};
      profiles.push(user);return user;
    }
  };
  const mailProvider={
    configured:()=>true,
    sendOtpEmail:async(target,code)=>{emailCodes.push({target,code});return {accepted:true};}
  };
  const smsDeliveryProvider={
    isConfigured:()=>true,
    sendOtpSms:async(target,code)=>{smsCodes.push({target,code});return {accepted:true};}
  };
  let sessions=0;
  const call=async (pathname,body)=>{
    let status=null,output=null;
    const handled=await handlePgAuth({
      pathname,method:'POST',parseBody:async()=>body,
      sendJson:(code,payload)=>{status=code;output=payload;},
      db:mockDb,setSessionCookie:()=>{sessions++;return true;},
      getClientIp:()=> '198.51.100.177',store,mailProvider,smsDeliveryProvider
    });
    assert.equal(handled,true);
    return {status,...output};
  };

  const requestEmail=await call('/api/auth/send-email-otp',{name:'Sample Student',email,phone});
  assert.equal(requestEmail.status,200);
  assert.equal(emailCodes.length,1);
  const verifiedEmail=await call('/api/auth/verify-email-otp',{email,otp:emailCodes[0].code});
  assert.equal(verifiedEmail.status,200);
  assert.equal(verifiedEmail.isLogin,false);
  assert.match(verifiedEmail.emailToken,/^[A-Za-z0-9_-]{43}$/);
  const replayEmail=await call('/api/auth/verify-email-otp',{email,otp:emailCodes[0].code});
  assert.equal(replayEmail.status,400);

  const requestPhone=await call('/api/auth/send-phone-otp',{phone:'+91 '+phone});
  assert.equal(requestPhone.status,200);
  assert.equal(smsCodes.length,1);
  const verifiedPhone=await call('/api/auth/verify-phone-otp',{phone,otp:smsCodes[0].code});
  assert.equal(verifiedPhone.status,200);

  const registered=await call('/api/auth/register',{
    name:'Sample Student',email,phone,dept:'Engineering',
    emailToken:verifiedEmail.emailToken,phoneToken:verifiedPhone.phoneToken
  });
  assert.equal(registered.status,201);
  assert.equal(profiles.length,1);
  assert.equal(sessions,1);
  const replayRegister=await call('/api/auth/register',{
    name:'Sample Student',email,phone,dept:'Engineering',
    emailToken:verifiedEmail.emailToken,phoneToken:verifiedPhone.phoneToken
  });
  assert.equal(replayRegister.status,409);
  assert.equal(profiles.length,1);

  const signIn=await call('/api/auth/login-request',{identifier:email});
  assert.equal(signIn.status,200);
  assert.equal(emailCodes.length,2);
  const signedIn=await call('/api/auth/verify-email-otp',{email,otp:emailCodes[1].code});
  assert.equal(signedIn.status,200);
  assert.equal(signedIn.isLogin,true);
  assert.equal(sessions,2);
  await store.close();
});
