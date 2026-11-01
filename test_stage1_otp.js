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
