'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readConfig,runSmoke,BASE}=require('./scripts/staging-live-acceptance');
const SHA='a'.repeat(40), PASS='test-staging-basic-auth-not-a-real-password';
const ENV={STAGING_BASE_URL:BASE,STAGING_EXPECTED_SHA:SHA,
  STAGING_BASIC_AUTH_PASSWORD:PASS};
test('live acceptance is locked to one staging hostname and exact commit',()=>{
  assert.deepEqual(readConfig(ENV),{expected:SHA,pass:PASS});
  assert.throws(()=>readConfig({...ENV,STAGING_BASE_URL:'https://mit-adt-campuspool.onrender.com'}),
    /STAGING_URL_NOT_APPROVED/);
  assert.throws(()=>readConfig({...ENV,STAGING_EXPECTED_SHA:'main'}),
    /EXACT_DEPLOYED_SHA_REQUIRED/);
  assert.throws(()=>readConfig({...ENV,STAGING_BASIC_AUTH_PASSWORD:'bad'}),
    /STAGING_BASIC_AUTH_REQUIRED/);
});
test('live smoke checks public gate, session requirement and deployed SHA',async()=>{
  const requests=[];
  const fetchImpl=async(url,opts)=>{
    assert.ok(url.startsWith(BASE+'/'));
    assert.equal(opts.method,'GET');
    requests.push({url,authorized:Boolean(opts.headers.Authorization)});
    if(url.endsWith('/healthz'))return {
      status:200,json:async()=>({status:'healthy',environment:'staging',revision:SHA})};
    if(!opts.headers.Authorization)return {status:401};
    if(url.endsWith('/api/auth/me'))return {status:401};
    return {status:200};
  };
  const result=await runSmoke({env:ENV,fetchImpl});
  assert.equal(result.status,'STAGING_READ_ONLY_ACCEPTANCE_PASS');
  assert.equal(result.otpFixtureTested,false);
  assert.equal(result.productionTouched,false);
  assert.equal(requests.length,6);
});
test('refuse wrong deployment SHA and missing Basic gate',async()=>{
  const badSha=async(url)=>({status:200,json:async()=>({
    status:'healthy',environment:'staging',revision:'b'.repeat(40)})});
  await assert.rejects(runSmoke({env:ENV,fetchImpl:badSha}),
    /STAGING_COMMIT_MISMATCH/);
  const noBasic=async(url,opts)=>{
    if(url.endsWith('/healthz'))return {status:200,json:async()=>({
      status:'healthy',environment:'staging',revision:SHA})};
    return {status:200};
  };
  await assert.rejects(runSmoke({env:ENV,fetchImpl:noBasic}),
    /STAGING_PUBLIC_ACCESS_NOT_BLOCKED/);
});
