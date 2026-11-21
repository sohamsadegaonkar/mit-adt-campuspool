'use strict';

// One-shot, opt-in provider acceptance probe. Does NOT generate/send OTPs,
// access application/production databases, or prove actual inbox receipt.
const {configured,fromAddress,sendEmail}=require('../stage1-otp/email-provider');

function validEmail(value) {
  return typeof value==='string' && value.length<=254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function preflight(env=process.env) {
  const failures=[];
  if(!configured(env)) failures.push('HTTPS_EMAIL_PROVIDER_NOT_CONFIGURED');
  if(!fromAddress(env.EMAIL_FROM)) failures.push('SENDER_INVALID');
  if(env.OTP_EMAIL_PROBE_SENDER_VERIFIED!=='YES') failures.push('SENDER_VERIFICATION_NOT_ATTESTED');
  if(env.OTP_EMAIL_PROBE_RECIPIENT_CONSENT!=='YES') failures.push('RECIPIENT_CONSENT_NOT_ATTESTED');
  if(!validEmail(env.OTP_EMAIL_PROBE_TO) ||
      env.OTP_EMAIL_PROBE_CONFIRM_TO!==env.OTP_EMAIL_PROBE_TO) {
    failures.push('EXACT_RECIPIENT_CONFIRMATION_REQUIRED');
  }
  return {ok:failures.length===0,failures};
}

async function run({argv=process.argv.slice(2),env=process.env,
                    sendImpl=sendEmail,write=line=>process.stdout.write(line+'\n')}={}) {
  const mode=argv.length===1?argv[0]:null;
  if(mode!=='--preflight' && mode!=='--execute') {
    write('USAGE: node scripts/otp-email-provider-probe.js --preflight|--execute');
    return 2;
  }
  const checks=preflight(env);
  if(!checks.ok) {
    for(const failure of checks.failures) write('BLOCKED '+failure);
    write('NO_EMAIL_SENT=YES');
    return 1;
  }
  if(mode==='--preflight') {
    write('EMAIL_PROVIDER_PREFLIGHT_PASSED=YES');
    write('SENDER_AND_CONSENT_ATTESTED_NOT_INDEPENDENTLY_VERIFIED=YES');
    write('NO_EMAIL_SENT=YES');
    return 0;
  }

  if(env.OTP_EMAIL_PROBE_APPROVED!=='SEND_ONE_NON_OTP_EMAIL') {
    write('BLOCKED EXACT_ONE_MESSAGE_APPROVAL_REQUIRED');
    write('NO_EMAIL_SENT=YES');
    return 1;
  }

  try {
    const result=await sendImpl({
      to:env.OTP_EMAIL_PROBE_TO,
      subject:'CampusPool HTTPS provider delivery test',
      textContent:'This is a single CampusPool email-provider test message. No verification code was issued. If you requested this test, confirm receipt privately.',
      htmlContent:'<p>This is a single CampusPool email-provider test message. No verification code was issued. If you requested this test, confirm receipt privately.</p>'
    },{env});
    if(!result?.accepted) {
      write('PROVIDER_NOT_ACCEPTED=YES');
      return 1;
    }
  } catch (_) {
    // Never display provider errors containing keys, recipients, response bodies,
    // addresses or other private metadata.
    write('PROVIDER_NOT_ACCEPTED=YES');
    return 1;
  }
  write('ONE_NON_OTP_EMAIL_PROVIDER_ACCEPTED=YES');
  write('ACTUAL_INBOX_RECEIPT_REQUIRES_OWNER_VERIFICATION=YES');
  write('NO_DATABASE_OR_OTP_USED=YES');
  return 0;
}

if(require.main===module) {
  run().then(code=>{process.exitCode=code;}).catch(()=>{
    process.stderr.write('EMAIL_PROBE_FAILED_WITHOUT_DETAILS\n');
    process.exitCode=1;
  });
}
module.exports={validEmail,preflight,run};
