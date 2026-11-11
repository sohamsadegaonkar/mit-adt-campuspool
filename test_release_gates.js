'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {inspect}=require('./scripts/check-release-gates');
test('Release gate source checks pass for the reviewed feature branch',()=>{
  const result=inspect({mode:'ci'});
  assert.deepEqual(result.failed,[],result.failed.join('; '));
  assert.equal(result.ready,true);
});
test('Production promotion blocks disabled email/SMS, missing credentials and local rides database',()=>{
  const result=inspect({mode:'production',env:{}});
  assert.equal(result.ready,false);
  assert.ok(result.failed.some(x=>x.includes('PostgreSQL')));
  assert.ok(result.failed.some(x=>x.includes('HTTPS Resend/Brevo email provider')));
  assert.ok(result.failed.some(x=>x.includes('transactional SMS')));
  assert.ok(result.failed.some(x=>x.includes('Rides and bookings')));
});
test('Even with all identity and provider config, production requires durable Rides backend and manual review',()=>{
  const fake={NODE_ENV:'production',APP_ENV:'production',AUTH_OTP_BACKEND:'postgres',OTP_DB_SSL:'true',
    OTP_HMAC_KEY:'x'.repeat(64),OTP_SECRET:'y'.repeat(64),
    NODE_EXTRA_CA_CERTS:path.join(__dirname,'package.json'),
    OTP_DATABASE_URL:'postgresql://test:fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    EMAIL_PROVIDER:'resend',RESEND_API_KEY:'fake',EMAIL_FROM:'test@verified.example',
    SMS_PROVIDER:'msg91',MSG91_AUTHKEY:'fake',MSG91_FLOW_TEMPLATE_ID:'fake'};
  const result=inspect({mode:'production',env:fake});
  assert.equal(result.ready,false);
  assert.ok(result.failed.some(x=>x.includes('Rides and bookings')));
  assert.ok(result.passed.includes('Configured HTTPS Resend/Brevo email provider and sender present'));
  const brevo=inspect({mode:'production',env:{
    ...fake,EMAIL_PROVIDER:'brevo',RESEND_API_KEY:'',BREVO_API_KEY:'synthetic-brevo-key'
  }});
  assert.ok(brevo.passed.includes('Configured HTTPS Resend/Brevo email provider and sender present'));
  const smtp=inspect({mode:'production',env:{
    ...fake,EMAIL_PROVIDER:'smtp',RESEND_API_KEY:'',SMTP_PASS:'synthetic-legacy-only'
  }});
  assert.ok(smtp.failed.includes('Configured HTTPS Resend/Brevo email provider and sender present'));
  const invalidSender=inspect({mode:'production',env:{...fake,EMAIL_FROM:'bad\\nBcc: x@example.org'}});
  assert.ok(invalidSender.failed.includes('Configured HTTPS Resend/Brevo email provider and sender present'));
  assert.ok(result.manual.length>=4);
});
