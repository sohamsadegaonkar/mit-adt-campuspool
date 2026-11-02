'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {handlePgAuth}=require('./stage1-otp/auth-routes');

function fakeHarness({enabled=true,existing=true}={}){
  const sent=[];
  const counts={throttle:[],issue:[],verify:[]};
  const email='tester@students.mituniversity.edu.in',phone='9876541230';
  const user={id:'fake',email,phone,name:'Private Student',isVerified:true};
  const identity={
    getProfileByIdentifier:async id=>existing && (id===email || id.replace(/\D/g,'').slice(-10)===phone)?user:null,
    checkUniqueness:async()=>({unique:true}),
    sessionForEmail:async()=> 'test-session-token'
  };
  const mailProvider={
    configured:()=>enabled,
    sendOtpEmail:async(to,code)=>{sent.push({to,code});return {accepted:true};}
  };
  const store={
    throttleLoginLookup:async req=>{counts.throttle.push(req);},
    issue:async req=>{counts.issue.push(req);await req.deliver({target:req.target,code:'719204'});return {expiresInSeconds:300};},
    verify:async req=>{counts.verify.push(req);return {ok:true,proof:'fake-verified-proof'};}
  };
  let signedIn=false;
  async function request(pathname,body){
    let status,payload;
    const handled=await handlePgAuth({pathname,method:'POST',parseBody:async()=>body,
      sendJson:(s,p)=>{status=s;payload=p;},
      db:{},identity,store,mailProvider,smsDeliveryProvider:{isConfigured:()=>false},
      getClientIp:()=> '192.0.2.51',setPostgresCookie:()=>{signedIn=true;return true;}
    });
    assert.equal(handled,true);
    return {status,...payload};
  }
  return {request,sent,counts,user,session:()=>signedIn};
}

test('known and unknown sign-in have identical public response and no account metadata',async()=>{
  const known=fakeHarness({existing:true}),unknown=fakeHarness({existing:false});
  const a=await known.request('/api/auth/login-request',{identifier:'tester@students.mituniversity.edu.in'});
  const b=await unknown.request('/api/auth/login-request',{identifier:'tester@students.mituniversity.edu.in'});
  assert.deepEqual(a,b);
  assert.equal(a.status,200);
  assert.equal(a.email,undefined);
  assert.equal(a.name,undefined);
  assert.equal(a.phone,undefined);
  assert.equal(known.sent.length,1);
  assert.equal(unknown.sent.length,0);
  assert.equal(known.counts.throttle.length,1);
  assert.equal(unknown.counts.throttle.length,1);
});

test('phone sign-in never reveals stored campus email in request response',async()=>{
  const h=fakeHarness();
  const start=await h.request('/api/auth/login-request',{identifier:'+91 98765 41230'});
  assert.equal(start.status,200);
  assert.equal(start.email,undefined);
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].to,h.user.email);
  // The canonical stored email is used for OTP challenge verification.
  const done=await h.request('/api/auth/verify-email-otp',{
    email:'+919876541230',otp:'719204',isLoginFlow:true
  });
  assert.equal(done.status,200);
  assert.equal(done.isLogin,true);
  assert.equal(h.counts.verify[0].purpose,'login');
  assert.equal(h.counts.verify[0].target,h.user.email);
  assert.equal(h.session(),true);
});

test('unknown sign-in cannot borrow a signup OTP proof to create a session',async()=>{
  const h=fakeHarness({existing:false});
  const sent=await h.request('/api/auth/login-request',{identifier:'nobody@students.mituniversity.edu.in'});
  assert.equal(sent.status,200);
  const result=await h.request('/api/auth/verify-email-otp',{
    email:'nobody@students.mituniversity.edu.in',otp:'719204',isLoginFlow:true
  });
  assert.equal(result.status,400);
  assert.equal(result.error,'INVALID_OR_EXPIRED_OTP');
  assert.equal(h.counts.verify.length,0);
  assert.equal(h.session(),false);
});

test('provider disabled gives same result for known and unknown login',async()=>{
  const a=fakeHarness({enabled:false,existing:true});
  const b=fakeHarness({enabled:false,existing:false});
  assert.deepEqual(
    await a.request('/api/auth/login-request',{identifier:'tester@students.mituniversity.edu.in'}),
    await b.request('/api/auth/login-request',{identifier:'tester@students.mituniversity.edu.in'})
  );
});

test('frontend never relies on account metadata from login-request responses',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const start=html.indexOf("const resp = await apiFetch('/api/auth/login-request'");
  const end=html.indexOf('REGISTER VIEW: Multi-step',start);
  assert.ok(start>0&&end>start);
  const handler=html.slice(start,end);
  assert.match(handler,/email: identifier/);
  assert.doesNotMatch(handler,/email: data\.email|name: data\.name|phone: data\.phone/);
  assert.doesNotMatch(handler,/Welcome back,/);
  assert.match(html,/isLoginFlow: appState\.pendingAuth\.isLoginFlow === true/);
});
