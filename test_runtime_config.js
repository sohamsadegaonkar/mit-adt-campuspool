'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {
  privateSecret,privatePostgresUrl,certificateFile,checkRuntime,parseArgs
}=require('./scripts/check-runtime-config');

const otp='synthetic-otp-private-'.padEnd(64,'q');
const hmac='synthetic-hmac-private-'.padEnd(64,'r');
const prod={
  NODE_ENV:'production',OTP_SECRET:otp,
  EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-test-key-only',
  EMAIL_FROM:'CampusPool QA <noreply@example.org>',
  AUTH_OTP_BACKEND:'sqlite',RIDES_BACKEND:'sqlite',MOBILITY_MATCHING_ENABLED:'false'
};
const staging={
  NODE_ENV:'production',APP_ENV:'staging',OTP_SECRET:otp,
  AUTH_OTP_BACKEND:'postgres',RIDES_BACKEND:'postgres',
  MOBILITY_MATCHING_ENABLED:'false',OTP_HMAC_KEY:hmac,
  OTP_DB_SSL:'true',OTP_DATABASE_URL:
    'postgresql://postgres.synthetic:totally-fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  NODE_EXTRA_CA_CERTS:'/fake/path/campuspool-qa-ca.crt',
  STAGING_BASIC_AUTH_PASSWORD:'synthetic-basic-auth-only-for-tests',
  EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-resend-key',
  EMAIL_FROM:'noreply@example.org',SMS_PROVIDER:'disabled'
};
const fakeFs={
  statSync:value=>{
    if(value===staging.NODE_EXTRA_CA_CERTS)return {isFile:()=>true,size:512};
    throw Error('not found');
  }
};
const candidate={...staging,APP_ENV:'production',
  SMS_PROVIDER:'msg91',MSG91_AUTHKEY:'synthetic-msg91-only',
  MSG91_FLOW_TEMPLATE_ID:'synthetic-template-only',
  NODE_EXTRA_CA_CERTS:path.join(__dirname,'package.json')};
const codes=result=>result.failed.slice().sort();

test('legacy SQLite production config is blocked even with HTTPS email provider',()=>{
  const result=checkRuntime({target:'production',env:prod});
  assert.equal(result.status,'CONFIG_BLOCKED');
  for(const code of ['PRODUCTION_APP_ENV_EXPLICIT','POSTGRES_IDENTITY_BACKEND',
    'POSTGRES_RIDES_BACKEND','POSTGRES_TLS_ENABLED','SMS_MSG91_PROVIDER_CONFIGURED'])
    assert.ok(result.failed.includes(code),code);
  assert.ok(result.manual.includes('CONFIRM_HISTORICAL_CREDENTIALS_REVOKED'));
  assert.doesNotMatch(JSON.stringify(result),/synthetic-app-password|synthetic-otp-private/);
});

test('synthetic production PostgreSQL candidate passes only config checks, never manual release',()=>{
  const result=checkRuntime({target:'production',env:candidate});
  assert.equal(result.status,'CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED');
  assert.deepEqual(codes(result),[]);
  assert.ok(result.manual.includes('CONFIRM_ENCRYPTED_BACKUP_INDEPENDENT_RESTORE_AND_ROLLBACK'));
  assert.ok(result.manual.includes('PRODUCTION_DATABASE_MIGRATION_AND_ROLLBACK_UNVERIFIED'));
  assert.doesNotMatch(JSON.stringify(result),/synthetic-msg91|totally-fake|synthetic-hmac-private/);
});

test('missing, short or known compromised OTP secret cannot pass',()=>{
  for(const bad of [undefined,'', 'too-short']){
    const result=checkRuntime({target:'production',env:{...prod,OTP_SECRET:bad}});
    assert.ok(result.failed.includes('OTP_SECRET_STRONG_NOT_KNOWN_EXPOSED'));
  }
  assert.equal(privateSecret(otp),true);
  assert.equal(privateSecret('q'.repeat(32)),true);
  assert.equal(privateSecret('q'.repeat(31)),false);
  // The known-exposed value remains in no test fixture or log.
});

test('production rejects staging switch, SQLite fallback and early mobility enablement',()=>{
  const result=checkRuntime({target:'production',env:{
    ...candidate,APP_ENV:'staging',RIDES_BACKEND:'sqlite',
    AUTH_OTP_BACKEND:'sqlite',MOBILITY_MATCHING_ENABLED:'true'
  }});
  for(const code of ['PRODUCTION_APP_ENV_EXPLICIT','POSTGRES_IDENTITY_BACKEND',
    'POSTGRES_RIDES_BACKEND','MOBILITY_FLAG_OFF_UNTIL_PRIVACY_REVIEW'])
    assert.ok(result.failed.includes(code),code);
});

test('production requires HTTPS provider, verified sender metadata and not SMTP',()=>{
  const bad=checkRuntime({target:'production',env:{
    ...candidate,EMAIL_PROVIDER:'disabled',RESEND_API_KEY:'',EMAIL_FROM:''
  }});
  assert.ok(bad.failed.includes('TRANSACTIONAL_EMAIL_PROVIDER_CONFIGURED'));
  const brevo=checkRuntime({target:'production',env:{
    ...candidate,EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'synthetic-brevo-only',
    RESEND_API_KEY:''
  }});
  assert.deepEqual(brevo.failed,[]);
  const smtpOnly=checkRuntime({target:'production',env:{
    ...candidate,EMAIL_PROVIDER:'disabled',SMTP_USER:'test@example.org',SMTP_PASS:'fake',
    SMTP_HOST:'smtp.gmail.com'
  }});
  assert.ok(smtpOnly.failed.includes('TRANSACTIONAL_EMAIL_PROVIDER_CONFIGURED'));
});

test('production rejects disabled SMS, insecure DB, missing CA and shared secrets',()=>{
  const result=checkRuntime({target:'production',env:{
    ...candidate,SMS_PROVIDER:'disabled',OTP_DB_SSL:'false',
    OTP_DATABASE_URL:'postgresql://x:y@localhost:5432/postgres',
    OTP_HMAC_KEY:otp,NODE_EXTRA_CA_CERTS:'/missing'
  }});
  for(const code of ['SMS_MSG91_PROVIDER_CONFIGURED','POSTGRES_TLS_ENABLED',
    'POSTGRES_DATABASE_URL_PRIVATE_POOLER','OTP_HMAC_KEY_PRIVATE_AND_DISTINCT',
    'POSTGRES_CA_SECRET_FILE_PRESENT'])
    assert.ok(result.failed.includes(code),code);
});

test('valid staging Postgres configuration passes known checks but explicitly blocks promotion',()=>{
  const result=checkRuntime({target:'staging',env:staging,fsImpl:fakeFs});
  assert.deepEqual(result.failed,[]);
  assert.equal(result.status,'CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED');
  assert.ok(result.manual.includes('STAGING_SMS_OTP_DISABLED_CANNOT_VERIFY_COMPLETE_SIGNUP'));
  assert.ok(result.manual.includes('DATABASE_CONNECTIVITY_AND_CA_TRUST_NOT_TESTED'));
  assert.doesNotMatch(JSON.stringify(result),/totally-fake|synthetic-resend-key|synthetic-basic-auth/);
});

test('staging rejects insecure DB transport, absent private HMAC and basic authentication',()=>{
  const result=checkRuntime({target:'staging',fsImpl:fakeFs,env:{
    ...staging,OTP_DATABASE_URL:'postgresql://x:y@localhost:5432/postgres',
    OTP_DB_SSL:'false',OTP_HMAC_KEY:otp,STAGING_BASIC_AUTH_PASSWORD:'short',
    NODE_EXTRA_CA_CERTS:'/missing',EMAIL_PROVIDER:'disabled'
  }});
  for(const code of ['POSTGRES_DATABASE_URL_PRIVATE_POOLER','POSTGRES_TLS_ENABLED',
    'OTP_HMAC_KEY_PRIVATE_AND_DISTINCT','STAGING_BASIC_AUTH_PRIVATE',
    'POSTGRES_CA_SECRET_FILE_PRESENT','TRANSACTIONAL_EMAIL_PROVIDER_CONFIGURED'])
    assert.ok(result.failed.includes(code));
});

test('Postgres URLs accept documented Supabase poolers and reject TLS downgrade',()=>{
  assert.equal(privatePostgresUrl(staging.OTP_DATABASE_URL),true);
  assert.equal(privatePostgresUrl(staging.OTP_DATABASE_URL+'?sslmode=verify-full'),true);
  assert.equal(privatePostgresUrl(staging.OTP_DATABASE_URL+'?sslmode=disable'),false);
  assert.equal(privatePostgresUrl('postgresql://x:y@internal.database:5432/postgres'),false);
  assert.equal(privatePostgresUrl('postgresql://x:y@127.0.0.1:5432/postgres'),false);
  assert.equal(privatePostgresUrl('not-a-url'),false);
  assert.equal(privatePostgresUrl('postgresql://x:y@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'),false);
});

test('certificate stat checks do not read file or reveal its path in returned findings',()=>{
  assert.equal(certificateFile(staging.NODE_EXTRA_CA_CERTS,fakeFs),true);
  assert.equal(certificateFile('/missing',fakeFs),false);
  assert.equal(certificateFile('',fakeFs),false);
  const result=checkRuntime({target:'staging',env:{...staging,NODE_EXTRA_CA_CERTS:'/missing'},fsImpl:fakeFs});
  assert.ok(result.failed.includes('POSTGRES_CA_SECRET_FILE_PRESENT'));
  assert.doesNotMatch(JSON.stringify(result),/\/missing/);
});

test('MSG91 optional test mode checks configured credentials and never calls provider',()=>{
  const result=checkRuntime({target:'staging',env:{...staging,SMS_PROVIDER:'msg91'},fsImpl:fakeFs});
  assert.ok(result.failed.includes('SMS_PROVIDER_EXPLICITLY_SAFE'));
  const accepted=checkRuntime({target:'staging',env:{
    ...staging,SMS_PROVIDER:'msg91',MSG91_AUTHKEY:'test-only',MSG91_FLOW_TEMPLATE_ID:'test-flow'
  },fsImpl:fakeFs});
  assert.equal(accepted.failed.length,0);
});

test('target flags are explicit and CLI JSON contains no secret values or URLs',()=>{
  assert.deepEqual(parseArgs(['--target=production','--json']),{target:'production',json:true});
  assert.deepEqual(parseArgs(['--target','staging']),{target:'staging',json:false});
  assert.throws(()=>parseArgs([]),/TARGET_REQUIRED/);
  const file=path.join(__dirname,'scripts','check-runtime-config.js');
  const invoked=spawnSync(process.execPath,[file,'--target','production','--json'],
    {encoding:'utf8',env:{...process.env,...candidate}});
  assert.equal(invoked.status,0,invoked.stderr);
  const data=JSON.parse(invoked.stdout);
  assert.equal(data.status,'CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED');
  for(const secret of [otp,candidate.RESEND_API_KEY,candidate.EMAIL_FROM,candidate.OTP_HMAC_KEY]){
    assert.ok(!invoked.stdout.includes(secret),'secret value leaked to stdout');
    assert.ok(!invoked.stderr.includes(secret),'secret value leaked to stderr');
  }
  const blocked=spawnSync(process.execPath,[file,'--target','production','--json'],
    {encoding:'utf8',env:{...process.env,...candidate,OTP_SECRET:''}});
  assert.equal(blocked.status,1);
  assert.ok(JSON.parse(blocked.stdout).failed.includes('OTP_SECRET_STRONG_NOT_KNOWN_EXPOSED'));
  const bad=spawnSync(process.execPath,[file,'--target','unknown'],
    {encoding:'utf8',env:{...process.env,...candidate}});
  assert.equal(bad.status,2);
  assert.doesNotMatch(bad.stderr,/synthetic-otp-private/);
});
