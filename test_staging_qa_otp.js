'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {makeStagingQaOtp,STAGING_ID,STAGING_HOST}=
  require('./stage1-otp/staging-qa-otp');

const QA_EMAIL='qa-automation-fixture@students.mituniversity.edu.in';
const QA_PHONE='9876543219';
const TOKEN='synthetic-qa-reader-token-'.padEnd(58,'z');
function approved(){
  return {
    STAGING_QA_OTP_MODE:'fixture',NODE_ENV:'production',APP_ENV:'staging',
    RENDER_SERVICE_ID:STAGING_ID,RENDER_EXTERNAL_HOSTNAME:STAGING_HOST,
    RENDER_GIT_BRANCH:'staging',AUTH_OTP_BACKEND:'postgres',
    RIDES_BACKEND:'postgres',ENABLE_CLUSTER:'false',OTP_DB_SSL:'true',
    STAGING_BASIC_AUTH_PASSWORD:'synthetic-protected-staging-access-xxxxx',
    STAGING_QA_READ_TOKEN:TOKEN,STAGING_QA_TEST_EMAIL:QA_EMAIL,
    STAGING_QA_TEST_PHONE:QA_PHONE,
    OTP_SECRET:'different-synthetic-otp-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx',
    OTP_HMAC_KEY:'different-synthetic-hmac-secret-yyyyyyyyyyyyyyyyyyyyyy',
    EMAIL_PROVIDER:'disabled',SMS_PROVIDER:'disabled'
  };
}
test('QA OTP transport is disabled by default even in staging',()=>{
  assert.equal(makeStagingQaOtp({}).enabled,false);
  assert.equal(makeStagingQaOtp({...approved(),STAGING_QA_OTP_MODE:'off'}).enabled,false);
});
test('fixture mode fails closed outside exact staging Render identity, branch or guards',()=>{
  const good=approved();
  for(const change of [
    {NODE_ENV:'development'},{APP_ENV:'production'},
    {RENDER_SERVICE_ID:'srv-dbh51h0473hc739ae7cg'},
    {RENDER_EXTERNAL_HOSTNAME:'mit-adt-campuspool.onrender.com'},
    {RENDER_GIT_BRANCH:'main'},
    {AUTH_OTP_BACKEND:'sqlite'},{RIDES_BACKEND:'sqlite'},
    {OTP_DB_SSL:'false'},{ENABLE_CLUSTER:'true'},
    {STAGING_BASIC_AUTH_PASSWORD:'short'},
    {STAGING_QA_READ_TOKEN:'weak'},
    {STAGING_QA_READ_TOKEN:good.OTP_SECRET},
    {STAGING_QA_TEST_EMAIL:'someone@students.mituniversity.edu.in'},
    {STAGING_QA_TEST_PHONE:'1111111111'},
    {STAGING_QA_OTP_MODE:'production'}
  ]){
    assert.throws(()=>makeStagingQaOtp({...good,...change}),
      /STAGING_QA_OTP_CONFIGURATION_BLOCKED/,JSON.stringify(change));
  }
});
test('auto OTP delivers only explicit test fixtures and still produces ordinary codes',async()=>{
  let now=1000;
  const qa=makeStagingQaOtp(approved(),{clock:()=>now});
  assert.equal(qa.enabled,true);
  assert.equal(qa.mailProvider.configured(),true);
  assert.equal(qa.smsDeliveryProvider.isConfigured(),true);
  assert.deepEqual(await qa.mailProvider.sendOtpEmail(QA_EMAIL,'124578'),
    {accepted:true,provider:'staging-qa-fixture'});
  assert.deepEqual(await qa.smsDeliveryProvider.sendOtpSms(QA_PHONE,'603194'),
    {accepted:true,provider:'staging-qa-fixture'});
  assert.equal(qa.readOtp({channel:'email',target:QA_EMAIL,token:TOKEN}),'124578');
  assert.equal(qa.readOtp({channel:'sms',target:QA_PHONE,token:TOKEN}),'603194');
  assert.equal(qa.readOtp({channel:'email',target:QA_EMAIL,token:TOKEN+'x'}),null);
  assert.equal(qa.readOtp({channel:'email',target:'other@students.mituniversity.edu.in',token:TOKEN}),null);
  assert.equal(qa.readOtp({channel:'sms',target:'9999999999',token:TOKEN}),null);
  assert.equal(qa.readOtp({channel:'phone',target:QA_PHONE,token:TOKEN}),null);
  now+=300001;
  assert.equal(qa.readOtp({channel:'email',target:QA_EMAIL,token:TOKEN}),null);
  assert.equal(qa.readOtp({channel:'sms',target:QA_PHONE,token:TOKEN}),null);
});
test('non-fixture targets never use synthetic delivery; disabled real providers fail',async()=>{
  const qa=makeStagingQaOtp(approved());
  await assert.rejects(qa.mailProvider.sendOtpEmail(
    'person@students.mituniversity.edu.in','123456'),
    /EMAIL_PROVIDER_NOT_CONFIGURED/);
  await assert.rejects(qa.smsDeliveryProvider.sendOtpSms('9876543210','123456'),
    /SMS_PROVIDER_NOT_CONFIGURED/);
  assert.equal(qa.readOtp({channel:'email',
    target:'person@students.mituniversity.edu.in',token:TOKEN}),null);
});
test('the OTP receipt uses two independent gates, never a public bypass',()=>{
  const server=fs.readFileSync('server.js','utf8');
  assert.match(server,/STAGING_ONLY && pathname !== '\/healthz' && !validStagingBasicAuth/);
  assert.match(server,/stagingQaOtp\.enabled && pathname === '\/api\/_staging\/qa-otp'/);
  assert.match(server,/stagingQaOtp\.readOtp\(/);
  assert.match(server,/req\.headers\['x-campuspool-qa-token'\]/);
  assert.match(server,/store: pgOtpStore,identity:pgIdentity,setPostgresCookie/);
  assert.match(server,/QA_RECEIPT.*limit:8/);
  assert.doesNotMatch(server,/devOtpHint: .*STAGING_QA/);
});
