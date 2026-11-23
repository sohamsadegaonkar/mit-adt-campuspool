'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runFixture,config}=require('./scripts/staging-fixture-acceptance');
const {BASE}=require('./scripts/staging-live-acceptance');
const EMAIL='qa-automation-fixture@students.mituniversity.edu.in';
const PHONE='9876543219';
const TOKEN='synthetic-qa-reader-token-'.padEnd(58,'z');
const ENV={
  STAGING_BASE_URL:BASE,STAGING_EXPECTED_SHA:'a'.repeat(40),
  STAGING_BASIC_AUTH_PASSWORD:'test-staging-basic-auth-not-a-real-password',
  STAGING_QA_READ_TOKEN:TOKEN,STAGING_QA_TEST_EMAIL:EMAIL,
  STAGING_QA_TEST_PHONE:PHONE
};
const COOKIE='cp_session='+('a'.repeat(43));
function fakeServer({registered}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.ok(url.startsWith(BASE+'/'));
    assert.equal(options.redirect,'manual');
    assert.ok(options.headers.Authorization?.startsWith('Basic '));
    const pathname=new URL(url).pathname;
    const body=options.method==='POST'?JSON.parse(options.body):{};
    calls.push({pathname,body,headers:options.headers});
    const payload=(status,data,sendCookie=false)=>({
      status,json:async()=>data,
      headers:{get:k=>k==='set-cookie'&&sendCookie?COOKIE+'; HttpOnly; SameSite=Lax; Secure':null}
    });
    switch(pathname){
      case '/api/auth/send-email-otp':
        return registered?payload(409,{success:false,error:'NOT_UNIQUE'}):
          payload(200,{success:true});
      case '/api/auth/login-request':
        return payload(200,{success:true});
      case '/api/_staging/qa-otp':
        assert.equal(options.headers['X-CampusPool-QA-Token'],TOKEN);
        assert.ok(body.channel==='sms'||body.channel==='email');
        assert.equal(body.channel==='sms'?body.target===PHONE:body.target===EMAIL,true);
        return payload(200,{success:true,otp:'123456'});
      case '/api/auth/verify-email-otp':
        return body.isLoginFlow?
          payload(200,{success:true,isLogin:true},true):
          payload(200,{success:true,emailToken:'e'.repeat(43)});
      case '/api/auth/send-phone-otp':
        return payload(200,{success:true});
      case '/api/auth/verify-phone-otp':
        return payload(200,{success:true,phoneToken:'p'.repeat(43)});
      case '/api/auth/register':
        return payload(201,{success:true},true);
      case '/api/auth/me':
        return payload(200,{success:true,user:{email:EMAIL}});
      default:throw Error('UNEXPECTED_PATH');
    }
  };
  return {calls,fetchImpl};
}
test('fixture runner accepts only exact approved email, phone and staging credentials',()=>{
  assert.equal(config(ENV).email,EMAIL);
  for(const change of [
    {STAGING_QA_TEST_EMAIL:'random@students.mituniversity.edu.in'},
    {STAGING_QA_TEST_PHONE:'1111111111'},
    {STAGING_QA_READ_TOKEN:'weak'},
    {STAGING_BASE_URL:'https://mit-adt-campuspool.onrender.com'}
  ])assert.throws(()=>config({...ENV,...change}),/QA_FIXTURE_SECRETS_REQUIRED|STAGING_URL_NOT_APPROVED/);
});
test('automatic test OTP signup still passes through standard email/SMS verify routes',async()=>{
  const server=fakeServer({registered:false});
  const result=await runFixture({env:ENV,fetchImpl:server.fetchImpl,
    baseline:async()=>({status:'STAGING_READ_ONLY_ACCEPTANCE_PASS'})});
  assert.equal(result.status,'STAGING_FIXTURE_OTP_FLOW_PASS');
  assert.equal(result.flow,'registration');
  assert.equal(result.realEmailOrSmsSent,false);
  assert.equal(result.productionTouched,false);
  assert.ok(server.calls.some(x=>x.pathname==='/api/auth/verify-phone-otp'));
  assert.ok(server.calls.some(x=>x.pathname==='/api/auth/verify-email-otp'));
  assert.ok(server.calls.some(x=>x.pathname==='/api/auth/register'));
});
test('repeated acceptance checks authenticate the existing QA account normally',async()=>{
  const server=fakeServer({registered:true});
  const result=await runFixture({env:ENV,fetchImpl:server.fetchImpl,
    baseline:async()=>({status:'STAGING_READ_ONLY_ACCEPTANCE_PASS'})});
  assert.equal(result.flow,'login');
  assert.ok(server.calls.some(x=>x.pathname==='/api/auth/login-request'));
  assert.ok(server.calls.some(x=>x.pathname==='/api/auth/verify-email-otp'&&x.body.isLoginFlow));
  assert.ok(!server.calls.some(x=>x.pathname==='/api/auth/send-phone-otp'));
});
test('reject a missing QA receipt before any account registration',async()=>{
  const server=fakeServer({registered:false});
  const original=server.fetchImpl;
  const fetchImpl=async(url,options)=>url.endsWith('/api/_staging/qa-otp')?
    {status:404,json:async()=>({success:false}),headers:{get:()=>null}}:
    original(url,options);
  await assert.rejects(runFixture({env:ENV,fetchImpl,
    baseline:async()=>({status:'STAGING_READ_ONLY_ACCEPTANCE_PASS'})}),
    /STAGING_QA_RECEIPT_MISSING/);
});
