'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildIntentPayload,buildDriverRouteInput,candidateView,failureMessage}=require('./mobility-ui');

const NOW=Date.UTC(2026,10,3,12,0,0);
const iso=ms=>new Date(ms).toISOString();
const valid=()=>({
  pickupLat:'18.5103',pickupLon:'73.9232',
  dropoffLat:'18.4652',dropoffLon:'74.0181',
  earliest:iso(NOW+24*3600000),latest:iso(NOW+25*3600000)
});

test('travel-intent payload includes only exact server fields and respects 3h/7day limits',()=>{
  const payload=buildIntentPayload(valid(),NOW);
  assert.deepEqual(Object.keys(payload).sort(),[
    'dropoff','earliestDeparture','latestDeparture','pickup'
  ]);
  assert.deepEqual(payload.pickup,{lat:18.5103,lon:73.9232});
  assert.deepEqual(payload.dropoff,{lat:18.4652,lon:74.0181});
  assert.equal(payload.earliestDeparture,valid().earliest);
  for(const change of [
    {pickupLat:''},{pickupLon:''},{pickupLat:'NaN'},{pickupLat:'40'},
    {pickupLon:'99'},{dropoffLat:'0'},{dropoffLon:'bad'},
    {latest:valid().earliest},
    {latest:iso(NOW+28*3600000)},
    {earliest:iso(NOW-11*60000)},
    {earliest:iso(NOW+8*24*3600000)},
    {earliest:'not-a-date'}
  ]){
    assert.throws(()=>buildIntentPayload({...valid(),...change},NOW),JSON.stringify(change));
  }
});

test('driver opt-in adds exactly three private geo fields only with a valid route',()=>{
  const values={
    pickupLat:'18.5103',pickupLon:'73.9232',
    dropoffLat:'18.4652',dropoffLon:'74.0181',
    departureAt:iso(NOW+24*3600000)
  };
  const route=buildDriverRouteInput(values,NOW);
  assert.deepEqual(Object.keys(route).sort(),[
    'departureAt','destinationCoordinates','pickupCoordinates'
  ]);
  assert.deepEqual(route.pickupCoordinates,{lat:18.5103,lon:73.9232});
  assert.equal(route.departureAt,values.departureAt);
  for(const invalid of [
    {pickupLat:''},{dropoffLon:'99'},{departureAt:''},
    {departureAt:iso(NOW-11*60000)},{departureAt:iso(NOW+8*24*3600000)}
  ])assert.throws(()=>buildDriverRouteInput({...values,...invalid},NOW));
});

test('candidate cards only accept safe server candidate data, never copy private fields',()=>{
  const data={
    rideId:'d4fa22bc-9b63-4ee5-a772-5a3cf4d1bd32',
    vehicle:'Car',studentFare:40,seatsLeft:2,
    pickupDistanceMeters:101,dropoffDistanceMeters:225,
    departureAt:iso(NOW+24*3600000),
    candidateOnly:true,roadRouteVerificationRequired:true,
    driverEmail:'DO_NOT_RENDER@example.com',lat:18.5103,lon:73.9232,
    driverPhone:'DO_NOT_RENDER'
  };
  const result=candidateView(data);
  assert.ok(result);
  assert.equal(result.studentFare,40);
  assert.ok(!('driverEmail' in result));
  assert.ok(!('driverPhone' in result));
  assert.ok(!('lat' in result));
  assert.ok(!('lon' in result));
  assert.doesNotMatch(JSON.stringify(result),/DO_NOT_RENDER/);
  for(const change of [
    {candidateOnly:false},{roadRouteVerificationRequired:false},
    {rideId:'invalid-id'},{seatsLeft:0},{studentFare:-1},
    {pickupDistanceMeters:1501},{dropoffDistanceMeters:-1},
    {vehicle:'<script>'},{departureAt:'invalid'}
  ])assert.equal(candidateView({...data,...change}),null);
});

test('backend errors are generic and do not echo private server diagnostics',()=>{
  assert.match(failureMessage(401),/Sign in/);
  assert.match(failureMessage(409),/active travel request/);
  assert.match(failureMessage(429),/limit/);
  assert.match(failureMessage(404),/no longer available/);
  assert.doesNotMatch(failureMessage(500),/SQLException|password|Postgres/);
});

test('HTML is feature gated, keyboard accessible, and statically served by allowlist',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'mobility-ui.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  assert.match(html,/<section id="mobilityIntentPanel" hidden class="hidden /);
  assert.match(html,/<script src="\/mobility-ui\.js" defer><\/script>/);
  for(const id of ['mobilityIntentForm','mobilityPickupLat','mobilityPickupLon',
    'mobilityDropoffLat','mobilityDropoffLon','mobilityEarliest','mobilityLatest',
    'mobilitySearch','mobilityCancel','mobilityRefresh','mobilityMatches',
    'mobilityPickPickup','mobilityPickDropoff']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/campuspool:session-changed/);
  assert.match(html,/CampusPoolMobilityBookCandidate/);
  assert.match(html,/CampusPoolMobilityBuildRoute/);
  assert.ok(html.includes('Object.assign(ridePayload,window.CampusPoolMobilityBuildRoute'));
  assert.match(html,/id="offerMobilityGeoSection" hidden class="hidden /);
  for(const id of ['offerMobilityOptIn','offerMobilityFields','offerMobilityPickupLat',
    'offerMobilityPickupLon','offerMobilityDropoffLat','offerMobilityDropoffLon',
    'offerMobilityDepartureAt'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(js,/offerMobilityOptIn.*addEventListener/);
  assert.match(js,/clearDriverRoute/);
  assert.match(server,/'\/mobility-ui\.js'/);
  assert.match(js,/\/api\/mobility\/intent'/);
  assert.match(js,/\/api\/mobility\/intents'/);
  assert.match(js,/\/api\/mobility\/matches\?intentId=/);
  assert.match(js,/\/api\/mobility\/intents\/cancel'/);
  assert.match(js,/Idempotency-Key/);
  assert.doesNotMatch(js,/localStorage\.setItem|sessionStorage\.setItem|window\.open/);
});

test('public asset route is allowed without permitting arbitrary .js source files',()=>{
  const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  const marker=server.match(/const publicAssets = new Set\(\[([^\]]+)\]\)/);
  assert.ok(marker,'public asset allowlist exists');
  const allowed=marker[1].match(/'[^']+'/g).map(x=>x.slice(1,-1));
  assert.ok(allowed.includes('/mobility-ui.js'));
  assert.ok(!allowed.includes('/stage1-otp/mobility-store.js'));
  assert.ok(!allowed.includes('/server.js'));
});
