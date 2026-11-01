'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PgOtpStore}=require('./stage1-otp/pg-store');
const {PgIdentity}=require('./stage1-otp/identity');
const {migrate}=require('./stage1-otp/migrate');
const {handlePgAuth}=require('./stage1-otp/auth-routes');

const url=process.env.OTP_DATABASE_URL;
const key='ci-identity-'+crypto.randomBytes(40).toString('hex');
const fresh=()=>crypto.randomBytes(8).toString('hex');
test('PostgreSQL identity: atomic signup, durable sessions and login', {skip:!url},async t=>{
 await migrate({connectionString:url,ssl:false});
 const store=new PgOtpStore({connectionString:url,ssl:false,hmacKey:key});
 const identity=new PgIdentity(store);
 const address='stage-'+fresh()+'@students.mituniversity.edu.in';
 const phone='9'+String(100000000+crypto.randomInt(0,899999999));
 const codes={email:[],sms:[]};
 const mailProvider={configured:()=>true,sendOtpEmail:async(_target,code)=>{
   codes.email.push(code);return {accepted:true};
 }};
 const smsDeliveryProvider={isConfigured:()=>true,sendOtpSms:async(_target,code)=>{
   codes.sms.push(code);return {accepted:true};
 }};
 const sessions=[];
 async function call(path,body){
   let status=null,payload=null;
   const accepted=await handlePgAuth({pathname:path,method:'POST',parseBody:async()=>body,
     sendJson:(s,x)=>{status=s;payload=x;},
     db:{},store,identity,
     setPostgresCookie:token=>{sessions.push(token);return true;},
     getClientIp:()=> '192.0.2.42',mailProvider,smsDeliveryProvider});
   assert.equal(accepted,true);
   return {status,...payload};
 }
 try{
   await t.test('no preverified profile exists',async()=>{
     assert.equal(await identity.getProfileByEmail(address),null);
     assert.equal((await identity.checkUniqueness('CI student',address,phone)).unique,true);
   });
   await t.test('full email and phone verification',async()=>{
     const r=await call('/api/auth/send-email-otp',{name:'CI Student',email:address,phone});
     assert.equal(r.status,200);
     const email=await call('/api/auth/verify-email-otp',{email:address,otp:codes.email[0]});
     assert.equal(email.status,200);
     const sms=await call('/api/auth/send-phone-otp',{phone});
     assert.equal(sms.status,200);
     const verified=await call('/api/auth/verify-phone-otp',{phone,otp:codes.sms[0]});
     assert.equal(verified.status,200);
     const registration=await call('/api/auth/register',{name:'CI Student',email:address,phone,dept:'Computing',
       emailToken:email.emailToken,phoneToken:verified.phoneToken});
     assert.equal(registration.status,201);
     assert.equal(sessions.length,1);
     assert.equal((await identity.getProfileByEmail(address)).isVerified,true);
     assert.equal((await identity.getSessionUser(sessions[0])).email,address);
     const query=await store.pool.query('SELECT count(*)::int AS n FROM campus_users WHERE email=$1',[address]);
     assert.equal(query.rows[0].n,1);
     const replay=await call('/api/auth/register',{name:'CI Student',email:address,phone,dept:'Computing',
       emailToken:email.emailToken,phoneToken:verified.phoneToken});
     assert.equal(replay.status,409);
   });
   await t.test('login persists session and logout revokes',async()=>{
     const start=await call('/api/auth/login-request',{identifier:address});
     assert.equal(start.status,200);
     const verified=await call('/api/auth/verify-email-otp',{email:address,otp:codes.email.at(-1)});
     assert.equal(verified.status,200);
     assert.equal(verified.isLogin,true);
     assert.equal(sessions.length,2);
     assert.equal((await identity.getSessionUser(sessions.at(-1))).email,address);
     const afterRestart=new PgIdentity(new PgOtpStore({connectionString:url,ssl:false,hmacKey:key}));
     assert.equal((await afterRestart.getSessionUser(sessions.at(-1))).email,address);
     await identity.revokeSession(sessions.at(-1));
     assert.equal(await identity.getSessionUser(sessions.at(-1)),null);
     await afterRestart.store.close();
   });
   await t.test('atomic registration rolls back on duplicate identity',async()=>{
     const db=await store.pool.query('SELECT count(*)::int AS n FROM campus_users WHERE phone=$1',[phone]);
     assert.equal(db.rows[0].n,1);
     const duplicate=await identity.checkUniqueness('Different Person',address,phone);
     assert.equal(duplicate.unique,false);
   });
 }finally{await store.close();}
});
