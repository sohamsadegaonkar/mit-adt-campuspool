'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const begin=html.indexOf('    function calculateWeeklyCommission() {');
const end=html.indexOf('    function updateDriverCommissionBanner()',begin);
const restriction=html.indexOf('    function checkUserSettlementRestriction() {',end);
const next=html.indexOf('    function updateSettlementWarningBanner()',restriction);
assert.ok(begin>=0&&end>begin&&restriction>end&&next>restriction);
const source=html.slice(begin,end)+html.slice(restriction,next)+
  '\nglobalThis.finance={calculateWeeklyCommission,checkUserSettlementRestriction};';
function fixture(snapshot){
 const state={currentUser:{email:'synthetic@students.mituniversity.edu.in'},
   rides:[{id:'r1',seatsTotal:4,seatsLeft:0,studentFare:100}],
   myOfferedRides:[{id:'r1',seatsTotal:4,seatsLeft:0,studentFare:100}],
   myBookings:[],settlementSnapshot:snapshot};
 const ctx={appState:state};
 vm.runInNewContext(source,ctx);
 return {state,finance:ctx.finance};
}
test('client cannot fabricate money from capacity while private snapshot unavailable',()=>{
 const {finance}=fixture(null);
 const estimate=finance.calculateWeeklyCommission();
 assert.equal(estimate.netDue,0);
 assert.equal(estimate.verified,false);
 assert.equal(finance.checkUserSettlementRestriction().isBlocked,false);
});
test('backend booking-based provisional figures survive deliberate seat counter drift',()=>{
 const snapshot={isBlocked:true,hasUnsettledCommission:true,hasUnpaidBooking:false,
   commissionDue:6,
   driverCommission:{totalRides:3,grossFare:55.25,totalCommission:6,netDue:6},
   pendingBookings:[]};
 const {state,finance}=fixture(snapshot);
 const expected=finance.calculateWeeklyCommission();
 assert.equal(expected.netDue,6);assert.equal(expected.grossFare,55.25);
 state.rides[0].seatsLeft=4;
 state.myOfferedRides[0].seatsLeft=4;
 assert.equal(finance.calculateWeeklyCommission().netDue,6);
 assert.equal(finance.calculateWeeklyCommission().grossFare,55.25);
 assert.match(finance.checkUserSettlementRestriction().message,/not a verified payment|No payment is collected/i);
});
test('cancelled Pending for review alone creates neither client lock nor fabricated invoice',()=>{
 const snap={isBlocked:false,hasUnsettledCommission:false,hasUnpaidBooking:false,
  commissionDue:0,driverCommission:{totalRides:0,grossFare:0,totalCommission:0,netDue:0},
  pendingBookings:[],hasReviewRequired:true};
 const {finance}=fixture(snap);
 const r=finance.checkUserSettlementRestriction();
 assert.equal(r.isBlocked,false);assert.equal(r.reason,'NONE');
 assert.equal(finance.calculateWeeklyCommission().netDue,0);
 assert.match(html,/Cancelled-booking records retained/);
 assert.match(html,/These require review/);
 assert.match(html,/not an invoice/);
});
test('UI labels communicate provisional uncollected amounts instead of received money',()=>{
 assert.match(html,/Provisional Legacy Booking Review/);
 assert.match(html,/Provisional estimate · not a bill/);
 assert.match(html,/Booked fare estimate/);
 assert.match(html,/Estimated driver share/);
 assert.doesNotMatch(html,/Gross Collected<\/span>/);
 assert.doesNotMatch(html,/Weekly Due<\/span>/);
});
test('all application classic scripts compile',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
   if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
});
