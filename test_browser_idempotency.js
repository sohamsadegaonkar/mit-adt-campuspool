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
  '\n globalThis.__test = {apiFetch, clearPendingDomainMutations};';

function environment({ storage, clock, user='driver@students.example', send }) {
  const captured=[];
  const events=[];
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
    fetch:async (url,options)=>{
      captured.push({url,key:options.headers.get('Idempotency-Key')});
      return send(url,options);
    }
  };
  vm.runInNewContext(snippet,scope,{timeout:2000});
  return {api:scope.__test, captured, events, scope};
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
