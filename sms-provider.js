'use strict';

// Adapter for MSG91 DLT-approved Flow SMS templates. The template must use
// VAR1 for the six-digit OTP. Provider success means accepted for delivery,
// not a guarantee that the handset received it.
const FLOW_ENDPOINT = 'https://control.msg91.com/api/v5/flow';

function isConfigured(env = process.env) {
  return env.SMS_PROVIDER === 'msg91' &&
    Boolean(env.MSG91_AUTHKEY && env.MSG91_FLOW_TEMPLATE_ID);
}

async function sendOtpSms(phone10, otp, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!isConfigured(env)) throw new Error('SMS_PROVIDER_NOT_CONFIGURED');
  if (!/^[6-9][0-9]{9}$/.test(phone10) || !/^[0-9]{6}$/.test(otp)) {
    throw new Error('INVALID_SMS_PAYLOAD');
  }
  const response = await fetchImpl(FLOW_ENDPOINT, {
    method: 'POST',
    headers: {
      authkey: env.MSG91_AUTHKEY,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      template_id: env.MSG91_FLOW_TEMPLATE_ID,
      short_url: '0',
      recipients: [{ mobiles: '91' + phone10, VAR1: otp }]
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('SMS_PROVIDER_REJECTED');
  const payload = await response.json();
  if (!payload || payload.type !== 'success') throw new Error('SMS_PROVIDER_REJECTED');
  return { accepted: true, provider: 'msg91' };
}

module.exports = { isConfigured, sendOtpSms };
