'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('// CAMPUSPOOL_PICKUP_BEGIN');
const marker=html.indexOf("    document.addEventListener('click',event=>{",start);
assert.ok(start>=0&&marker>start);
const source=html.slice(start,marker)+
 '\nglobalThis.pickup={pickupAbortMarkup,updatePickupWaitDisplays};';
const sanitize=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(enabled=true){
 const ctx={appState:{pickupAbortEnabled:enabled,currentUser:{email:'ci@students.mituniversity.edu.in'}},sanitize,
   pickupServerClockOffset:0,driverJourneyBookings:[]};
 vm.runInNewContext(source,ctx);
 return {ui:ctx.pickup,ctx};
}
function booking(change={}){
 return {bookingId:'BKG-a1234567-aaaa-4aaa-bbbb-cccccccccccc',
  journeyStage:'pickup_ready',pickupAt:'2026-11-21T06:00:00.000Z',
  boardedAt:null,status:'active',pickupCase:null,...change};
}
test('flag off renders no timer, abort or automatic sanction',()=>{
 const {ui}=fixture(false);
 assert.equal(ui.pickupAbortMarkup(booking()),'');
});
test('five minute clock is derived from server persisted pickup timestamp',()=>{
 const {ui}=fixture();
 const text=ui.pickupAbortMarkup(booking());
 assert.match(text,/data-pickup-due="1795241100000"/);
 assert.match(text,/disabled>Abort unresolved pickup/);
 assert.match(text,/Report safety issue/);
 assert.match(text,/driver-reported time is not proof of presence/i);
 assert.doesNotMatch(text,/(?:₹|fine amount|automatic ban|automatic penalty)/i);
});
test('boarding confirmed or journey arrived cannot show an ordinary no-show control',()=>{
 const {ui}=fixture();
 assert.equal(ui.pickupAbortMarkup(booking({boardedAt:'2026-11-21T06:04:12Z'})),'');
 assert.equal(ui.pickupAbortMarkup(booking({journeyStage:'arrived'})),'');
 assert.equal(ui.pickupAbortMarkup(booking({status:'cancelled'})),'');
});
test('existing pickup case displays review status rather than a second abort control',()=>{
 const {ui}=fixture();
 const text=ui.pickupAbortMarkup(booking({pickupCase:{id:'case-id'}}));
 assert.match(text,/under review/);
 assert.doesNotMatch(text,/Abort unresolved pickup/);
 assert.match(text,/Report safety issue/);
});
test('untrusted booking ID is escaped',()=>{
 const {ui}=fixture();
 const text=ui.pickupAbortMarkup(booking({bookingId:'<img onerror=alert(1)>'}));
 assert.ok(!text.includes('<img'));
 assert.ok(text.includes('&lt;img'));
});
test('dialog has accessible labels, safe alternatives and distinct emergency copy',()=>{
 assert.match(html,/id="pickupAbortDialog"[^>]*aria-labelledby="pickupAbortTitle"/);
 assert.match(html,/id="pickupAbortHelp"/);
 assert.match(html,/Keep coordinating/);
 assert.match(html,/Submit pickup report/);
 assert.match(html,/Report safety issue/);
 assert.match(html,/Safety first/);
 assert.match(html,/No automatic penalty/);
 assert.match(html,/pickupServerClockOffset/);
 assert.match(html,/window\.setInterval\(updatePickupWaitDisplays,1000\)/);
});
test('previous cancelled bookings remain visible with payment and boarding uncertainty',()=>{
 assert.match(html,/Previous bookings · retained history/);
 assert.match(html,/Historical Pending · requires review, not an invoice/);
 assert.match(html,/Free pilot · no payment required/);
 assert.match(html,/Boarding not verified/);
 assert.match(html,/pickupCase\?\.id/);
});
test('driver cancellation review stays visible without pretending collectible debt',()=>{
  assert.match(html,/Cancelled-booking records retained/);
  assert.match(html,/historical legacy booking\(s\) still marked Pending/);
  assert.match(html,/do not establish earned commission or an invoice/);
  assert.match(html,/appState\.financialReview=null/);
  assert.match(html,/collectionAuthorized:false/);
});
test('all inline HTML scripts compile and reduced motion remains safe',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
 }
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});
