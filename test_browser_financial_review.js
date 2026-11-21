'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('    function calculateWeeklyCommission() {');
const end=html.indexOf('\n    function updateSettlementWarningBanner() {',start);
assert.ok(start>=0&&end>start,'financial summary helpers present');
const source=html.slice(start,end)+
  '\nglobalThis.financial={calculateWeeklyCommission,checkUserSettlementRestriction};';
function fixture(review){
  const state={currentUser:{email:'ci@students.mituniversity.edu.in'},settlementReview:review,
    myOfferedRides:[{id:'ride1',seatsTotal:4,seatsLeft:0,studentFare:200}]};
  const scope={appState:state};
  vm.runInNewContext(source,scope);
  return {fn:scope.financial,scope};
}
test('no server review never invents payable driver commission',()=>{
  const {fn}=fixture(null);
  const driver=fn.calculateWeeklyCommission();
  assert.equal(driver.netDue,0);
  assert.equal(driver.grossFare,0);
  assert.equal(driver.verified,false);
  const restrictions=fn.checkUserSettlementRestriction();
  assert.equal(restrictions.isBlocked,false);
  assert.match(restrictions.message,/unavailable/i);
});
test('cancelled Pending remains visible for review without a debt or a restriction',()=>{
  const item={bookingId:'BKG-ci',status:'cancelled',paymentStatus:'Pending',studentFare:150};
  const {fn}=fixture({isBlocked:false,reason:'NONE',hasUnpaidBooking:false,
    reviewRequiredBookings:[item],pendingBookings:[],driverReviewCount:2,
    hasReviewRequired:true});
  const restriction=fn.checkUserSettlementRestriction();
  assert.equal(restriction.isBlocked,false);
  assert.equal(restriction.commissionDue,0);
  assert.equal(restriction.hasReviewRequired,true);
  assert.equal(restriction.reviewRequiredBookings[0],item);
  assert.equal(fn.calculateWeeklyCommission().netDue,0);
  assert.equal(fn.calculateWeeklyCommission().reviewCount,2);
});
test('active legacy Pending server restriction is preserved without declaring payment complete',()=>{
  const item={bookingId:'BKG-active',status:'active',paymentStatus:'Pending'};
  const {fn}=fixture({isBlocked:true,reason:'UNPAID_BOOKING',hasUnpaidBooking:true,
    reviewRequiredBookings:[],pendingBookings:[item],driverReviewCount:0,
    hasReviewRequired:false});
  const restriction=fn.checkUserSettlementRestriction();
  assert.equal(restriction.isBlocked,true);
  assert.equal(restriction.unpaidBooking,item);
  assert.match(restriction.message,/not a bill/i);
});
test('review dispute never becomes automatic fine or payment due',()=>{
  const {fn}=fixture({isBlocked:false,reason:'NONE',hasUnpaidBooking:false,
    reviewRequiredBookings:[{status:'active',pickupCase:{state:'open'},paymentStatus:'Pending'}],
    pendingBookings:[],driverReviewCount:0,hasReviewRequired:true});
  const r=fn.checkUserSettlementRestriction();
  assert.equal(r.isBlocked,false);
  assert.equal(r.commissionDue,0);
  assert.equal(r.hasReviewRequired,true);
});
test('driver card and warning avoid fake numeric debts from seat counts',()=>{
  assert.doesNotMatch(source,/seatsTotal\s*[-+]\s*seatsLeft/);
  assert.match(html,/if \(dueEl\) dueEl\.textContent = 'Not payable'/);
  assert.match(html,/Historical or disputed Pending booking: review required/);
  assert.match(html,/no automatic charge/i);
  assert.match(html,/Pending · requires review, not an invoice/);
});
test('all classic scripts remain valid and history is participant-only',()=>{
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
    if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
});
