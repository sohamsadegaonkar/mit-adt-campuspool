'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('    // CAMPUSPOOL_MOTION_BEGIN');
const end=html.indexOf('    // CAMPUSPOOL_MOTION_END',start);
assert.ok(start>=0&&end>start,'isolated motion helpers exist');
const code=html.slice(start,end)+'\n globalThis.motion={seatTransitionsFromVerifiedFeed,seatIllustration,boardingPassMarkup,celebrateConfirmedBoardingPass,verifyAndCelebrateBookedSeat};';
function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');}
function fixture({bookings=[],session='session1',email='student@example.test'}={}){
  const cards=new Map(),classes=[];
  const context={
    Map,Array,Number,String,
    sanitize:escapeHtml,
    csrfToken:session,appState:{currentUser:{email}},
    document:{getElementById:(id)=>id==='passengerBookingsSection'?{querySelectorAll:()=>Array.from(cards.values())}:null},
    syncUserBookings:async()=>bookings,
  };
  vm.runInNewContext(code,context,{timeout:2000});
  return {motion:context.motion,context,cards,classes,addCard(id){
    const node={dataset:{bookingId:id},classList:{add:v=>classes.push(v)}};
    cards.set(id,node);return node;
  }};
}
const ride=(id,seats)=>({id,seatsLeft:seats,seatsTotal:4});
const pass=(fields={})=>({bookingId:'BKG-123456',pickup:'MIT ADT Gate',destination:'Pune Station',
  departureTime:'2027-01-01 17:00',vehicleModel:'Car',driverName:'Verified driver',
  paymentMode:'free_pilot',paymentStatus:'NoPaymentRequired',studentFare:0,...fields});
test('seat motion follows only a changed verified existing ride; initial arrivals do not animate',()=>{
  const f=fixture(), old=[ride('a',3),ride('b',2)];
  const changes=f.motion.seatTransitionsFromVerifiedFeed(old,[ride('a',2),ride('b',3),ride('c',3)]);
  assert.equal(changes.get('a'),'taken');assert.equal(changes.get('b'),'released');
  assert.equal(changes.has('c'),false);
  assert.equal(f.motion.seatTransitionsFromVerifiedFeed([],old).size,0);
  assert.equal(f.motion.seatTransitionsFromVerifiedFeed(old,old).size,0);
  assert.equal(f.motion.seatTransitionsFromVerifiedFeed(old,[{id:'a',seatsLeft:-1,seatsTotal:4}]).size,0);
});
test('illustrative seat count stays bounded and accessible count remains separate',()=>{
  const f=fixture();
  const marks=f.motion.seatIllustration(ride('a',2));
  assert.equal((marks.match(/cp-seat-mark/g)||[]).length,4);
  assert.equal((marks.match(/is-taken/g)||[]).length,2);
  assert.equal(f.motion.seatIllustration({seatsTotal:500,seatsLeft:1}),'');
});
test('boarding pass contains sanitized real details, not fabricated status, ETA, contacts or payment proof',()=>{
  const f=fixture();
  const card=f.motion.boardingPassMarkup(pass({pickup:'<script>alert(1)</script>',destination:'Station & Gate'}));
  assert.ok(card.includes('&lt;script&gt;'));assert.ok(card.includes('Station &amp; Gate'));
  assert.ok(!card.includes('<script>'));
  assert.ok(card.includes('No payment required'));assert.ok(card.includes('SEAT RESERVED'));
  assert.ok(!/Driver arrived|Journey complete|GPS active|ETA:/.test(card));
  const pending=f.motion.boardingPassMarkup(pass({paymentMode:'legacy',paymentStatus:'Pending',studentFare:42}));
  assert.ok(pending.includes('Payment pending · verification unavailable'));
  assert.ok(!pending.includes('No payment required'));
});
test('celebration requires fresh active booking and matching authenticated session',async()=>{
  const b=pass(),f=fixture({bookings:[b]});f.addCard(b.bookingId);
  assert.equal(await f.motion.verifyAndCelebrateBookedSeat(b.bookingId,'student@example.test','session1'),true);
  assert.deepEqual(f.classes,['cp-pass-confirmed']);
  const g=fixture({bookings:[]});g.addCard(b.bookingId);
  assert.equal(await g.motion.verifyAndCelebrateBookedSeat(b.bookingId,'student@example.test','session1'),false);
  assert.deepEqual(g.classes,[]);
  const wrong=fixture({bookings:[b]});wrong.addCard(b.bookingId);
  assert.equal(await wrong.motion.verifyAndCelebrateBookedSeat(b.bookingId,'other@example.test','session1'),false);
});
test('late private response after logout or session change never celebrates',async()=>{
  const b=pass(),f=fixture();f.addCard(b.bookingId);
  let resolve;
  f.context.syncUserBookings=()=>new Promise(r=>resolve=r);
  const inFlight=f.motion.verifyAndCelebrateBookedSeat(b.bookingId,'student@example.test','session1');
  f.context.csrfToken='session2';
  f.context.appState.currentUser=null;
  resolve([b]);assert.equal(await inFlight,false);assert.deepEqual(f.classes,[]);
});
test('motion honors reduced-motion preference and does not simulate GPS or trip progress',()=>{
  assert.match(html,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html,/\.cp-pass-confirmed\{animation:cp-ticket-enter/);
  assert.match(html,/\.cp-seat-updated\s+\.cp-seat-visual/);
  assert.doesNotMatch(code,/setInterval|watchPosition|driverCoords|localStorage|sessionStorage/);
});
test('all classic inline scripts remain parseable',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
    if(!match[1].trim())continue;
    assert.doesNotThrow(()=>new vm.Script(match[1]));
  }
});
