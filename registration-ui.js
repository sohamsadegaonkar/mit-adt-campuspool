'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const panel=el('resumeRegistrationView');
  if(!panel)return;
  const notice=el('resumeRegistrationNotice');
  let generation=0,mode='signin',draft=null,busy=false,enabled=false;
  const buttons=[...panel.querySelectorAll('button')];
  const value=id=>el(id).value.trim();
  const show=(id,visible)=>el(id).classList.toggle('hidden',!visible);
  const say=message=>{notice.textContent=message;};
  const statusText=(id,verified,label)=>{
    const node=el(id);
    node.textContent=label+(verified?' verified ✓':' pending');
    node.classList.toggle('text-emerald-400',verified);
    node.classList.toggle('text-amber-300',!verified);
  };
  function controls(){
    for(const button of buttons)button.disabled=busy;
    el('resumeFinalize').disabled=busy||!draft?.emailVerified||!draft?.phoneVerified;
    for(const [channel,verified] of [['Email',draft?.emailVerified],['Phone',draft?.phoneVerified]]){
      el('resumeSend'+channel).disabled=busy||!!verified;
      el('resumeVerify'+channel).disabled=busy||!!verified;
      el('resume'+channel+'Code').disabled=busy||!!verified;
    }
    panel.setAttribute('aria-busy',String(busy));
  }
  function render(state){
    draft=state||null;
    show('resumeVerification',!!draft);
    show('resumeRecovery',!draft);
    el('resumeSaveContacts').textContent=draft?'Update contacts':'Save contacts';
    if(draft){
      el('resumeEmail').value=draft.email;
      el('resumePhone').value=draft.phone;
      statusText('resumeEmailStatus',draft.emailVerified,'Email');
      statusText('resumePhoneStatus',draft.phoneVerified,'Mobile');
      el('resumeEmailCode').value='';
      el('resumePhoneCode').value='';
    }
    controls();
  }
  async function request(route,body={}){
    const response=await fetch('/api/auth/'+route,{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Registration-Request':'1'},body:JSON.stringify(body),cache:'no-store'});
    let data;
    try{data=await response.json();}catch{throw Error('Registration service unavailable.');}
    if(!response.ok)throw Error(data.message||'Registration could not be completed.');
    return data;
  }
  async function refresh(){
    const result=await request('registration-status');
    return result.registration;
  }
  function clearSensitive(){
    for(const id of ['resumeEmail','resumePhone','resumeEmailCode','resumePhoneCode','resumeName','resumeRecoveryTarget','resumeRecoveryCode'])
      el(id).value='';
    draft=null;
  }
  function setMode(next){
    const revision=++generation;
    mode=next;
    if(next!=='register'){
      panel.classList.add('hidden');
      clearSensitive();
      return;
    }
    // Do not allow legacy submission while discovering the new server feature.
    el('authRegisterView').classList.add('hidden');
    el('authStepIndicator').classList.add('hidden');
    panel.classList.remove('hidden');
    busy=true;controls();
    show('resumeRegistrationDetails',false);show('resumeVerification',false);show('resumeRecovery',false);
    say('Checking saved registration…');
    (async()=>{
      try{
        const response=await fetch('/api/auth/registration-config',{credentials:'same-origin',cache:'no-store'});
        if(!response.ok)throw Error('Registration configuration unavailable.');
        const config=await response.json();
        if(revision!==generation)return;
        if(config.enabled===false){
          enabled=false;
          panel.classList.add('hidden');
          el('authRegisterView').classList.remove('hidden');
          el('authStepIndicator').classList.remove('hidden');
          return;
        }
        if(config.enabled!==true)throw Error('Registration configuration unavailable.');
        enabled=true;
        const state=await refresh();
        if(revision!==generation)return;
        show('resumeRegistrationDetails',true);
        render(state);
        say(state?'Your saved verification progress is ready.':'Save your contacts to begin, or recover an existing registration.');
        el(state?'resumeName':'resumeEmail').focus();
      }catch(e){
        if(revision===generation)say('Could not load registration. Switch tabs and try again.');
      }finally{if(revision===generation){busy=false;controls();}}
    })();
  }
  function action(id,fn){
    el(id).addEventListener('click',async()=>{
      if(busy||!enabled||mode!=='register')return;
      const revision=generation;
      busy=true;controls();
      const active=()=>revision===generation&&mode==='register';
      try{await fn(active);}
      catch(e){
        if(!active())return;
        say(e.message||'Registration could not be completed.');
        // A response may have been lost after commit. Refresh without resending.
        try{const state=await refresh();if(active()&&state)render(state);}catch{}
      }finally{if(active()){busy=false;controls();}}
    });
  }
  const emailBody=()=>({email:draft.email,phone:draft.phone});
  action('resumeSaveContacts',async active=>{
    const data=await request(draft?'registration-contacts':'registration-start',{email:value('resumeEmail'),phone:value('resumePhone')});
    if(active()){render(data.registration);say('Contacts saved. Verify either pending contact.');}
  });
  action('resumeSendEmail',async active=>{
    await request('send-email-otp',emailBody());
    if(active())say('Email code requested. Check your university inbox.');
  });
  action('resumeSendPhone',async active=>{
    await request('send-phone-otp',{phone:draft.phone});
    if(active())say('SMS code requested. Check your mobile.');
  });
  action('resumeVerifyEmail',async active=>{
    const data=await request('verify-email-otp',{email:draft.email,otp:value('resumeEmailCode'),isLoginFlow:false});
    if(active()){render(data.registration);say('Email verified. Your progress is saved.');}
  });
  action('resumeVerifyPhone',async active=>{
    const data=await request('verify-phone-otp',{phone:draft.phone,otp:value('resumePhoneCode')});
    if(active()){render(data.registration);say('Mobile verified. Your progress is saved.');}
  });
  action('resumeRecoverySend',async active=>{
    await request('registration-recovery-request',{channel:value('resumeRecoveryChannel'),target:value('resumeRecoveryTarget')});
    if(active())say('If recovery is possible, a code has been requested. Check the selected contact.');
  });
  action('resumeRecoveryVerify',async active=>{
    const data=await request('registration-recovery-verify',{channel:value('resumeRecoveryChannel'),target:value('resumeRecoveryTarget'),otp:value('resumeRecoveryCode')});
    if(active()){
      el('resumeRecoveryCode').value='';el('resumeRecoveryTarget').value='';
      render(data.registration);say('Saved registration recovered. Continue with the pending steps.');
    }
  });
  action('resumeFinalize',async active=>{
    await request('register',{name:value('resumeName'),dept:value('resumeDept')});
    if(!active())return;
    if(typeof window.refreshSession!=='function'||!(await window.refreshSession()))
      throw Error('Account completion could not be confirmed. Sign in with your verified contact.');
    if(!active())return;
    window.renderUserHeader?.();
    await window.syncUserBookings?.();
    await window.syncLiveRides?.();
    window.closeAuthModal?.();
    window.showToast?.('Campus account verified and registered successfully.','✅');
  });
  const oldDept=el('inputStudentDept');
  if(oldDept)for(const option of oldDept.options)el('resumeDept').append(option.cloneNode(true));
  window.CampusRegistrationUI={setMode};
  if(el('tabAuthRegister')?.getAttribute('aria-selected')==='true')setMode('register');
})();
