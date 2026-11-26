'use strict';
const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const origin='https://127.0.0.1:4199';
const dir=process.env.REGISTRATION_FIXTURE_DIR;
const db=new URL(process.env.OTP_DATABASE_URL||'http://invalid');
if(process.env.QA_DISPOSABLE_REGISTRATION!=='YES'||db.hostname!=='127.0.0.1'||db.pathname!=='/campuspool_registration_browser_test'||!dir)
  throw Error('Disposable test environment required');
const options={ignoreHTTPSErrors:true,serviceWorkers:'block',httpCredentials:{origin,username:'staging',password:'synthetic-registration-browser-basic-not-live'}};
const cookieName='__Host-cp_registration';
const code=(channel,target)=>fs.readFileSync(path.join(dir,crypto.createHash('sha256').update(channel+':'+target).digest('hex')),'utf8');
const email=()=>crypto.randomBytes(10).toString('hex')+'@students.mituniversity.edu.in';
const phone=()=> '9'+String(crypto.randomInt(100000000,999999999));
async function open(context){
  const page=context.pages()[0]||await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  // This suite verifies auth, not CDN/map availability. The app includes
  // embedded CSS and gracefully tolerates Leaflet absence.
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    return u.origin===origin?route.continue():route.abort();
  });
  page.on('pageerror',()=>console.log('[registration-browser] page script error (details omitted)'));
  page.on('response',r=>{
    const u=new URL(r.url());
    if(u.origin===origin&&u.pathname.startsWith('/api/auth/'))
      console.log('[registration-browser]',r.request().method(),u.pathname,r.status());
  });
  await test.step('navigate to real staging fixture',async()=>{
    const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:20000});
    expect(response.status()).toBe(200);
    await expect.poll(()=>page.evaluate(()=>typeof window.CampusRegistrationUI?.setMode)).toBe('function');
  });
  await test.step('open registration panel',async()=>{
    // New visitors encounter the onboarding dialog; returning persistent
    // profiles have already dismissed it. Follow the actual user path.
    const seen=await page.evaluate(()=>localStorage.getItem('mit_adt_campuspool_onboarding_seen')==='true');
    if(!seen){
      await expect(page.locator('#welcomePopModal')).toBeVisible();
      await page.locator('#welcomeRegisterBtn').click();
      await expect(page.locator('#welcomePopModal')).toBeHidden();
    }else{
      await expect(page.locator('#welcomePopModal')).toBeHidden();
      await page.locator('#headerLoginBtn').click();
      await page.locator('#tabAuthRegister').click();
    }
    await expect(page.locator('#authModal')).toBeVisible();
    await expect(page.locator('#resumeEmail')).toBeVisible();
    await expect(page.locator('#resumeSaveContacts')).toBeEnabled();
  });
  return page;
}
async function post(page,route,body={},headers={'X-Registration-Request':'1','Content-Type':'application/json'}){
  return page.evaluate(async({route,body,headers})=>{
    const response=await fetch('/api/auth/'+route,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    return {status:response.status,data:await response.json()};
  },{route,body,headers});
}
async function clickResponse(page,id,route,status){
  return test.step(route+' expects HTTP '+status,async()=>{
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/'+route)&&r.request().method()==='POST',{timeout:15000}),page.locator('#'+id).click({timeout:12000})]);
    expect(r.status()).toBe(status);
    const data=await r.json();
    // The UI asynchronously updates state after the response, including error recovery.
    await expect(page.locator('#resumeRegistrationView')).toHaveAttribute('aria-busy','false');
    return data;
  });
}
async function fillContacts(page,e,p){
  await page.locator('#resumeEmail').fill(e);
  await page.locator('#resumePhone').fill(p);
  await clickResponse(page,'resumeSaveContacts','registration-start',201);
}
test('real HTTPS browser: persistent cookie, partial access denial, recovery rotation and completion',async({browser})=>{
  const e=email(),p=phone(),profile=fs.mkdtempSync(path.join(dir,'chrome-'));
  let original=await chromium.launchPersistentContext(profile,options);
  let recovered;
  const pool=new Pool({connectionString:db.href});
  try{
    let page=await open(original);
    expect((await post(page,'registration-start',{email:e,phone:p},{'Content-Type':'application/json'})).status).toBe(403);
    await fillContacts(page,e,p);
    await expect(page.locator('#resumeEmailStatus')).toContainText('pending');
    await expect(page.locator('#resumePhoneStatus')).toContainText('pending');
    const first=(await original.cookies(origin)).find(c=>c.name===cookieName);
    expect(first).toMatchObject({secure:true,httpOnly:true,sameSite:'Strict',path:'/'});
    expect(first.expires).toBeGreaterThan(Date.now()/1000);
    expect(await page.evaluate(()=>document.cookie)).not.toContain(cookieName);
    expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(first.value);
    const sent=await clickResponse(page,'resumeSendEmail','send-email-otp',200);
    expect(sent.success).toBe(true);
    await page.locator('#resumeEmailCode').fill(code('email',e));
    const verified=await clickResponse(page,'resumeVerifyEmail','verify-email-otp',200);
    expect(verified.registration.emailVerified).toBe(true);
    expect(verified).not.toHaveProperty('proof');
    await expect(page.locator('#resumeEmailStatus')).toContainText('verified');
    fs.writeFileSync(path.join(dir,'sms-down'),'synthetic outage');
    await clickResponse(page,'resumeSendPhone','send-phone-otp',503);
    await expect(page.locator('#resumeEmailStatus')).toContainText('verified');
    await expect(page.locator('#resumePhoneStatus')).toContainText('pending');
    await expect(page.locator('#resumeFinalize')).toBeDisabled();
    expect((await post(page,'register',{name:'Browser Student',dept:'Computing'})).status).toBe(403);
    expect((await page.request.get(origin+'/api/auth/me')).status()).toBe(401);
    expect((await page.request.get(origin+'/api/rides')).status()).toBe(401);
    expect((await pool.query('SELECT count(*)::int AS n FROM campus_users WHERE email=$1',[e])).rows[0].n).toBe(0);
    await original.close();
    original=await chromium.launchPersistentContext(profile,options);
    page=await open(original);
    await expect(page.locator('#resumeEmailStatus')).toContainText('verified');
    await expect(page.locator('#resumePhoneStatus')).toContainText('pending');
    expect((await original.cookies(origin)).find(c=>c.name===cookieName).value).toBe(first.value);
    recovered=await browser.newContext(options);
    const secondPage=await open(recovered);
    await expect(secondPage.locator('#resumeRecovery')).toBeVisible();
    await secondPage.locator('#resumeRecoveryTarget').fill(e);
    await clickResponse(secondPage,'resumeRecoverySend','registration-recovery-request',200);
    const freshCode=code('email',e);
    await secondPage.locator('#resumeRecoveryCode').fill(freshCode==='100000'?'100001':'100000');
    await clickResponse(secondPage,'resumeRecoveryVerify','registration-recovery-verify',403);
    await secondPage.locator('#resumeRecoveryCode').fill(freshCode);
    const restored=await clickResponse(secondPage,'resumeRecoveryVerify','registration-recovery-verify',200);
    expect(restored.registration.emailVerified).toBe(true);
    expect(restored).not.toHaveProperty('resumeToken');
    const second=(await recovered.cookies(origin)).find(c=>c.name===cookieName);
    expect(second.value).not.toBe(first.value);
    expect((await post(page,'registration-status')).data.registration).toBeNull();
    expect((await post(page,'registration-recovery-verify',{channel:'email',target:e,otp:freshCode})).status).toBe(403);
    fs.rmSync(path.join(dir,'sms-down'),{force:true});
    await clickResponse(secondPage,'resumeSendPhone','send-phone-otp',200);
    await secondPage.locator('#resumePhoneCode').fill(code('sms',p));
    await clickResponse(secondPage,'resumeVerifyPhone','verify-phone-otp',200);
    await expect(secondPage.locator('#resumePhoneStatus')).toContainText('verified');
    await secondPage.locator('#resumeName').fill('Browser Student');
    await clickResponse(secondPage,'resumeFinalize','register',201);
    await expect(secondPage.locator('#authModal')).toBeHidden();
    expect((await secondPage.request.get(origin+'/api/auth/me')).status()).toBe(200);
    expect((await recovered.cookies(origin)).some(c=>c.name===cookieName)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM campus_users WHERE email=$1 AND is_verified=true',[e])).rows[0].n).toBe(1);
  }finally{
    fs.rmSync(path.join(dir,'sms-down'),{force:true});
    await original.close().catch(()=>{});
    if(recovered)await recovered.close().catch(()=>{});
    await pool.end();
  }
});
test('mobile-first recovery requires verified channel and draft creation is rate limited',async({browser})=>{
  const context=await browser.newContext(options),other=await browser.newContext(options);
  const e=email(),p=phone();
  try{
    const page=await open(context);
    await fillContacts(page,e,p);
    await clickResponse(page,'resumeSendPhone','send-phone-otp',200);
    await page.locator('#resumePhoneCode').fill(code('sms',p));
    await clickResponse(page,'resumeVerifyPhone','verify-phone-otp',200);
    await expect(page.locator('#resumeEmailStatus')).toContainText('pending');
    const fresh=await open(other);
    await fresh.locator('#resumeRecoveryTarget').fill(e);
    await clickResponse(fresh,'resumeRecoverySend','registration-recovery-request',200);
    expect(fs.existsSync(path.join(dir,crypto.createHash('sha256').update('email:'+e).digest('hex')))).toBe(false);
    await fresh.locator('#resumeRecoveryCode').fill('123456');
    await clickResponse(fresh,'resumeRecoveryVerify','registration-recovery-verify',403);
    await expect(fresh.locator('#resumeRecovery')).toBeVisible();
    await fresh.locator('#resumeRecoveryChannel').selectOption('sms');
    await fresh.locator('#resumeRecoveryTarget').fill(p);
    await clickResponse(fresh,'resumeRecoverySend','registration-recovery-request',200);
    await fresh.locator('#resumeRecoveryCode').fill(code('sms',p));
    await clickResponse(fresh,'resumeRecoveryVerify','registration-recovery-verify',200);
    await expect(fresh.locator('#resumePhoneStatus')).toContainText('verified');
    await expect(fresh.locator('#resumeEmailStatus')).toContainText('pending');
    await expect(fresh.locator('#resumeFinalize')).toBeDisabled();
    expect((await post(page,'registration-status')).data.registration).toBeNull();
    const statuses=[];
    for(let i=0;i<6;i++){
      await context.clearCookies();
      statuses.push((await post(page,'registration-start',{email:email(),phone:phone()})).status);
    }
    expect(statuses).toContain(429);
  }finally{await Promise.allSettled([context.close(),other.close()]);}
});
