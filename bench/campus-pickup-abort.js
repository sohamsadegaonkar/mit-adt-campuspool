'use strict';
// Strictly disposable, real HTTP + PostgreSQL acceptance tests for pickup claims.
// These are allegations, never automated no-show, money or disciplinary findings.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

async function runPickupAbort({t,pool,ids,request}){
 assert.equal(process.env.RIDES_HTTP_PICKUP_DISPOSABLE_DB,'YES');
 const url=new URL(process.env.OTP_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.equal(url.pathname,'/campuspool_stage1_ci');
 const csrf=[];
 for(let i=0;i<ids.length;i++){
   const me=await request('/api/auth/me',{user:i});
   assert.equal(me.status,200);assert.equal(me.body.pickupAbortEnabled,true);
   csrf.push(me.body.csrfToken);
 }
 const create=async(driver=0,seats=2)=>request('/api/rides',{
   method:'POST',user:driver,csrf:csrf[driver],
   body:{vehicle:'Car',vehicleModel:'CI hatch',pickup:'CI gate',destination:'CI station',
     departureTime:'2027-01-02T09:00:00',seatsTotal:seats,uberBenchmark:100,
     studentFare:30,driverPayout:27,upiId:''}
 });
 const book=(user,rideId)=>request('/api/bookings',{
   method:'POST',user,csrf:csrf[user],body:{rideId}
 });
 const milestone=(driver,rideId,action)=>request('/api/rides/journey',{
   method:'POST',user:driver,csrf:csrf[driver],body:{rideId,action}
 });
 const claim=(user,bookingId,reason='no_response',opts={})=>
   request('/api/bookings/pickup-abort',{method:'POST',user,
     csrf:opts.noCsrf?undefined:csrf[user],
     idempotencyKey:opts.key||crypto.randomUUID(),body:{bookingId,reason}
   });
 const wait=(user,bookingId)=>request('/api/bookings/pickup-status?bookingId='+encodeURIComponent(bookingId),{user});
 const history=(user,params='')=>request('/api/bookings/history'+params,{user});
 const ride=await create();
 assert.equal(ride.status,201,JSON.stringify(ride.body));
 const rid=ride.body.ride.id;
 const first=await book(1,rid),second=await book(2,rid);
 assert.equal(first.status,201,JSON.stringify(first.body));
 assert.equal(second.status,201,JSON.stringify(second.body));
 const one=first.body.booking.bookingId,two=second.body.booking.bookingId;
 const initialPassengerFinance=await request('/api/user/settlement-status',{user:1});
 const initialDriverFinance=await request('/api/user/settlement-status',{user:0});
 assert.equal(initialPassengerFinance.status,200);
 assert.equal(initialPassengerFinance.body.hasUnpaidBooking,true,
   'preexisting active Pending restriction preserved');
 assert.equal(initialPassengerFinance.body.reviewRequiredBookings.length,0);
 assert.equal(initialDriverFinance.body.commissionDue,0,
   'driver capacity is not evidence of collectible commission');
 assert.equal(initialDriverFinance.body.hasUnsettledCommission,false);
 assert.equal(initialDriverFinance.body.isBlocked,false);
 assert.equal(initialDriverFinance.body.driverReviewCount,2);
 assert.equal(initialDriverFinance.body.hasReviewRequired,true);
 assert.equal(initialDriverFinance.body.driverCommission.netDue,0);
 assert.ok(initialDriverFinance.body.financialMessage.includes('Pending is unverified'));
 assert.equal((await claim(1,one)).status,409,'cannot claim ordinary no-response before pickup');
 assert.equal((await claim(3,one,'safety_emergency')).status,403,'stranger cannot claim even emergency');
 assert.equal((await claim(1,one,'unknown')).status,400);
 assert.equal((await claim(1,one,'no_response',{noCsrf:true})).status,403);
 assert.equal((await request('/api/bookings/pickup-abort',{
   anonymous:true,method:'POST',body:{bookingId:one,reason:'no_response'}})).status,401);
 assert.equal((await wait(3,one)).status,403);
 assert.equal((await history(3)).body.bookings.some(b=>b.bookingId===one),false);
 const initialHistory=await history(1);
 assert.equal(initialHistory.status,200);
 assert.ok(initialHistory.body.bookings.find(b=>b.bookingId===one));
 assert.equal(initialHistory.body.bookings[0].driverPhone,undefined,'no historical contact leak');

 assert.equal((await milestone(0,rid,'depart')).status,200);
 assert.equal((await milestone(0,rid,'pickup')).status,200);
 let pickupStatus=await wait(1,one);
 assert.equal(pickupStatus.status,200);
 assert.equal(pickupStatus.body.eligible,false);
 assert.ok(Date.parse(pickupStatus.body.abortEligibleAt)>Date.parse(pickupStatus.body.pickupReportedAt));
 assert.ok(Date.parse(pickupStatus.body.abortEligibleAt)-Date.parse(pickupStatus.body.pickupReportedAt)===300000);
 assert.equal((await claim(0,one)).status,409);
 // Emergency reporting can happen before the five-minute wait; no financial or booking mutation.
 const emergency=await claim(2,two,'safety_emergency');
 assert.equal(emergency.status,200,JSON.stringify(emergency.body));
 assert.equal(emergency.body.recorded,true);
 assert.equal(Object.hasOwn(emergency.body,'penalty'),false);

 // Test exactly the 4m59 boundary using controlled synthetic timestamps on disposable DB.
 const setPickup=async(seconds)=>pool.query(
   "UPDATE public.campus_rides SET departed_at=clock_timestamp()-interval '7 minutes',pickup_at=clock_timestamp()-$2::int*interval '1 second' WHERE id=$1",[rid,seconds]);
 await setPickup(299);
 assert.equal((await wait(1,one)).body.eligible,false,'4m59s no ordinary abort');
 assert.equal((await claim(1,one)).status,409,'4m59s returns stable 409');
 await setPickup(300);
 assert.equal((await wait(0,one)).body.eligible,true,'driver and passenger have same deadline');
 assert.equal((await wait(1,one)).body.eligible,true,'both see same deadline');
 const before=(await pool.query(
   'SELECT seats_left,payment_mode,student_fare FROM public.campus_rides WHERE id=$1',[rid])).rows[0];
 const concurrent=await Promise.all([
   claim(0,one,'could_not_locate',{key:crypto.randomUUID()}),
   claim(1,one,'no_response',{key:crypto.randomUUID()})
 ]);
 assert.ok(concurrent.every(x=>x.status===200),JSON.stringify(concurrent));
 assert.equal(concurrent[0].body.caseId,concurrent[1].body.caseId);
 assert.ok(concurrent.every(x=>x.body.recorded===true));
 assert.equal((await claim(1,one,'no_response')).body.recorded,false,
   'duplicate with different key does not add another event');
 const readCase=(await pool.query(
   'SELECT c.id,c.state,count(e.id)::int AS events FROM public.campus_booking_cases c JOIN public.campus_booking_case_events e ON e.case_id=c.id WHERE c.booking_id=$1 GROUP BY c.id,c.state',[one])).rows[0];
 assert.equal(readCase.events,2);
 assert.equal(readCase.state,'open');
 const disputedFinance=await request('/api/user/settlement-status',{user:1});
 assert.equal(disputedFinance.status,200);
 assert.equal(disputedFinance.body.isBlocked,false,
   'active disputed Pending is quarantined for review, not automatically sanctioned');
 assert.equal(disputedFinance.body.reviewRequiredBookings.length,1);
 assert.equal(disputedFinance.body.pendingBookings.length,0);
 assert.equal(disputedFinance.body.reviewStatus,'REVIEW_REQUIRED');
 assert.equal(disputedFinance.body.reviewRequiredBookings[0].bookingId,one);
 assert.equal(disputedFinance.body.reviewRequiredBookings[0].pickupCase.state,'open');
 assert.equal(disputedFinance.body.reviewRequiredBookings[0].driverPhone,undefined,
   'no private contact in settlement review');

 const statuses=(await pool.query(
   'SELECT booking_id,status,boarded_at,payment_status FROM public.campus_bookings WHERE booking_id=ANY($1::text[]) ORDER BY booking_id',
   [[one,two]])).rows;
 assert.ok(statuses.every(x=>x.status==='active'&&x.boarded_at===null&&x.payment_status==='Pending'));
 const after=(await pool.query(
   'SELECT seats_left,payment_mode,student_fare FROM public.campus_rides WHERE id=$1',[rid])).rows[0];
 assert.deepEqual(after,before,'claim does not free seats or change mode/fare');
 const caseHistory=await history(0);
 assert.equal(caseHistory.status,200);
 assert.equal(caseHistory.body.bookings.find(x=>x.bookingId===one).pickupCase?.state,'open');
 assert.equal((await history(1,'?limit=1&offset=0')).body.bookings.length,1);
 assert.equal((await history(1,'?limit=500')).status,400);
 assert.equal((await history(1,'?offset=-1')).status,400);
 assert.equal((await history(3)).body.bookings.some(x=>x.bookingId===one),false);

 // Passenger 2 may still board independently even if they earlier made an emergency report.
 const pin=await request('/api/bookings/boarding-pin',{
   method:'POST',user:2,csrf:csrf[2],body:{bookingId:two}
 });
 assert.equal(pin.status,200);
 const verify=await request('/api/bookings/verify-boarding-pin',{
   method:'POST',user:0,csrf:csrf[0],body:{bookingId:two,pin:pin.body.pin}
 });
 assert.equal(verify.status,200,JSON.stringify(verify.body));
 assert.equal((await claim(2,two)).status,409,'cannot no-show already boarded passenger');
 assert.equal((await wait(2,two)).body.boardingConfirmed,true);
 assert.equal((await wait(2,two)).body.eligible,false);
 assert.equal((await wait(1,one)).body.eligible,true,'one boarded rider does not alter other seat');

 // After driver emergency cancellation, cancelled Pending stays in private history.
 const cancelled=await request('/api/rides/cancel',{
   method:'POST',user:0,csrf:csrf[0],body:{rideId:rid}
 });
 assert.equal(cancelled.status,200);
 assert.equal((await request('/api/bookings',{user:1})).body.bookings.some(b=>b.bookingId===one),false,
   'old active-only endpoint is intentionally not the history endpoint');
 const historyPassenger=await history(1),historyDriver=await history(0);
 assert.equal(historyPassenger.status,200);
 const past=historyPassenger.body.bookings.find(x=>x.bookingId===one);
 assert.ok(past);
 assert.equal(past.status,'cancelled');
 assert.ok(past.cancelledAt);
 assert.equal(past.paymentStatus,'Pending','no automatic waiver, charge, or Paid');
 assert.equal(past.pickupCase.state,'open');
 const cancelledFinance=await request('/api/user/settlement-status',{user:1});
 assert.equal(cancelledFinance.status,200);
 assert.equal(cancelledFinance.body.hasUnpaidBooking,false);
 assert.equal(cancelledFinance.body.isBlocked,false,
   'cancelled Pending is review only, not a new-booking restriction');
 assert.equal(cancelledFinance.body.reviewRequiredBookings.length,1);
 assert.equal(cancelledFinance.body.reviewRequiredBookings[0].status,'cancelled');
 assert.equal(cancelledFinance.body.reviewRequiredBookings[0].paymentStatus,'Pending');
 const driverCancelledFinance=await request('/api/user/settlement-status',{user:0});
 assert.equal(driverCancelledFinance.body.commissionDue,0);
 assert.equal(driverCancelledFinance.body.driverReviewCount,2,
   'driver keeps pending historical audit count after seat reset');
 assert.equal(driverCancelledFinance.body.hasReviewRequired,true);

 assert.equal(historyDriver.body.bookings.find(x=>x.bookingId===two).boardedAt!==null,true);
 assert.equal((await claim(1,one)).status,409,'no ordinary no-show after ride cancellation');
 const financial=await pool.query(
   'SELECT status,payment_status,student_fare FROM public.campus_bookings WHERE booking_id=$1',[one]);
 assert.equal(financial.rows[0].payment_status,'Pending');
 assert.equal(financial.rows[0].status,'cancelled');
 // Turning off pickup reporting must NOT reinstate punitive restrictions
 // on an already-open case. Historical review survives as a read-only fact.
 const {PgRidesStore}=require('../stage1-otp/rides-store');
 const flagOffStore=new PgRidesStore({pool,journeyEnabled:true,pickupAbortEnabled:false});
 await flagOffStore.ready();
 assert.equal(flagOffStore.caseSchemaReady,true);
 const offReview=await flagOffStore.checkUserSettlementBlock(ids[1]);
 assert.equal(offReview.isBlocked,false);
 assert.ok(offReview.reviewRequiredBookings.some(x=>
   x.bookingId===one && x.pickupCase?.id===readCase.id));
 const offHistory=await flagOffStore.getBookingHistory(ids[1]);
 assert.ok(offHistory.some(x=>x.bookingId===one&&x.pickupCase?.id===readCase.id),
   'dispute proof stays readable when feature flag is disabled');
 const rls=await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.campus_booking_cases'::regclass");
 assert.equal(rls.rows[0].relrowsecurity,true);
 const noDeletes=await pool.query("SELECT has_table_privilege('campuspool_staging_app','public.campus_booking_case_events','DELETE') AS d,has_table_privilege('campuspool_staging_app','public.campus_booking_case_events','UPDATE') AS u");
 assert.deepEqual(noDeletes.rows[0],{d:false,u:false});

 // Migration replay with persisted case/events. CI database is explicitly disposable.
 const beforeReplay=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_events')).rows[0].n;
 await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations','012_pickup_abort_cases.sql'),'utf8'));
 const afterReplay=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_events')).rows[0].n;
 assert.equal(afterReplay,beforeReplay);
 t.diagnostic('CAMPUS_PICKUP_ABORT_RESULT '+JSON.stringify({
  disposableOnly:true,actors:ids.length,sharedFiveMinuteWait:true,
  earlyClaimsBlocked:true,emergencyEarlyAllowed:true,privateRead:true,
  csrfRequired:true,concurrentClaimsSingleCase:true,idempotentRepeatedReason:true,
  perPassengerBoardingIndependent:true,noSeatOrPaymentMutation:true,
  cancelledPendingHistoryPreserved:true,flagRollbackKeepsDisputedPendingReview:true,
  financialReviewSeparateFromActiveRestriction:true,
  noCapacityDerivedCommission:true,disputedPendingQuarantined:true,
  caseEventsAppendOnly:true,
  migration012Replay:true,automaticFineOrBan:false,
  releaseVerdict:'HOLD_PENDING_POLICY_RECOVERY_AND_PHYSICAL_QA'
 }));
}
module.exports={runPickupAbort};
