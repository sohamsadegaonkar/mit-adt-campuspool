'use strict';
// Browser retry lifecycle contract in a sandbox: no browser/network/staging writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const begin = html.indexOf('    const idempotentDomainRoutes = new Set([');
const end = html.indexOf('    async function refreshSession() {', begin);
assert.ok(begin >= 0 && end > begin, 'Browser retry code exists in index.html');
const snippet = html.slice(begin, end) +
  '\n globalThis.__test = {apiFetch, clearPendingDomainMutations, showMutationFailure};';

function environment({ storage, clock, user='driver@students.example', send }) {
  const captured=[];
  const events=[];
  const toasts=[];
  const scope={
    Event:class {constructor(type){this.type=type;}},
    window:{dispatchEvent(event){events.push(event.type);}},
    crypto:webcrypto, TextEncoder, Headers, Uint8Array, Set, Map,
    Date:class extends Date { static now(){ return clock.now; } },
    JSON, String, Number, Array,
    sessionStorage:{
      getItem:k=>storage.get(k)||null,
      setItem:(k,v)=>storage.set(k,v),
      removeItem:k=>storage.delete(k)
    },
    appState:{currentUser:{email:user},myBookings:[],myOfferedRides:[]},
    csrfToken:'f'.repeat(64),
    renderUserHeader(){},
    showToast(message,icon){toasts.push({message,icon});},
    fetch:async (url,options)=>{
      captured.push({url,key:options.headers.get('Idempotency-Key')});
      return send(url,options);
    }
  };
  vm.runInNewContext(snippet,scope,{timeout:2000});
  return {api:scope.__test, captured, events, toasts, scope};
}
const ridePayload=JSON.stringify({
  pickup:'Private Campus Gate',destination:'Private Station',vehicle:'Car'
});
const route='/api/rides', opts={method:'POST',body:ridePayload};
const ok=()=>({ok:true,status:201});
const rateLimited=()=>({ok:false,status:429});

test('uncertain dispatch persists retry key across a reload without storing student data',async()=>{
  const storage=new Map(),clock={now:1000000};
  const first=environment({storage,clock,send:async()=>{throw Error('network disconnected')}});
  await assert.rejects(first.api.apiFetch(route,opts),/network disconnected/);
  const key=first.captured[0].key;
  assert.match(key,/^[A-Za-z0-9_-]{16,128}$/);
  const serialized=Array.from(storage.values()).join('');
  assert.ok(serialized.includes(key));
  assert.equal(serialized.includes('Private Campus Gate'),false);
  assert.equal(serialized.includes('driver@students.example'),false);
  const reloaded=environment({storage,clock,send:async()=>ok()});
  await reloaded.api.apiFetch(route,opts);
  assert.equal(reloaded.captured[0].key,key);
  await reloaded.api.apiFetch(route,opts);
  assert.equal(reloaded.captured[1].key,key,'Immediate duplicate click reuses the receipt');
  clock.now+=1500;
  await reloaded.api.apiFetch(route,opts);
  assert.notEqual(reloaded.captured[2].key,key,'Confirmed separate action gets a new key');
});

test('429 keeps pending key while 4xx rejects it; actors are isolated',async()=>{
  const storage=new Map(),clock={now:1000000};
  const first=environment({storage,clock,send:async()=>rateLimited()});
  await first.api.apiFetch(route,opts);
  const key=first.captured[0].key;
  const same=environment({storage,clock,send:async()=>({ok:false,status:400})});
  await same.api.apiFetch(route,opts);
  assert.equal(same.captured[0].key,key);
  await same.api.apiFetch(route,opts);
  assert.notEqual(same.captured[1].key,key);
  const different=environment({storage,clock,user:'another@students.example',send:async()=>ok()});
  await different.api.apiFetch(route,opts);
  assert.notEqual(different.captured[0].key,same.captured[1].key);
});

test('401 and successful logout clear retry token cache',async()=>{
  const storage=new Map(),clock={now:1000000};
  const auth=environment({storage,clock,send:async()=>({ok:false,status:401})});
  await auth.api.apiFetch(route,opts);
  assert.equal(storage.size,0);
  assert.equal(auth.scope.appState.currentUser,null);
  assert.deepEqual(auth.events,['campuspool:session-changed']);
  const other=environment({storage,clock,send:async()=>rateLimited()});
  await other.api.apiFetch(route,opts);
  assert.ok(storage.size>0);
  other.api.clearPendingDomainMutations();
  assert.equal(storage.size,0);
});

test('explicit operation key stays untouched; 24-hour expired pending state is replaced',async()=>{
  const storage=new Map(),clock={now:1000000};
  const first=environment({storage,clock,send:async()=>rateLimited()});
  await first.api.apiFetch(route,opts);
  const key=first.captured[0].key;
  const explicit='caller_supplied_key_12345678';
  await first.api.apiFetch(route,{...opts,headers:{'Idempotency-Key':explicit}});
  assert.equal(first.captured[1].key,explicit);
  clock.now+=24*60*60*1000+1000;
  const after=environment({storage,clock,send:async()=>ok()});
  await after.api.apiFetch(route,opts);
  assert.notEqual(after.captured[0].key,key);
});


// Explicit dispatch barriers make ordering deterministic without real network.
function controlledRequests(){
  const requests=[];
  const observers=[];
  const send=()=>new Promise((resolve,reject)=>{
    requests.push({resolve,reject});
    for(const notify of observers.splice(0)) notify();
  });
  async function at(index){
    while(requests.length<=index) await new Promise(resolve=>observers.push(resolve));
    return requests[index];
  }
  return {send,at};
}

test('late rejection cannot delete the next generation after success grace expires',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000},net=controlledRequests();
  const e=environment({storage,clock,send:net.send});
  const a=e.api.apiFetch(route,opts);
  const reqA=await net.at(0);
  const b=e.api.apiFetch(route,opts);
  const reqB=await net.at(1);
  const original=e.captured[0].key;
  assert.equal(e.captured[1].key,original);
  reqA.resolve(ok());await a;
  clock.now+=1500;
  const c=e.api.apiFetch(route,opts);
  const reqC=await net.at(2);
  const current=e.captured[2].key;
  assert.notEqual(current,original);
  reqC.resolve(rateLimited());await c;
  reqB.resolve({ok:false,status:409});await b;
  const d=e.api.apiFetch(route,opts);
  const reqD=await net.at(3);
  assert.equal(e.captured[3].key,current);
  reqD.resolve(ok());await d;
});

test('late success cannot shorten the successor key lifetime',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000},net=controlledRequests();
  const e=environment({storage,clock,send:net.send});
  const a=e.api.apiFetch(route,opts);
  const reqA=await net.at(0);
  const b=e.api.apiFetch(route,opts);
  const reqB=await net.at(1);
  reqA.resolve(ok());await a;
  clock.now+=1500;
  const c=e.api.apiFetch(route,opts);
  const reqC=await net.at(2);
  const current=e.captured[2].key;
  reqC.resolve(rateLimited());await c;
  reqB.resolve(ok());await b;
  clock.now+=1500;
  const d=e.api.apiFetch(route,opts);
  const reqD=await net.at(3);
  assert.equal(e.captured[3].key,current);
  reqD.resolve(ok());await d;
});

test('overlapping definitive rejection cannot discard a still-unresolved sibling key',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000},net=controlledRequests();
  const e=environment({storage,clock,send:net.send});
  const a=e.api.apiFetch(route,opts);
  const reqA=await net.at(0);
  const b=e.api.apiFetch(route,opts);
  const reqB=await net.at(1);
  const original=e.captured[0].key;
  reqA.resolve({ok:false,status:403});await a;
  const c=e.api.apiFetch(route,opts);
  const reqC=await net.at(2);
  assert.equal(e.captured[2].key,original);
  reqB.resolve(ok());await b;
  reqC.resolve({ok:false,status:403});await c;
  const d=e.api.apiFetch(route,opts);
  const reqD=await net.at(3);
  assert.equal(e.captured[3].key,original);
  reqD.resolve(ok());await d;
});

test('uncertain sibling keeps the key even if the last overlapping response is a 4xx',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000},net=controlledRequests();
  const e=environment({storage,clock,send:net.send});
  const a=e.api.apiFetch(route,opts);
  const reqA=await net.at(0);
  const b=e.api.apiFetch(route,opts);
  const reqB=await net.at(1);
  const original=e.captured[0].key;
  reqA.reject(Error('network disconnected'));
  await assert.rejects(a,/network disconnected/);
  reqB.resolve({ok:false,status:400});await b;
  const c=e.api.apiFetch(route,opts);
  const reqC=await net.at(2);
  assert.equal(e.captured[2].key,original);
  reqC.resolve(ok());await c;
});

test('late 401 from an old session does not clear replacement session or keys',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000},net=controlledRequests();
  const e=environment({storage,clock,send:net.send});
  const a=e.api.apiFetch(route,opts);
  const reqA=await net.at(0);
  e.api.clearPendingDomainMutations();
  e.scope.appState.currentUser={email:'another@students.example'};
  e.scope.csrfToken='e'.repeat(64);
  const b=e.api.apiFetch(route,opts);
  const reqB=await net.at(1);
  const newKey=e.captured[1].key;
  reqB.resolve(rateLimited());await b;
  reqA.resolve({ok:false,status:401});await a;
  assert.equal(e.scope.appState.currentUser.email,'another@students.example');
  assert.equal(e.scope.csrfToken,'e'.repeat(64));
  assert.equal(e.events.length,0);
  const c=e.api.apiFetch(route,opts);
  const reqC=await net.at(2);
  assert.equal(e.captured[2].key,newKey);
  reqC.resolve(ok());await c;
});

test('session cleared while fingerprinting prevents dispatch',{timeout:5000},async()=>{
  const storage=new Map(),clock={now:1000000};
  const e=environment({storage,clock,send:async()=>ok()});
  const request=e.api.apiFetch(route,opts);
  e.api.clearPendingDomainMutations();
  await assert.rejects(request,/SESSION_CHANGED_BEFORE_DISPATCH/);
  assert.equal(e.captured.length,0);
  assert.equal(storage.size,0);
});

test('traffic mode uses bounded retry guidance, no automatic send and same key on manual retry',async()=>{
  const storage=new Map(),clock={now:1000000};
  const busy={ok:false,status:503,headers:new Headers({'Retry-After':'3'})};
  const e=environment({storage,clock,send:async()=>busy});
  const r=await e.api.apiFetch(route,opts);
  e.api.showMutationFailure(r,{error:'DB_POOL_BUSY'},'Fallback');
  assert.equal(e.toasts.length,1);
  assert.equal(e.toasts[0].message,'Oops, a campus traffic jam! Try the same action again in 3 seconds.');
  assert.equal(e.toasts[0].icon,'🚦');
  assert.equal(e.captured.length,1,'No automatic retry');
  const key=e.captured[0].key;
  const retry=environment({storage,clock,send:async()=>ok()});
  clock.now+=3000;
  await retry.api.apiFetch(route,opts);
  assert.equal(retry.captured[0].key,key);
});
test('traffic mode does not mask unrelated 503 or accept an unbounded wait',()=>{
  const e=environment({storage:new Map(),clock:{now:1000000},send:async()=>ok()});
  e.api.showMutationFailure({status:503,headers:new Headers({'Retry-After':'999999'})},{error:'DB_POOL_BUSY'},'Fallback');
  assert.match(e.toasts[0].message,/in a few seconds/);
  e.api.showMutationFailure({status:503,headers:new Headers()},{error:'EMAIL_PROVIDER_NOT_CONFIGURED',message:'Provider unavailable'},'Fallback');
  assert.equal(e.toasts[1].message,'Provider unavailable');
  assert.equal(e.toasts[1].icon,'⚠️');
});
