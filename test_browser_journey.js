'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('// CAMPUSPOOL_JOURNEY_BEGIN'),end=html.indexOf('// CAMPUSPOOL_JOURNEY_END',start);
assert.ok(start>=0&&end>start);
const snippet=html.slice(start,end)+'\nglobalThis.journey={journeyRank,nextJourneyAction,journeyStageSnapshot,verifiedJourneyAdvances,journeyTimelineMarkup,recordVerifiedJourneySnapshot,get readReady(){return journeyReadReady;},get seen(){return seenJourneyStages;},get changes(){return pendingJourneyAnimations;}}';
const escape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(enabled=true){
  const scope={Map,Number,Array,Date,sanitize:escape,appState:{journeyEnabled:enabled}};
  vm.runInNewContext(snippet,scope);
  return scope.journey;
}
const ride=(stage,id='ride-one')=>({id,rideId:id,journeyStage:stage,
  departedAt:'2026-11-21T05:02:00Z',pickupAt:'2026-11-21T05:04:00Z',arrivedAt:'2026-11-21T05:08:00Z'});
test('closed ordered journey stages and driver controls',()=>{
  const j=fixture();
  assert.deepEqual(['scheduled','departed','pickup_ready','arrived'].map(j.journeyRank),[0,1,2,3]);
  assert.deepEqual(['scheduled','departed','pickup_ready','arrived'].map(j.nextJourneyAction),['depart','pickup','arrive',null]);
});
test('initial server snapshot is static; only a later advance animates',()=>{
  const j=fixture();
  j.recordVerifiedJourneySnapshot([ride('scheduled')],[]);
  assert.equal(j.readReady,true);assert.equal(j.changes.size,0);
  j.recordVerifiedJourneySnapshot([ride('departed')],[]);
  assert.equal(j.changes.get('ride-one').from,0);
  assert.equal(j.changes.get('ride-one').to,1);
  j.recordVerifiedJourneySnapshot([ride('departed')],[]);
  assert.equal(j.changes.size,0);
});
test('new, missing, backwards and unchanged records cannot animate',()=>{
  const j=fixture();
  const old=j.journeyStageSnapshot([ride('pickup_ready')]);
  const newer=j.journeyStageSnapshot([ride('departed'),ride('arrived','new-id')]);
  assert.equal(j.verifiedJourneyAdvances(old,newer).size,0);
});
test('timestamp and state are server-supplied; illustrative car is NOT GPS data',()=>{
  const j=fixture();
  const view=j.journeyTimelineMarkup(ride('pickup_ready'),{from:1,to:2});
  assert.ok(view.includes('Driver-reported milestone'));
  assert.ok(view.includes('Pickup ready'));
  assert.ok(view.includes('--cp-stage:66.6666'));
  assert.ok(view.includes('cp-journey-advanced'));
  assert.ok(!/GPS active|ETA|verified arrival|payment paid/i.test(view));
});
test('malicious stage text is not injected; disabled feature renders nothing',()=>{
  const j=fixture();
  const htmlView=j.journeyTimelineMarkup({...ride('scheduled'),journeyStage:'<img src=x onerror=alert(1)>'});
  assert.ok(!htmlView.includes('<img'));assert.ok(htmlView.includes('Seat ready'));
  assert.equal(fixture(false).journeyTimelineMarkup(ride('arrived')), '');
});
test('reduced-motion and parked-only consent; browser does not infer fake arrival',()=>{
  assert.ok(html.includes('@media (prefers-reduced-motion:reduce)'));
  assert.ok(html.includes("Report this milestone only while safely parked"));
  assert.doesNotMatch(snippet,/setInterval|navigator.geolocation|lat|lng|setTimeout|localStorage/);
});
test('all inline classic scripts compile after journey integration',()=>{
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
    if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
  }
});
