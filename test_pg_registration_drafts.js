'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {PgOtpStore}=require('./stage1-otp/pg-store');
const {PgIdentity}=require('./stage1-otp/identity');
const {RegistrationDrafts}=require('./stage1-otp/registration-drafts');
const url=process.env.REGISTRATION_TEST_DATABASE_URL;
test('registration draft foundation on disposable PostgreSQL',async t=>{
  assert.ok(url,'Dedicated disposable database URL required; refusing to silently skip');
  const parsed=new URL(url);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname,'/campuspool_registration_test');
  const store=new PgOtpStore({connectionString:url,hmacKey:crypto.randomBytes(48).toString('hex'),ssl:false});
  const identity=new PgIdentity(store);
  const drafts=new RegistrationDrafts(store,identity,{ttlSeconds:3600});
  const nonce=crypto.randomBytes(8).toString('hex');
  const email=nonce+'@students.mituniversity.edu.in';
  const phone='9'+String(crypto.randomInt(100000000,999999999));
  const phone2='8'+String(crypto.randomInt(100000000,999999999));
  let first;
  async function bind(draft,channel,target){
    const id=crypto.randomUUID(),purpose=channel==='email'?'signup_email':'signup_phone';
    await store.tx(async client=>{
      await client.query("INSERT INTO otp_challenges(id,purpose,channel,target_hash,code_hmac,state,expires_at,resend_at) VALUES($1,$2,$3,$4,$5,'pending',now()+interval '5 minutes',now()) ON CONFLICT(purpose,channel,target_hash) DO UPDATE SET id=excluded.id,state='pending',proof_hash=NULL,proof_expires_at=NULL,proof_consumed_at=NULL,verified_at=NULL",
        [id,purpose,channel,store.targetDigest(channel,target),'a'.repeat(64)]);
      await drafts.bindIssuedChallenge(client,{resumeToken:draft.resumeToken,channel,target,challengeId:id});
    });
    return id;
  }
  // Fixture models the OTP engine's successful code-validation transaction.
  // The future HTTP/OTP integration must call this hook inside store.verify.
  async function record(draft,channel,target,id){
    return store.tx(async client=>{
      await client.query("UPDATE otp_challenges SET state='verified',proof_hash=$2,proof_expires_at=now()+interval '10 minutes' WHERE id=$1",[id,'b'.repeat(64)]);
      return drafts.recordVerifiedChallenge(client,{resumeToken:draft.resumeToken,channel,target,challengeId:id});
    });
  }
  try{
    for(const file of ['001_otp.sql','002_users_sessions.sql','003_supabase_private_tables.sql','004_audit_user_index.sql','005_staging_backend_role.sql','015_pending_registration.sql']){
      await store.pool.query(fs.readFileSync(path.join(__dirname,'stage1-otp','migrations',file),'utf8'));
    }
    await t.test('unverified draft is not a session or active user; hash only',async()=>{
      first=await drafts.start({email,phone});
      assert.equal(first.state.emailVerified,false);
      assert.equal(await identity.getSessionUser(first.resumeToken),null);
      assert.equal(await identity.getProfileByEmail(email),null);
      await assert.rejects(drafts.finalize(first.resumeToken,{name:'CI Student',dept:'Computing'}),{code:'VERIFICATION_REQUIRED'});
      await assert.rejects(drafts.status(crypto.randomBytes(32).toString('base64url')),{code:'REGISTRATION_UNAVAILABLE'});
      const {rows}=await store.pool.query('SELECT resume_hash FROM campus_pending_registrations WHERE email=$1',[email]);
      assert.equal(rows[0].resume_hash,crypto.createHash('sha256').update(first.resumeToken).digest('hex'));
    });
    await t.test('email verification persists; mismatched draft cannot steal proof',async()=>{
      const id=await bind(first,'email',email);
      const other=await drafts.start({email,phone:phone2});
      await assert.rejects(record(other,'email',email,id),{code:'REGISTRATION_UNAVAILABLE'});
      assert.equal((await store.pool.query('SELECT state FROM otp_challenges WHERE id=$1',[id])).rows[0].state,'pending');
      await record(first,'email',email,id);
      const restarted=new RegistrationDrafts(store,new PgIdentity(store),{ttlSeconds:3600});
      assert.equal((await restarted.status(first.resumeToken)).emailVerified,true);
      assert.equal((await restarted.status(first.resumeToken)).phoneVerified,false);
      assert.equal(await identity.getProfileByEmail(email),null);
      await assert.rejects(store.tx(client=>drafts.recordVerifiedChallenge(client,{resumeToken:first.resumeToken,channel:'email',target:email,challengeId:id})),{code:'REGISTRATION_UNAVAILABLE'});
    });
    await t.test('contact change invalidates only changed channel',async()=>{
      const oldPhoneChallenge=await bind(first,'sms',phone);
      await record(first,'sms',phone,oldPhoneChallenge);
      const changed=await drafts.changeContacts(first.resumeToken,{email,phone:phone2});
      assert.equal(changed.emailVerified,true);
      assert.equal(changed.phoneVerified,false);
      await assert.rejects(drafts.finalize(first.resumeToken,{name:'CI Student',dept:'Computing'}),{code:'VERIFICATION_REQUIRED'});
      const id=await bind(first,'sms',phone2);
      await record(first,'sms',phone2,id);
    });
    await t.test('concurrent finalization creates exactly one verified account and session',async()=>{
      const results=await Promise.allSettled([1,2].map(()=>drafts.finalize(first.resumeToken,{name:'CI Student',dept:'Computing'})));
      const successes=results.filter(r=>r.status==='fulfilled');
      assert.equal(successes.length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.code,'REGISTRATION_UNAVAILABLE');
      assert.equal((await identity.getSessionUser(successes[0].value.token)).email,email);
      const counts=await store.pool.query('SELECT count(*)::int AS n FROM campus_sessions WHERE user_id=$1',[successes[0].value.user.id]);
      assert.equal(counts.rows[0].n,1);
      await assert.rejects(drafts.status(first.resumeToken),{code:'REGISTRATION_UNAVAILABLE'});
    });
    await t.test('expiry and bounded cleanup never delete active users',async()=>{
      const second=await drafts.start({email:'expired-'+email,phone});
      await store.pool.query("UPDATE campus_pending_registrations SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE resume_hash=$1",[crypto.createHash('sha256').update(second.resumeToken).digest('hex')]);
      await assert.rejects(drafts.status(second.resumeToken),{code:'REGISTRATION_UNAVAILABLE'});
      assert.equal(await drafts.purgeExpired(1),1);
      assert.equal((await identity.getProfileByEmail(email)).isVerified,true);
    });
  }finally{await store.close();}
});
