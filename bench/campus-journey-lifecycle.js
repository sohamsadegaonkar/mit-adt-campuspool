'use strict';
// Real HTTP/PG verification on the strictly disposable campuspool_stage1_ci DB.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
async function runJourney({t,pool,ids,request}){
  assert.equal(process.env.RIDES_HTTP_JOURNEY_DISPOSABLE_DB,'YES');
  const u=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));
  assert.equal(u.pathname,'/campuspool_stage1_ci');
  const csrf=[];
  for(let i=0;i<ids.length;i++){
    const me=await request('/api/auth/me',{user:i});
    assert.equal(me.status,200);assert.equal(me.body.journeyEnabled,true);csrf.push(me.body.csrfToken);
  }
  const create=async(user,change={})=>request('/api/rides',{method:'POST',user,csrf:csrf[user],
    body:{vehicle:'Car',vehicleModel:'CI vehicle',pickup:'Synthetic Gate',destination:'Synthetic Station',
      departureTime:'2027-01-02T09:00:00',seatsTotal:2,uberBenchmark:100,studentFare:30,driverPayout:27,upiId:'',...change}});
  const created=await create(0);assert.equal(created.status,201,JSON.stringify(created.body));
  const rid=created.body.ride.id;
  assert.equal(created.body.ride.journeyStage,'scheduled');
  const booked=await request('/api/bookings',{method:'POST',user:1,csrf:csrf[1],body:{rideId:rid}});
  assert.equal(booked.status,201,JSON.stringify(booked.body));
  const bid=booked.body.booking.bookingId;
  const event=(user,action,key=crypto.randomUUID(),rideId=rid,validCsrf=true)=>
    request('/api/rides/journey',{method:'POST',user,csrf:validCsrf?csrf[user]:undefined,
      idempotencyKey:key,body:{rideId,action}});
  assert.equal((await event(3,'depart')).status,403,'outsider not driver');
  assert.equal((await event(0,'depart',crypto.randomUUID(),rid,false)).status,403,'CSRF is required');
  const bad=await event(0,'arrive');assert.equal(bad.status,409);assert.equal(bad.body.error,'JOURNEY_INVALID_TRANSITION');
  const badAction=await event(0,'__proto__');assert.equal(badAction.status,400);
  const key=crypto.randomUUID();
  const parallel=await Promise.all([event(0,'depart',key),event(0,'depart',key)]);
  assert.ok(parallel.every(r=>r.status===200));assert.ok(parallel.some(r=>r.replayed==='true'));
  assert.equal(parallel[0].body.ride.departedAt,parallel[1].body.ride.departedAt);
  const feed=await request('/api/rides',{user:2});assert.ok(!feed.body.rides.some(r=>r.id===rid));
  const lateBooking=await request('/api/bookings',{method:'POST',user:2,csrf:csrf[2],body:{rideId:rid}});
  assert.equal(lateBooking.status,409);assert.equal(lateBooking.body.error,'JOURNEY_BOOKING_CLOSED');
  const before=(await pool.query('SELECT seats_left FROM public.campus_rides WHERE id=$1',[rid])).rows[0].seats_left;
  const unauthorizedCancel=await request('/api/bookings/cancel',{method:'POST',user:2,csrf:csrf[2],body:{bookingId:bid}});
  assert.equal(unauthorizedCancel.status,403,'outsider cannot infer lifecycle status from cancellation');
  const lateCancel=await request('/api/bookings/cancel',{method:'POST',user:1,csrf:csrf[1],body:{bookingId:bid}});
  assert.equal(lateCancel.status,409);assert.equal(lateCancel.body.error,'JOURNEY_ALREADY_STARTED');
  assert.equal((await pool.query('SELECT seats_left FROM public.campus_rides WHERE id=$1',[rid])).rows[0].seats_left,before);
  const passenger=await request('/api/bookings',{user:1});
  const bookedNow=passenger.body.bookings.find(x=>x.bookingId===bid);
  assert.equal(bookedNow.journeyStage,'departed');assert.ok(bookedNow.departedAt);
  const pickup=await event(0,'pickup');assert.equal(pickup.status,200);
  assert.equal(pickup.body.ride.journeyStage,'pickup_ready');
  const atPickup=(await request('/api/bookings',{user:1})).body.bookings.find(x=>x.bookingId===bid);
  assert.equal(atPickup.journeyStage,'pickup_ready');assert.ok(atPickup.pickupAt);
  assert.ok(Date.parse(atPickup.pickupAt)>=Date.parse(atPickup.departedAt));
  const arrived=await event(0,'arrive');assert.equal(arrived.status,200);
  assert.equal(arrived.body.ride.journeyStage,'arrived');
  const trip=(await request('/api/bookings',{user:1})).body.bookings.find(x=>x.bookingId===bid);
  assert.equal(trip.journeyStage,'arrived');assert.ok(trip.arrivedAt);
  assert.equal(trip.driverPhone,undefined,'post-arrival contact must be withheld from new reads');
  assert.ok(Date.parse(trip.arrivedAt)>=Date.parse(trip.pickupAt));
  assert.equal((await event(0,'arrive')).status,409);
  assert.equal((await request('/api/rides/cancel',{method:'POST',user:0,csrf:csrf[0],body:{rideId:rid}})).status,409);
  assert.equal((await request('/api/rides/location?rideId='+encodeURIComponent(rid),{user:1})).status,403);
  assert.equal((await request('/api/bookings/passenger-location?bookingId='+encodeURIComponent(bid),{user:0})).status,403);
  const owner=(await request('/api/my-rides',{user:0})).body.rides.find(r=>r.id===rid);
  assert.equal(owner.journeyStage,'arrived');assert.ok(owner.arrivedAt);
  const pending=await request('/api/user/settlement-status',{user:1});
  assert.equal(pending.body.hasUnpaidBooking,true,'arrival must never settle legacy Pending');
  const snapshot=(await pool.query('SELECT journey_stage,departed_at,pickup_at,arrived_at FROM public.campus_rides WHERE id=$1',[rid])).rows[0];
  const rejected=await pool.query("UPDATE public.campus_rides SET journey_stage='scheduled' WHERE id=$1",[rid]).then(()=>null,e=>e);
  assert.equal(rejected?.code,'23514');
  assert.deepEqual((await pool.query('SELECT journey_stage,departed_at,pickup_at,arrived_at FROM public.campus_rides WHERE id=$1',[rid])).rows[0],snapshot);
  const backup=await create(4);assert.equal(backup.status,201);
  // A long transaction must stamp the milestone at UPDATE time, not BEGIN.
  const {PgRidesStore}=require('../stage1-otp/rides-store');
  const store=new PgRidesStore({pool,journeyEnabled:true});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const txnStart=(await client.query('SELECT now() AS started')).rows[0].started;
    await client.query('SELECT pg_sleep(0.06)');
    const reported=await store.advanceJourney({rideId:backup.body.ride.id,driverUserId:ids[4],action:'depart',client});
    assert.ok(Date.parse(reported.departedAt)-txnStart.getTime()>=40,
      'milestone must use the actual write clock after lock acquisition');
    await client.query('ROLLBACK');
  }catch(e){await client.query('ROLLBACK');throw e;}
  finally{client.release();}
  // The rollback cannot fabricate a departure in the authoritative row.
  assert.equal((await pool.query('SELECT journey_stage FROM public.campus_rides WHERE id=$1',
    [backup.body.ride.id])).rows[0].journey_stage,'scheduled');
  assert.equal((await request('/api/rides/cancel',{method:'POST',user:4,csrf:csrf[4],body:{rideId:backup.body.ride.id}})).status,200);
  assert.equal((await event(4,'depart',crypto.randomUUID(),backup.body.ride.id)).status,404);
  // Adversarial journey acceptance: this intentionally REPRODUCES release blockers.
  // Passing this regression proves the observations, NOT that the product is safe.
  // Use only the strict disposable PostgreSQL CI database, never student data.
  const emergency=await create(4);
  assert.equal(emergency.status,201,JSON.stringify(emergency.body));
  const emergencyRideId=emergency.body.ride.id;
  const emergencySeat=await request('/api/bookings',{
    method:'POST',user:2,csrf:csrf[2],body:{rideId:emergencyRideId}
  });
  assert.equal(emergencySeat.status,201,JSON.stringify(emergencySeat.body));
  const emergencyBookingId=emergencySeat.body.booking.bookingId;
  assert.equal(emergencySeat.body.booking.paymentStatus,'Pending');
  const beforeEmergency=await request('/api/user/settlement-status',{user:2});
  assert.equal(beforeEmergency.status,200);
  assert.equal(beforeEmergency.body.hasUnpaidBooking,true);

  const departedEmergency=await event(4,'depart',crypto.randomUUID(),emergencyRideId);
  assert.equal(departedEmergency.status,200);
  const noShowCancellation=await request('/api/bookings/cancel',{
    method:'POST',user:2,csrf:csrf[2],body:{bookingId:emergencyBookingId}
  });
  assert.equal(noShowCancellation.status,409,'passenger no-show has no self-service cancellation after driver report');
  assert.equal(noShowCancellation.body.error,'JOURNEY_ALREADY_STARTED');
  const outsiderEmergencyCancel=await request('/api/rides/cancel',{
    method:'POST',user:2,csrf:csrf[2],body:{rideId:emergencyRideId}
  });
  assert.equal(outsiderEmergencyCancel.status,403);
  const emergencyCancel=await request('/api/rides/cancel',{
    method:'POST',user:4,csrf:csrf[4],body:{rideId:emergencyRideId}
  });
  assert.equal(emergencyCancel.status,200,JSON.stringify(emergencyCancel.body));
  const emergencyStored=(await pool.query(
    'SELECT status,payment_status FROM public.campus_bookings WHERE booking_id=$1',
    [emergencyBookingId])).rows[0];
  assert.equal(emergencyStored.status,'cancelled');
  assert.equal(emergencyStored.payment_status,'Pending','historical Pending marker remains in DB');
  const visibleAfterEmergency=await request('/api/bookings',{user:2});
  assert.equal(visibleAfterEmergency.status,200);
  assert.ok(!visibleAfterEmergency.body.bookings.some(b=>b.bookingId===emergencyBookingId),
    'cancelled booking disappears from normal passenger history (known gap)');
  const afterEmergency=await request('/api/user/settlement-status',{user:2});
  assert.equal(afterEmergency.status,200);
  assert.equal(afterEmergency.body.hasUnpaidBooking,false,
    'known gap: cancelled Pending booking no longer participates in settlement guard');
  assert.equal(afterEmergency.body.isBlocked,false,
    'known gap: without dispute ledger, passenger may immediately book again');

  // Separate ride: driver can self-attest every milestone without a GPS fix
  // or passenger check-in; the UI must never claim independent verification.
  const selfReported=await create(4);
  assert.equal(selfReported.status,201,JSON.stringify(selfReported.body));
  const selfReportedRideId=selfReported.body.ride.id;
  const reopened=await request('/api/bookings',{
    method:'POST',user:2,csrf:csrf[2],body:{rideId:selfReportedRideId}
  });
  assert.equal(reopened.status,201,'a post-emergency booking is currently allowed');
  const secondBookingId=reopened.body.booking.bookingId;
  for(const [action,expected] of [
    ['depart','departed'],['pickup','pickup_ready'],['arrive','arrived']
  ]){
    const reported=await event(4,action,crypto.randomUUID(),selfReportedRideId);
    assert.equal(reported.status,200,JSON.stringify(reported.body));
    assert.equal(reported.body.ride.journeyStage,expected);
  }
  const selfReportRead=await request('/api/bookings',{user:2});
  const selfReportBooking=selfReportRead.body.bookings.find(b=>b.bookingId===secondBookingId);
  assert.ok(selfReportBooking);
  assert.equal(selfReportBooking.journeyStage,'arrived');
  assert.equal(selfReportBooking.paymentStatus,'Pending');
  const stillPending=await request('/api/user/settlement-status',{user:2});
  assert.equal(stillPending.body.hasUnpaidBooking,true,
    'self-reported arrival must not auto-settle a fare');

  // Verify 010 is safe to rerun on populated CI tables and does not change
  // persisted journey state or the Pending marker.
  const fs=require('node:fs'),path=require('node:path');
  const migration010=fs.readFileSync(path.join(__dirname,'..','stage1-otp',
    'migrations','010_driver_reported_journey.sql'),'utf8');
  const beforeReplay=(await pool.query(
    'SELECT journey_stage,departed_at,pickup_at,arrived_at FROM public.campus_rides WHERE id=$1',
    [selfReportedRideId])).rows[0];
  await pool.query(migration010);
  const afterReplay=(await pool.query(
    'SELECT journey_stage,departed_at,pickup_at,arrived_at FROM public.campus_rides WHERE id=$1',
    [selfReportedRideId])).rows[0];
  assert.deepEqual(afterReplay,beforeReplay);
  const constraintCount=await pool.query(
    "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.campus_rides'::regclass AND conname='campus_ride_journey_stage_check' AND convalidated");
  assert.equal(constraintCount.rows[0].n,1);
  assert.equal((await pool.query(
    'SELECT payment_status FROM public.campus_bookings WHERE booking_id=$1',
    [secondBookingId])).rows[0].payment_status,'Pending');
  t.diagnostic('CAMPUS_ADVERSARIAL_RESULT '+JSON.stringify({
    disposableOnly:true,driverSelfReportsWithoutGpsOrPassengerConfirmation:true,
    noShowPassengerCancellationBlocked:true,emergencyDriverCancelAllowed:true,
    cancelledBookingMissingFromNormalHistory:true,
    cancelledPendingObligationStillStored:true,
    cancelledPendingIgnoredBySettlementGuard:true,
    followOnBookingAfterEmergencyAllowed:true,
    selfReportedArrivalDoesNotSettlePending:true,migration010ReplayWithData:true,
    releaseVerdict:'NO_GO_DISPUTE_AND_OBLIGATION_POLICY_UNRESOLVED'
  }));
  t.diagnostic('CAMPUS_JOURNEY_RESULT '+JSON.stringify({actors:ids.length,stages:['scheduled','departed','pickup_ready','arrived'],
    driverOnly:true,csrfRequired:true,concurrentSameKey:true,invalidOrderRejected:true,
    lateBookingClosed:true,lateCancelBlocked:true,passengerReadback:true,gpsRevokedAfterArrival:true,
    historicalPendingUnchanged:true,dbConstraint:true,arrivalHistoryRetained:true,lateTransactionClock:true}));
}
module.exports={runJourney};
