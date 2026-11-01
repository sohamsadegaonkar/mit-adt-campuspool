'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const { isConfigured, sendOtpSms } = require('./sms-provider');
const DB = require('./database');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let log = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timeout: ' + log.slice(-1000))), 15000);
    child.stdout.on('data', bytes => {
      log += String(bytes);
      if (log.includes('active on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', bytes => { log += String(bytes); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error('Server exited: ' + code + ': ' + log.slice(-1000)));
    });
  });
}

test('MSG91 OTP adapter does not invent delivery success', async t => {
  const env={ SMS_PROVIDER:'msg91', MSG91_AUTHKEY:'test-not-real', MSG91_FLOW_TEMPLATE_ID:'test-template' };
  assert.equal(isConfigured(env),true);
  assert.equal(isConfigured({SMS_PROVIDER:'disabled'}),false);
  await t.test('accepted response formats validated request', async () => {
    let calls=0;
    const result=await sendOtpSms('9876543210','123456',{ env, fetchImpl:async (url,options)=>{
      calls++;
      assert.equal(url,'https://control.msg91.com/api/v5/flow');
      assert.equal(options.headers.authkey,'test-not-real');
      assert.equal(options.method,'POST');
      const body=JSON.parse(options.body);
      assert.equal(body.template_id,'test-template');
      assert.deepEqual(body.recipients,[{mobiles:'919876543210',VAR1:'123456'}]);
      return {ok:true,json:async()=>({type:'success'})};
    }});
    assert.deepEqual(result,{accepted:true,provider:'msg91'});
    assert.equal(calls,1);
  });
  await t.test('errors fail closed',async()=>{
    await assert.rejects(sendOtpSms('9876543210','123456',{env,fetchImpl:async()=>({ok:true,json:async()=>({type:'error'})})}),/SMS_PROVIDER_REJECTED/);
    await assert.rejects(sendOtpSms('9876543210','123456',{env,fetchImpl:async()=>({ok:false,status:401})}),/SMS_PROVIDER_REJECTED/);
    await assert.rejects(sendOtpSms('1111111111','123456',{env,fetchImpl:async()=>{throw new Error('Should not call provider');}}),/INVALID_SMS_PAYLOAD/);
    await assert.rejects(sendOtpSms('9876543210','123456',{env:{SMS_PROVIDER:'disabled'}}),/SMS_PROVIDER_NOT_CONFIGURED/);
  });
});

test('Frontend does not permit a client-generated verified identity or cache PII', () => {
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  for (const banned of ['token_offline_verified','token_phone_offline_verified','clientFallbackOtp','generateSixDigitOtp()','data.devOtpHint']){
    assert.equal(html.includes(banned),false,banned);
  }
  assert.match(html,/async function refreshSession\(\)/);
  assert.match(html,/apiFetch\('\/api\/auth\/me'/);
  assert.match(html,/await refreshSession\(\)/);
  assert.match(html,/localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.match(html,/X-CSRF-Token/);
  assert.doesNotMatch(html,/localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(appState\)\)/);
});

test('Separate staging configuration is manual and contains no credential values', () => {
  const config=fs.readFileSync(path.join(__dirname,'render-staging.yaml'),'utf8');
  assert.match(config,/name: mit-adt-campuspool-staging/);
  assert.match(config,/branch: feature\/(auth-staging-integration|stage1-postgres-otp|supabase-staging-postgres)/);
  assert.match(config,/autoDeployTrigger: 'off'/);
  assert.match(config,/key: APP_ENV\s+value: staging/);
  assert.match(config,/key: STAGING_BASIC_AUTH_PASSWORD\s+sync: false/);
  assert.match(config,/key: MSG91_AUTHKEY\s+sync: false/);
  assert.doesNotMatch(config,/ngvs yldy|gmail\.com.*@gmail\.com/);
});

test('Staging requires independent password, session cookie and CSRF', {timeout:60000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-stage-test-'));
  const dbPath=path.join(dir,'test.db');
  const port=await freePort();
  const pass='staging-test-'+crypto.randomBytes(32).toString('hex');
  const auth='Basic '+Buffer.from('staging:'+pass).toString('base64');
  const env={
    ...process.env,
    PORT:String(port),NODE_ENV:'production',APP_ENV:'staging',
    STAGING_BASIC_AUTH_PASSWORD:pass,
    OTP_SECRET:crypto.randomBytes(32).toString('hex'),
    ENABLE_CLUSTER:'false',CLUSTER_WORKERS:'1',
    DATABASE_PATH:dbPath,SMS_PROVIDER:'disabled',
    SMTP_HOST:'localhost',SMTP_PORT:'1',SMTP_PASS:''
  };
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env,stdio:['ignore','pipe','pipe']});
  let db;
  const base='http://127.0.0.1:'+port;
  try{
    await waitForServer(child);
    await t.test('Health endpoint and staging basic-auth gate',async()=>{
      assert.equal((await fetch(base+'/healthz')).status,200);
      const denied=await fetch(base+'/');
      assert.equal(denied.status,401);
      assert.match(denied.headers.get('www-authenticate'),/CampusPool staging/);
      assert.equal((await fetch(base+'/',{headers:{Authorization:auth}})).status,200);
      assert.equal((await fetch(base+'/',{headers:{Authorization:'Basic '+Buffer.from('staging:wrong').toString('base64')}})).status,401);
    });
    await t.test('Session introspection requires a server-verified session',async()=>{
      const noCookie=await fetch(base+'/api/auth/me',{headers:{Authorization:auth}});
      assert.equal(noCookie.status,401);
      db=new DB(dbPath);
      const profile=db.createProfile({
        name:'Staging Student',email:'stage@example.mituniversity.edu.in',
        phone:'9876543210',dept:'Computing'
      });
      const session=db.createSession(profile.email);
      const headers={Authorization:auth,Cookie:'cp_session='+session};
      const response=await fetch(base+'/api/auth/me',{headers});
      assert.equal(response.status,200);
      const identity=await response.json();
      assert.equal(identity.user.email,profile.email);
      assert.match(identity.csrfToken,/^[a-f0-9]{64}$/);
      const invalid=await fetch(base+'/api/rides',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      assert.equal(invalid.status,403);
      const withCsrf={...headers,'X-CSRF-Token':identity.csrfToken};
      const blockedPayment=await fetch(base+'/api/bookings/payment-status',{method:'POST',headers:withCsrf,body:'{}'});
      assert.equal(blockedPayment.status,501);
      const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:withCsrf});
      assert.equal(logout.status,200);
      assert.equal((await fetch(base+'/api/auth/me',{headers})).status,401);
    });
  } finally{
    db?.db.close();
    child.kill('SIGTERM');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('Real local email OTP verification creates a session and rejects code replay', {timeout:45000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-local-login-'));
  const dbPath=path.join(dir,'login.db');
  const port=await freePort();
  const loginEmail='auth-flow-test@students.mituniversity.edu.in';
  const database=new DB(dbPath);
  database.createProfile({ name:'Email Flow Test',email:loginEmail,phone:'9123456789',dept:'Engineering' });
  database.db.close();
  const env={
    ...process.env,
    PORT:String(port),NODE_ENV:'development',APP_ENV:'local',ALLOW_DEV_OTP:'true',
    OTP_SECRET:crypto.randomBytes(32).toString('hex'),ENABLE_CLUSTER:'false',CLUSTER_WORKERS:'1',
    DATABASE_PATH:dbPath,SMS_PROVIDER:'disabled',
    RESEND_API_KEY:'',BREVO_API_KEY:'',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',
    SMTP_USER:'',SMTP_PASS:''
  };
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env,stdio:['ignore','pipe','pipe']});
  const base='http://127.0.0.1:'+port;
  try {
    await waitForServer(child);
    const login=await fetch(base+'/api/auth/login-request',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({identifier:loginEmail})
    });
    assert.equal(login.status,200);
    const payload=await login.json();
    assert.match(payload.devOtpHint,/^[0-9]{6}$/);
    assert.equal(payload.deliveredToInbox,false);
    const verification=await fetch(base+'/api/auth/verify-email-otp',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:loginEmail,otp:payload.devOtpHint})
    });
    assert.equal(verification.status,200);
    const setCookie=verification.headers.get('set-cookie');
    assert.match(setCookie,/cp_session=[A-Za-z0-9_-]{43}/);
    assert.match(setCookie,/HttpOnly/);
    assert.match(setCookie,/SameSite=Lax/);
    const cookie=setCookie.split(';')[0];
    const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}});
    assert.equal(me.status,200);
    const meData=await me.json();
    assert.equal(meData.user.email,loginEmail);
    assert.match(meData.csrfToken,/^[a-f0-9]{64}$/);
    const replay=await fetch(base+'/api/auth/verify-email-otp',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:loginEmail,otp:payload.devOtpHint})
    });
    assert.equal(replay.status,400);
    assert.equal((await replay.json()).error,'OTP_ALREADY_USED');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
