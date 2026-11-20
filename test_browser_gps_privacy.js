'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
const start=html.indexOf('    function expireGpsMarkers('),end=html.indexOf('    async function toggleGpsSharing()',start);
assert.ok(start>=0&&end>start);
const snippet=html.slice(start,end)+'\n globalThis.checkGps={expireGpsMarkers,fetchLiveGpsUpdate};';
function fixture(){
  const clock={now:1000};let renders=0;const calls=[];
  const context={
    currentTrackingContext:{rideId:'synthetic',bookingId:'synthetic-book',driverCoords:[1,2],passengerCoords:[3,4],driverExpiresAt:1100,passengerExpiresAt:1200,speed:5},
    gpsEpoch:1,csrfToken:'test-session',gpsPolling:false,
    Date:class extends Date{static now(){return clock.now;}},
    AbortController,setTimeout,clearTimeout,
    apiFetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({location:null})};},
    updateTrackerView(){renders++;},gpsStatus(){}
  };
  vm.runInNewContext(snippet,context);
  return {context,clock,calls,renders:()=>renders,api:context.checkGps};
}
test('expired pins disappear on poll even with another fetch in progress',async()=>{
  const e=fixture();e.context.gpsPolling=true;e.clock.now=1100;
  await e.api.fetchLiveGpsUpdate();
  assert.equal(e.context.currentTrackingContext.driverCoords,null);
  assert.equal(e.context.currentTrackingContext.speed,0);
  assert.ok(e.context.currentTrackingContext.passengerCoords);
  assert.equal(e.calls.length,0);
  e.clock.now=1200;await e.api.fetchLiveGpsUpdate();
  assert.equal(e.context.currentTrackingContext.passengerCoords,null);
  assert.equal(e.renders(),2);
});
test('late old-session driver response cannot initiate passenger request or restore markers',async()=>{
  const e=fixture();let finish;
  e.context.apiFetch=async(...args)=>{e.calls.push(args);return new Promise(resolve=>{finish=resolve;});};
  const work=e.api.fetchLiveGpsUpdate();assert.equal(e.calls.length,1);
  e.context.gpsEpoch++;e.context.csrfToken='next-session';
  e.context.currentTrackingContext.driverCoords=null;
  finish({ok:true,json:async()=>({location:{lat:99,lng:99,expiresAt:9999}})});
  await work;assert.equal(e.calls.length,1);assert.equal(e.context.currentTrackingContext.driverCoords,null);
});
test('simulation does not publish via the live routes',()=>{
  assert.equal(html.includes('gpsSimulateToggleBtn'),false);
  assert.ok(html.includes("action:'start'"));
  assert.ok(html.includes("action:'stop'"));
});
