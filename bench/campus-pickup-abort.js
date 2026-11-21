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
 const caseRead=(user,bookingId)=>request(
   '/api/bookings/cases?bookingId='+encodeURIComponent(bookingId),{user});
 const reply=(user,bookingId,code='present_at_pickup',opts={})=>request(
   '/api/bookings/cases/respond',{method:'POST',user,
     csrf:opts.noCsrf?undefined:csrf[user],
     idempotencyKey:opts.key||crypto.randomUUID(),body:{bookingId,code}});

 const ride=await create();
 assert.equal(ride.status,201,JSON.stringify(ride.body));
 const rid=ride.body.ride.id;
 const first=await book(1,rid),second=await book(2,rid);
 assert.equal(first.status,201,JSON.stringify(first.body));
 assert.equal(second.status,201,JSON.stringify(second.body));
 const one=first.body.booking.bookingId,two=second.body.booking.bookingId;
 assert.equal((await caseRead(1,one)).status,404,
   'case not invented until one participant reports a pickup problem');
 assert.equal((await reply(1,one)).status,404,'cannot reply without a case');

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
 // Original reporter cannot use the response endpoint to fabricate a
 // second-party confirmation; only the counterparty may respond.
 assert.equal((await reply(2,two,'safety_concern')).status,409);
 assert.equal((await caseRead(3,two)).status,403);
 assert.equal((await reply(3,two,'present_at_pickup')).status,403);
 const earlyReply=await reply(0,two,'attempted_contact');
 assert.equal(earlyReply.status,200,JSON.stringify(earlyReply.body));
 assert.equal(earlyReply.body.recorded,true);
 assert.equal((await caseRead(2,two)).body.canRespond,false);


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
 // Opposing claims are evidence, not adjudication. Both participants can
 // provide a single immutable response without changing money or seats.
 assert.equal((await caseRead(3,one)).status,403);
 assert.equal((await reply(3,one)).status,403);
 assert.equal((await reply(1,one,'unknown')).status,400);
 assert.equal((await reply(1,one,'attempted_contact',{noCsrf:true})).status,403);
 assert.equal((await request('/api/bookings/cases/respond',{anonymous:true,
   method:'POST',body:{bookingId:one,code:'attempted_contact'}})).status,401);
 const beforeReplies=(await pool.query(
   'SELECT status,payment_status,boarded_at FROM public.campus_bookings WHERE booking_id=$1',[one])).rows[0];
 const responses=await Promise.all([
   reply(0,one,'present_at_pickup',{key:crypto.randomUUID()}),
   reply(1,one,'could_not_find_partner',{key:crypto.randomUUID()})
 ]);
 assert.ok(responses.every(x=>x.status===200),JSON.stringify(responses));
 assert.equal(responses[0].body.caseId,readCase.id);
 assert.equal(responses[1].body.caseId,readCase.id);
 assert.ok(responses.every(x=>x.body.recorded));
 const replay=await reply(1,one,'could_not_find_partner');
 assert.equal(replay.status,200);
 assert.equal(replay.body.recorded,false,
   'same person/response may be retried safely with a fresh idempotency key');
 assert.equal((await reply(1,one,'attempted_contact')).status,409,
   'a contradictory second response is rejected, not silently overwritten');
 const caseDetails=await caseRead(1,one);
 assert.equal(caseDetails.status,200,JSON.stringify(caseDetails.body));
 assert.equal(caseDetails.body.state,'open');
 assert.equal(caseDetails.body.claims.length,2);
 assert.equal(caseDetails.body.responses.length,2);
 assert.equal(caseDetails.body.actorRole,'passenger');
 assert.equal(caseDetails.body.canRespond,false);
 assert.ok(caseDetails.body.claims.every(c=>['driver','passenger'].includes(c.actorRole)));
 assert.ok(caseDetails.body.responses.every(c=>!Object.hasOwn(c,'actorUserId')&&!Object.hasOwn(c,'actor_user_id')));
 assert.equal(caseDetails.body.driverPhone,undefined);
 assert.equal(caseDetails.body.pin,undefined);
 assert.equal(caseDetails.body.paymentStatus,undefined);
 assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_booking_case_responses WHERE case_id=$1',
   [readCase.id])).rows[0].n,2);
 assert.deepEqual((await pool.query(
   'SELECT status,payment_status,boarded_at FROM public.campus_bookings WHERE booking_id=$1',[one])).rows[0],beforeReplies,
   'responses never change booking, boarding or financial facts');


 // --- Strictly synthetic, manually provisioned reviewer/appeal identities. ---
 // No application/API endpoint can grant privileges to itself.
 const reviewerQueue=(user,role='case_reviewer')=>request(
   '/api/reviewer/cases?role='+encodeURIComponent(role),{user});
 const reviewerDetail=(user,bookingId)=>request(
   '/api/reviewer/case-detail?bookingId='+encodeURIComponent(bookingId),{user});
 const review=(user,bookingId,code='insufficient_evidence',opts={})=>
   request('/api/reviewer/cases/decision',{method:'POST',user,
     csrf:opts.noCsrf?undefined:csrf[user],idempotencyKey:opts.key||crypto.randomUUID(),
     body:{bookingId,code}});
 const appeal=(user,bookingId,reason='technical_issue',opts={})=>
   request('/api/bookings/cases/appeal',{method:'POST',user,
     csrf:opts.noCsrf?undefined:csrf[user],idempotencyKey:opts.key||crypto.randomUUID(),
     body:{bookingId,reason}});
 const appealDecision=(user,appealId,resultCode='additional_review_required',opts={})=>
   request('/api/reviewer/appeals/decision',{method:'POST',user,
     csrf:opts.noCsrf?undefined:csrf[user],idempotencyKey:opts.key||crypto.randomUUID(),
     body:{appealId,resultCode}});
 assert.equal((await reviewerQueue(3)).status,403,'no reviewer is seeded by default');
 assert.equal((await reviewerDetail(3,one)).status,403);
 assert.equal((await review(3,one)).status,403);
 assert.equal((await appeal(1,one)).status,409,'no appeal before review record');
 assert.equal((await appeal(2,one)).status,403,'other passenger cannot appeal');
 assert.equal((await reviewerQueue(4,'invalid')).status,400);
 // CI-only grant creation uses the privileged disposable SQL test connection,
 // not an HTTP endpoint or the application's restricted DB role.
 await pool.query([
   'INSERT INTO public.campus_case_reviewer_grants',
   '(user_id,reviewer_role,expires_at)',
   "VALUES ($1,'case_reviewer',now()+interval '1 day'),",
   "($1,'appeal_reviewer',now()+interval '1 day'),",
   "($2,'appeal_reviewer',now()+interval '1 day'),",
   "($3,'case_reviewer',now()+interval '1 day')"
 ].join(' '),[ids[3],ids[4],ids[0]]);
 assert.equal((await reviewerQueue(4,'case_reviewer')).status,403);
 const queue=await reviewerQueue(3);
 assert.equal(queue.status,200,JSON.stringify(queue.body));
 assert.equal(queue.body.kind,'initial_review');
 assert.ok(queue.body.cases.some(x=>x.bookingId===one));
 assert.equal(queue.body.cases[0].passengerEmail,undefined);
 assert.equal(queue.body.cases[0].studentFare,undefined);
 assert.equal((await reviewerDetail(0,one)).status,403,
   'participant cannot review own case even if operator granted role');
 assert.equal((await review(0,one)).status,403);
 assert.equal((await reviewerDetail(3,one)).status,200);
 assert.equal((await reviewerDetail(2,one)).status,403);
 assert.equal((await review(3,one,'invalid')).status,400);
 assert.equal((await review(3,one,'insufficient_evidence',{noCsrf:true})).status,403);
 assert.equal((await request('/api/reviewer/cases/decision',{method:'POST',
   anonymous:true,body:{bookingId:one,code:'no_action'}})).status,401);
 const originalBooking=(await pool.query(
   'SELECT status,payment_status,boarded_at,student_fare FROM public.campus_bookings WHERE booking_id=$1',
   [one])).rows[0];
 const reviewed=await review(3,one);
 assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
 assert.equal(reviewed.body.recorded,true);
 assert.equal((await review(3,one)).body.recorded,false,
   'identical review safely retries with a distinct idempotency key');
 assert.equal((await review(3,one,'no_action')).status,409);
 assert.equal((await review(4,one)).status,403,'appeal reviewer is not initial reviewer');
 const reviewedCase=await caseRead(1,one);
 assert.equal(reviewedCase.status,200);
 assert.equal(reviewedCase.body.review.code,'insufficient_evidence');
 assert.equal(reviewedCase.body.canAppeal,true);
 assert.equal(reviewedCase.body.canRespond,false);
 assert.equal((await reply(0,one,'present_at_pickup')).status,409,
   'evidence frozen after review, even if same actor previously responded');
 assert.equal((await appeal(1,one,'unknown')).status,400);
 assert.equal((await appeal(1,one,'technical_issue',{noCsrf:true})).status,403);
 assert.equal((await request('/api/bookings/cases/appeal',{method:'POST',
   anonymous:true,body:{bookingId:one,reason:'technical_issue'}})).status,401);
 const paxAppeal=await appeal(1,one);
 assert.equal(paxAppeal.status,200,JSON.stringify(paxAppeal.body));
 assert.equal(paxAppeal.body.recorded,true);
 assert.equal((await appeal(1,one)).body.recorded,false);
 assert.equal((await appeal(1,one,'safety_context')).status,409,
   'no contradictory appeal overwrite');
 const driverAppeal=await appeal(0,one,'missing_evidence');
 assert.equal(driverAppeal.status,200);
 const paxCase=await caseRead(1,one),drvCase=await caseRead(0,one);
 assert.equal(paxCase.body.appeals.length,2);
 assert.equal(paxCase.body.canAppeal,false);
 assert.equal(paxCase.body.appeals.find(a=>a.mine).reason,'technical_issue');
 assert.equal(paxCase.body.appeals.find(a=>!a.mine).reason,null);
 assert.equal(drvCase.body.appeals.find(a=>a.mine).reason,'missing_evidence');
 const pendingAppeals=await reviewerQueue(4,'appeal_reviewer');
 assert.equal(pendingAppeals.status,200,JSON.stringify(pendingAppeals.body));
 assert.equal(pendingAppeals.body.cases.length,2);
 const appealId=pendingAppeals.body.cases[0].appealId;
 assert.equal((await appealDecision(3,appealId)).status,403,
   'initial reviewer cannot affirm their own review even with appeal role');
 assert.equal((await appealDecision(0,appealId)).status,403,
   'a participant cannot review their own case');
 assert.equal((await appealDecision(4,appealId,'invalid')).status,400);
 assert.equal((await appealDecision(4,appealId,'additional_review_required',
   {noCsrf:true})).status,403);
 const appealReview=await appealDecision(4,appealId);
 assert.equal(appealReview.status,200,JSON.stringify(appealReview.body));
 assert.equal(appealReview.body.recorded,true);
 assert.equal((await appealDecision(4,appealId)).body.recorded,false);
 assert.equal((await appealDecision(4,appealId,'review_record_unchanged')).status,409);
 const secondAppealId=pendingAppeals.body.cases[1].appealId;
 assert.equal((await appealDecision(4,secondAppealId)).status,200);
 assert.equal((await reviewerQueue(4,'appeal_reviewer')).body.cases.length,0);
 const postOutcome=await caseRead(1,one);
 assert.ok(postOutcome.body.appeals.every(x=>x.outcome==='additional_review_required'));
 assert.equal(postOutcome.body.state,'open','review outcomes never change protected case status');
 assert.deepEqual((await pool.query(
   'SELECT status,payment_status,boarded_at,student_fare FROM public.campus_bookings WHERE booking_id=$1',
   [one])).rows[0],originalBooking,'review and appeals cannot mutate financial or boarding facts');
 const paymentRows=await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_case_review_decisions WHERE case_id=$1',[readCase.id]);
 assert.equal(paymentRows.rows[0].n,1);
 await pool.query(
   'UPDATE public.campus_case_reviewer_grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND reviewer_role=$2',
   [ids[4],'appeal_reviewer']);
 assert.equal((await reviewerQueue(4,'appeal_reviewer')).status,403,'revoked role cannot view appeal queue');
 assert.equal((await reviewerDetail(4,one)).status,403,'revoked reviewer cannot open cases');
 const appGrants=await pool.query([
   "SELECT has_table_privilege('campuspool_staging_app','public.campus_case_reviewer_grants','INSERT') AS i,",
   "has_table_privilege('campuspool_staging_app','public.campus_case_reviewer_grants','UPDATE') AS u,",
   "has_table_privilege('campuspool_staging_app','public.campus_case_reviewer_grants','DELETE') AS d"
 ].join(' '));
 assert.deepEqual(appGrants.rows[0],{i:false,u:false,d:false},
   'backend identity cannot self-assign, alter or delete reviewer grants');

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
 const afterCancelCase=await caseRead(1,one);
 assert.equal(afterCancelCase.status,200,'case evidence survives ride cancellation');
 assert.equal(afterCancelCase.body.responses.length,2);
 assert.equal(afterCancelCase.body.state,'open');

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
 const responseFlagOff=new PgRidesStore({
   pool,journeyEnabled:true,pickupAbortEnabled:false,caseResponseEnabled:true
 });
 await responseFlagOff.ready();
 assert.equal(responseFlagOff.responseSchemaReady,true);
 assert.equal(responseFlagOff.reviewSchemaReady,true);
 await assert.rejects(responseFlagOff.respondToBookingCase({
   bookingId:one,actorUserId:ids[0],code:'present_at_pickup'
 }),error=>error.code==='CASE_EVIDENCE_FROZEN',
 'disabling new review UI cannot reopen post-review evidence');

 assert.equal((await responseFlagOff.getBookingCase({
   bookingId:one,actorUserId:ids[1]})).responses.length,2,
   'case response history must remain readable even if pickup abort is switched off');
 const rls=await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.campus_booking_cases'::regclass");
 assert.equal(rls.rows[0].relrowsecurity,true);
 const noDeletes=await pool.query("SELECT has_table_privilege('campuspool_staging_app','public.campus_booking_case_events','DELETE') AS d,has_table_privilege('campuspool_staging_app','public.campus_booking_case_events','UPDATE') AS u");
 assert.deepEqual(noDeletes.rows[0],{d:false,u:false});
 const responseGrants=await pool.query([
   "SELECT has_table_privilege('campuspool_staging_app','public.campus_booking_case_responses','DELETE') AS d,",
   "has_table_privilege('campuspool_staging_app','public.campus_booking_case_responses','UPDATE') AS u"
 ].join(' '));
 assert.deepEqual(responseGrants.rows[0],{d:false,u:false});


 // Migration replay with persisted case/events. CI database is explicitly disposable.
 const beforeReplay=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_events')).rows[0].n;
 await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations','012_pickup_abort_cases.sql'),'utf8'));
 const afterReplay=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_events')).rows[0].n;
 assert.equal(afterReplay,beforeReplay);
 const beforeResponses=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_responses')).rows[0].n;
 await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations',
   '013_private_case_responses.sql'),'utf8'));
 const afterResponses=(await pool.query('SELECT count(*)::int AS n FROM public.campus_booking_case_responses')).rows[0].n;
 assert.equal(afterResponses,beforeResponses,'migration 013 replay keeps protected existing responses');

 // Migration 014 replay must not reset reviewer grants or erase decisions.
 const reviewBefore=(await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_case_review_decisions')).rows[0].n;
 const appealsBefore=(await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_case_appeals')).rows[0].n;
 await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations',
   '014_case_review_appeals_foundation.sql'),'utf8'));
 assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_case_review_decisions')).rows[0].n,reviewBefore);
 assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM public.campus_case_appeals')).rows[0].n,appealsBefore);
 const protectedTables=['campus_case_review_decisions','campus_case_appeals','campus_case_appeal_reviews'];
 for(const table of protectedTables){
   const privilege=await pool.query(
     'SELECT has_table_privilege($1, $2, $3) AS allowed',
     ['campuspool_staging_app','public.'+table,'DELETE']);
   assert.equal(privilege.rows[0].allowed,false,table+' cannot be erased via app role');
 }
 const grantRls=await pool.query(
   "SELECT relrowsecurity FROM pg_class WHERE oid='public.campus_case_reviewer_grants'::regclass");
 assert.equal(grantRls.rows[0].relrowsecurity,true);

 // Test one-sided decision gating directly against the same disposable
 // PostgreSQL store. Do not bypass or weaken the real HTTP mutation limiter:
 // the preceding HTTP security tests intentionally consume its actor budget.
 const directStore=new PgRidesStore({
   pool,journeyEnabled:true,boardingPinEnabled:true,
   boardingPinKey:'ci-synthetic-only-private-key-abcdef0123456789',
   pickupAbortEnabled:true,caseResponseEnabled:true,caseReviewEnabled:true
 });
 await directStore.ready();
 const created=await directStore.createRide({
   driverUserId:ids[0],ride:{
     vehicle:'Car',vehicleModel:'CI hatch',pickup:'CI gate',
     destination:'CI station',departureTime:'2027-01-02T09:00:00',
     seatsTotal:2,uberBenchmark:100,studentFare:30,driverPayout:27,upiId:''
   }
 });
 const booking=await directStore.bookRide({
   rideId:created.id,passengerUserId:ids[2]
 });
 const loneBooking=booking.bookingId;
 await directStore.reportPickupAbort({
   bookingId:loneBooking,actorUserId:ids[2],reason:'safety_emergency'
 });
 await assert.rejects(
   directStore.recordReview({
     bookingId:loneBooking,reviewerUserId:ids[3],code:'no_action'
   }),
   error=>error.code==='BOTH_PARTIES_NOT_HEARD',
   'one-sided claims cannot become review decisions'
 );
 const otherStatement=await directStore.respondToBookingCase({
   bookingId:loneBooking,actorUserId:ids[0],code:'attempted_contact'
 });
 assert.equal(otherStatement.recorded,true);
 const afterBoth=await directStore.recordReview({
   bookingId:loneBooking,reviewerUserId:ids[3],code:'no_action'
 });
 assert.equal(afterBoth.recorded,true);
 assert.equal((await directStore.getBookingCase({
   bookingId:loneBooking,actorUserId:ids[2]
 })).review.code,'no_action');
 const postReviewStatus=await directStore.checkUserSettlementBlock(ids[2]);
 assert.ok(postReviewStatus.reviewRequiredBookings.some(x=>x.bookingId===loneBooking));
 assert.equal(postReviewStatus.commissionDue,0);

 t.diagnostic('CAMPUS_CASE_REVIEW_APPEALS_RESULT '+JSON.stringify({
   disposableOnly:true,actors:ids.length,
   manualOperatorGrantsOnly:true,noSelfProvision:true,
   revokedRolesBlocked:true,conflictedReviewerDenied:true,
   sameReviewerCannotDecideAppeal:true,oneSidedDecisionBlocked:true,
   counterpartyRespondedBeforeDecision:true,initialReviewUnique:true,
   participantAppealsUnique:true,independentAppealOutcomes:true,
   participantAppealPrivacy:true,idempotentRetries:true,
   immutableAuditGrants:true,featureRollbackEvidenceFrozen:true,
   migration014Replay:true,noFinancialMutation:true,
   noAutomaticFeesRefundsBansOrBookingRestrictions:true
 }));

 t.diagnostic('CAMPUS_CASE_RESPONSE_RESULT '+JSON.stringify({
   disposableOnly:true,actors:ids.length,counterpartyOnly:true,
   caseReadAfterCancellation:true,flagRollbackRead:true,
   privateTimeline:true,csrfRequired:true,anonymousBlocked:true,
   concurrentOpposingResponses:true,sameCodeRetryIdempotent:true,
   contradictoryResponseRejected:true,noPaymentOrSeatChange:true,
   immutableDatabaseGrants:true,migration013Replay:true,
   nonMonetaryReviewerRecordsOnly:true,automaticSanctions:false
 }));

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
