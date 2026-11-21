'use strict';
// Transactional OTP email over HTTPS only. No Gmail SMTP fallback.
// Provider acceptance is not proof of final inbox delivery.
const API_URLS={resend:'https://api.resend.com/emails',brevo:'https://api.brevo.com/v3/smtp/email'};
function fromAddress(value){
  if(typeof value!=='string'||value.length>254||/[\r\n]/.test(value))return null;
  const match=value.trim().match(/^(?:([^<>]+)\s*<([^<>]+)>|([^<>]+))$/);
  if(!match)return null;
  const email=(match[2]||match[3]||'').trim();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return null;
  return {email,name:(match[1]||'CampusPool').trim()};
}
function configured(env=process.env){
  const kind=env.EMAIL_PROVIDER;
  if(!fromAddress(env.EMAIL_FROM))return false;
  return (kind==='resend'&&Boolean(env.RESEND_API_KEY&&!env.RESEND_API_KEY.includes('your_'))) ||
         (kind==='brevo'&&Boolean(env.BREVO_API_KEY&&!env.BREVO_API_KEY.includes('your_')));
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
}
async function sendEmail({to,subject,htmlContent,textContent},{env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!configured(env))throw Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  if(typeof to!=='string'||to.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to))throw Error('INVALID_RECIPIENT');
  if(typeof subject!=='string'||!subject||subject.length>180||/[\r\n]/.test(subject))throw Error('INVALID_SUBJECT');
  if(typeof htmlContent!=='string'||!htmlContent||htmlContent.length>60000)throw Error('INVALID_EMAIL_CONTENT');
  if(typeof textContent!=='string'||!textContent||textContent.length>6000)throw Error('INVALID_EMAIL_CONTENT');
  const provider=env.EMAIL_PROVIDER,from=fromAddress(env.EMAIL_FROM);
  const headers={'Content-Type':'application/json'};
  let payload;
  if(provider==='resend'){
    headers.Authorization='Bearer '+env.RESEND_API_KEY;
    payload={from:env.EMAIL_FROM,to:[to],subject,html:htmlContent,text:textContent};
  }else{
    headers['api-key']=env.BREVO_API_KEY;
    payload={sender:from,to:[{email:to}],subject,htmlContent,textContent};
  }
  let response;
  try{
    response=await fetchImpl(API_URLS[provider],{
      method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)
    });
  }catch(_){throw Error('EMAIL_PROVIDER_UNAVAILABLE');}
  if(!response.ok)throw Error('EMAIL_PROVIDER_REJECTED');
  let result;
  try{result=await response.json();}catch(_){throw Error('EMAIL_PROVIDER_REJECTED');}
  if(provider==='resend'?!result?.id:!result?.messageId)throw Error('EMAIL_PROVIDER_REJECTED');
  return {accepted:true,provider};
}
async function sendOtpEmail(target,code,{env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!configured(env))throw Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  if(!/^[0-9]{6}$/.test(code))throw Error('INVALID_OTP');
  const text='Your CampusPool verification code is '+code+'. It expires in 5 minutes. Do not share it.';
  const html='<main style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px">'+
    '<h1 style="font-size:22px">CampusPool verification</h1>'+
    '<p>Enter the following code to continue:</p>'+
    '<p style="font-size:32px;letter-spacing:6px;font-weight:800">'+escapeHtml(code)+'</p>'+
    '<p>Expires in 5 minutes. If you did not request this code, ignore this email.</p></main>';
  return sendEmail({to:target,subject:'Your CampusPool verification code',textContent:text,htmlContent:html},{env,fetchImpl});
}
module.exports={configured,sendEmail,sendOtpEmail,fromAddress};
