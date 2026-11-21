'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('// CAMPUSPOOL_CASE_RESPONSE_BEGIN');
const end=html.indexOf('    let caseResponseCurrent=null;',start);
assert.ok(start>=0&&end>start,'case response markup must be present');
const source=html.slice(start,end)+'\nglobalThis.renderCase=caseResponseMarkup;';
const sanitize=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function caseHtml(enabled,booking){
  const ctx={appState:{caseResponseEnabled:enabled},sanitize};
  vm.runInNewContext(source,ctx);
  return ctx.renderCase(booking);
}
const booking=update=>({
  bookingId:'BKG-a1234567-aaaa-4aaa-bbbb-cccccccccccc',
  pickupCase:{id:'case-1',state:'open'},status:'cancelled',...update
});
test('response controls hidden with flag off, no case or unavailable booking',()=>{
  assert.equal(caseHtml(false,booking()),'');
  assert.equal(caseHtml(true,booking({pickupCase:null})),'');
  assert.equal(caseHtml(true,null),'');
});
test('cancelled passenger/driver case stays openable without PIN or payment',()=>{
  const htmlOut=caseHtml(true,booking());
  assert.match(htmlOut,/View pickup case \/ respond/);
  assert.match(htmlOut,/data-booking-id="BKG-a1234567/);
  assert.doesNotMatch(htmlOut,/fine|charge|waive|Paid|payment|ban/i);
});
test('untrusted booking ID is HTML escaped in the button',()=>{
  const markup=caseHtml(true,booking({bookingId:'"><img onerror=alert(1)>'}));
  assert.doesNotMatch(markup,/<img/i);
  assert.match(markup,/&quot;&gt;&lt;img/);
});
test('private case dialog is accessible and avoids uncontrolled text capture',()=>{
  assert.match(html,/id="caseResponseDialog"[^>]*aria-labelledby="caseResponseTitle"/);
  assert.match(html,/id="caseResponseHelp"/);
  assert.match(html,/id="caseResponseTimeline"[^>]*aria-label=/);
  assert.match(html,/id="caseResponseForm"[^>]*hidden/);
  assert.match(html,/id="caseResponseCode" required/);
  assert.match(html,/option value="present_at_pickup"/);
  assert.match(html,/option value="safety_concern"/);
  assert.doesNotMatch(html,/<textarea[^>]*id="caseResponse/);
  assert.match(html,/list\.replaceChildren\(\)/);
  assert.match(html,/description\.textContent=/);
  assert.match(html,/caseResponseCurrent=null/);
});
test('case timeline remains visible after cancellations and flag switching',()=>{
  assert.match(html,/driverCaseHistory=hData\.bookings\.filter/);
  assert.match(html,/actorRole==='driver'/);
  assert.match(html,/Past pickup reports · driver history/);
  assert.match(html,/appState\.myBookingHistory\.map/);
  assert.match(html,/caseResponseMarkup\(b\)/);
  assert.match(html,/caseResponseEnabled=data\.caseResponseEnabled===true/);
  assert.match(html,/\/api\/bookings\/cases\?bookingId=/);
  assert.match(html,/\/api\/bookings\/cases\/respond/);
});
test('no adjudication, fee or booking mutation from a response UI action',()=>{
  const part=html.slice(html.indexOf('// CAMPUSPOOL_CASE_RESPONSE_BEGIN'),
    html.indexOf('// CAMPUSPOOL_CASE_RESPONSE_END'));
  assert.doesNotMatch(part,/\/api\/driver\/settle-commission|\/api\/bookings\/payment-status/);
  assert.match(part,/No fee, strike, ban or payment decision/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});
test('all standalone inline JavaScript compiles',()=>{
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
    if(script[1].trim())assert.doesNotThrow(()=>new vm.Script(script[1]));
  }
});
