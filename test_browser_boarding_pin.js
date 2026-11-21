'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const begin=html.indexOf('// CAMPUSPOOL_BOARDING_BEGIN');
const end=html.indexOf('// CAMPUSPOOL_BOARDING_END',begin);
assert.ok(begin>=0&&end>begin);
const source=html.slice(begin,end)+
  '\nglobalThis.boarding={passengerPinMarkup,driverPinMarkup,boardingStatusMarkup,setRoster:function(items){driverJourneyBookings=items;driverJourneyBookingsKnown=true;}}';
const sanitize=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(enabled=true){
  const vmScope={appState:{boardingPinEnabled:enabled},sanitize};
  vm.runInNewContext(source,vmScope);
  return vmScope.boarding;
}
const booking=(change={})=>({bookingId:'BKG-a1234567-aaaa-4aaa-bbbb-cccccccccccc',
  rideId:'ride-123',passengerName:'CI passenger',journeyStage:'pickup_ready',
  boardedAt:null,...change});
test('default-off has no new passenger/driver UI',()=>{
  const ui=fixture(false);
  assert.equal(ui.passengerPinMarkup(booking()),'');
  assert.equal(ui.driverPinMarkup({id:'ride-123',journeyStage:'pickup_ready'}),'');
});
test('unverified passenger sees separate stage and opt-in private reveal',()=>{
  const ui=fixture();
  const text=ui.passengerPinMarkup(booking());
  assert.match(text,/Boarding not confirmed/);
  assert.match(text,/Show my boarding PIN/);
  assert.match(text,/after physically entering/);
  assert.match(text,/hidden aria-label=/);
  assert.doesNotMatch(text,/[0-9]{6}.*PIN verified/);
});
test('arrived driver report is not passenger boarding proof',()=>{
  const ui=fixture();
  const text=ui.passengerPinMarkup(booking({journeyStage:'arrived'}));
  assert.match(text,/boarding was not verified/);
  assert.doesNotMatch(text,/Show my boarding PIN/);
  const yes=ui.passengerPinMarkup(booking({journeyStage:'arrived',boardedAt:'2026-11-21T05:40:00Z'}));
  assert.match(yes,/Boarding confirmed/);
  assert.doesNotMatch(yes,/Show my boarding PIN/);
});
test('driver roster provides one independent input per unverified passenger',()=>{
  const ui=fixture();
  ui.setRoster([booking(),booking({bookingId:'BKG-b1234567-aaaa-4aaa-bbbb-cccccccccccc',
    passengerName:'CI passenger 2',boardedAt:'2026-11-21T05:40:00Z'})]);
  const text=ui.driverPinMarkup({id:'ride-123',journeyStage:'pickup_ready'});
  assert.match(text,/Passenger boarding/);
  assert.match(text,/Verify boarding/);
  assert.match(text,/Boarding PIN verified/);
  assert.equal((text.match(/class="cp-driver-boarding-form"/g)||[]).length,1);
  assert.doesNotMatch(text,/data-pin=/);
});
test('user supplied name is escaped and no PIN leaves render helper',()=>{
  const ui=fixture();
  ui.setRoster([booking({passengerName:'<img src=x onerror=alert(1)>'})]);
  const text=ui.driverPinMarkup({id:'ride-123',journeyStage:'pickup_ready'});
  assert.ok(!text.includes('<img'));
  assert.ok(text.includes('&lt;img'));
  assert.doesNotMatch(source,/sessionStorage|localStorage|fetch\(|navigator\.geolocation/);
});
test('all inline application scripts remain syntactically valid',()=>{
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
    if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
});
test('PIN focus, accessible label and reduced-motion CSS contract',()=>{
  assert.ok(html.includes('id="campuspool-boarding-pin"'));
  assert.ok(html.includes('@media (prefers-reduced-motion:reduce)'));
  assert.ok(html.includes('secret.focus()'));
  assert.ok(html.includes('aria-label="Six-digit boarding PIN for'));
});
