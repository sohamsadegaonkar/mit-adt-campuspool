'use strict';

// Explicitly gated Resend *simulated-delivery* sandbox probe.
// Never generates OTPs, uses production data, or emails an arbitrary recipient.
// Resend's published test recipient is delivered@resend.dev.
const {sendEmail}=require('../stage1-otp/email-provider');

const FROM='onboarding@resend.dev';
const TO='delivered@resend.dev';
const APPROVAL='SEND_ONE_RESEND_SIMULATED_EMAIL';

function preflight(env=process.env) {
  const errors=[];
  if(env.NODE_ENV==='production'||env.APP_ENV==='production') errors.push('PRODUCTION_CONTEXT_FORBIDDEN');
  if(typeof env.RESEND_API_KEY!=='string' ||
     !/^re_[A-Za-z0-9_-]{10,}$/.test(env.RESEND_API_KEY)) errors.push('RESEND_API_KEY_REQUIRED');
  return {ok:errors.length===0,errors};
}

async function run({argv=process.argv.slice(2),env=process.env,
                    sendImpl=sendEmail,log=line=>process.stdout.write(line+'\n')}={}) {
  if(argv.length!==1||!['--preflight','--execute'].includes(argv[0])) {
    log('USAGE --preflight|--execute');return 2;
  }
  const checks=preflight(env);
  if(!checks.ok) {
    for(const error of checks.errors) log('BLOCKED '+error);
    log('NO_EMAIL_SENT=YES');return 1;
  }
  if(argv[0]==='--preflight') {
    log('RESEND_SANDBOX_PREFLIGHT_PASSED=YES');
    log('REAL_KEY_VALIDITY_NOT_TESTED=YES');
    log('NO_EMAIL_SENT=YES');return 0;
  }
  if(env.OTP_RESEND_TEST_APPROVAL!==APPROVAL) {
    log('BLOCKED EXACT_SANDBOX_SEND_APPROVAL_REQUIRED');
    log('NO_EMAIL_SENT=YES');return 1;
  }
  // Deliberately do not use any arbitrary process.env recipient or FROM.
  const safeEnv={EMAIL_PROVIDER:'resend',EMAIL_FROM:FROM,RESEND_API_KEY:env.RESEND_API_KEY};
  try {
    const result=await sendImpl({
      to:TO,
      subject:'CampusPool sandbox simulated delivery (non-OTP)',
      htmlContent:'<p>CampusPool HTTPS sandbox test. This is not a real OTP or student email.</p>',
      textContent:'CampusPool HTTPS sandbox test. This is not a real OTP or student email.'
    },{env:safeEnv});
    if(!result?.accepted||result.provider!=='resend') {
      log('RESEND_SANDBOX_PROVIDER_NOT_ACCEPTED=YES');return 1;
    }
  }catch(_) {
    // No raw provider responses, addresses, request IDs or credentials in logs.
    log('RESEND_SANDBOX_PROVIDER_NOT_ACCEPTED=YES');return 1;
  }
  log('RESEND_SANDBOX_API_ACCEPTED=YES');
  log('SIMULATED_DELIVERY_ONLY_NOT_STUDENT_INBOX=YES');
  log('NO_OTP_NO_DATABASE_NO_AZURE_ACTION=YES');
  return 0;
}

if(require.main===module) {
  run().then(n=>{process.exitCode=n;}).catch(()=>{
    process.stderr.write('RESEND_SANDBOX_FAILED_REDACTED\n');
    process.exitCode=1;
  });
}

module.exports={run,preflight,FROM,TO,APPROVAL};
