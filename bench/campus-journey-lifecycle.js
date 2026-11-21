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
  assert.equal((await request('/api/rides/cancel',{method:'POST',user:4,csrf:csrf[4],body:{rideId:backup.body.ride.id}})).status,200);
  assert.equal((await event(4,'depart',crypto.randomUUID(),backup.body.ride.id)).status,404);
  t.diagnostic('CAMPUS_JOURNEY_RESULT '+JSON.stringify({actors:ids.length,stages:['scheduled','departed','pickup_ready','arrived'],
    driverOnly:true,csrfRequired:true,concurrentSameKey:true,invalidOrderRejected:true,
    lateBookingClosed:true,lateCancelBlocked:true,passengerReadback:true,gpsRevokedAfterArrival:true,
    historicalPendingUnchanged:true,dbConstraint:true,arrivalHistoryRetained:true}));
}
module.exports={runJourney};
