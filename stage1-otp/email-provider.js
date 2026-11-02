'use strict';
// API-based transactional email, separate from personal Gmail SMTP credentials.
const API_URL='https://api.resend.com/emails';

function configured(env=process.env) {
  return env.EMAIL_PROVIDER==='resend' && !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
}
async function sendOtpEmail(target,code,{env=process.env,fetchImpl=globalThis.fetch}={}) {
  if(!configured(env)) throw Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  if(!/^[0-9]{6}$/.test(code)) throw Error('INVALID_OTP');
  if(typeof target!=='string'||target.length>254) throw Error('INVALID_RECIPIENT');
  const text='Your CampusPool verification code is '+code+'. It expires in 5 minutes. Do not share it.';
  const html='<main style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px">'+
    '<h1 style="font-size:22px">CampusPool verification</h1>'+
    '<p>Enter the following code to continue:</p>'+
    '<p style="font-size:32px;letter-spacing:6px;font-weight:800">'+escapeHtml(code)+'</p>'+
    '<p>Expires in 5 minutes. If you did not request this code, ignore this email.</p></main>';
  const response=await fetchImpl(API_URL,{
    method:'POST',
    headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:env.EMAIL_FROM,to:[target],subject:'Your CampusPool verification code',text,html}),
    signal:AbortSignal.timeout(8000)
  });
  if(!response.ok) throw Error('EMAIL_PROVIDER_REJECTED');
  const result=await response.json();
  if(!result?.id) throw Error('EMAIL_PROVIDER_REJECTED');
  return {accepted:true,provider:'resend'};
}
module.exports={configured,sendOtpEmail};
