'use strict';
// Actual HTTP and disposable PostgreSQL tests, no external SMS/email/OTP provider.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

async function runBoardingPin({t,pool,ids,request}){
  assert.equal(process.env.RIDES_HTTP_BOARDING_DISPOSABLE_DB,'YES');
  const url=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/campuspool_stage1_ci');
  const csrf=[];
  for(let i=0;i<ids.length;i++){
    const session=await request('/api/auth/me',{user:i});
    assert.equal(session.status,200);
    assert.equal(session.body.boardingPinEnabled,true);
    csrf.push(session.body.csrfToken);
  }
  const create=async(driver=0,seats=2)=>request('/api/rides',{
    method:'POST',user:driver,csrf:csrf[driver],
    body:{vehicle:'Car',vehicleModel:'CI car',pickup:'CI gate',destination:'CI station',
      departureTime:'2027-01-02T09:00:00',seatsTotal:seats,uberBenchmark:100,
      studentFare:30,driverPayout:27,upiId:''}
  });
  const reserve=async(user,rideId)=>request('/api/bookings',{
    method:'POST',user,csrf:csrf[user],body:{rideId}
  });
  const move=(driver,rideId,action)=>request('/api/rides/journey',{
    method:'POST',user:driver,csrf:csrf[driver],body:{rideId,action}
  });
  const issue=(user,bookingId,validCsrf=true)=>request('/api/bookings/boarding-pin',{
    method:'POST',user,csrf:validCsrf?csrf[user]:undefined,body:{bookingId}
  });
  const verify=(user,bookingId,pin,key=crypto.randomUUID())=>
    request('/api/bookings/verify-boarding-pin',{
      method:'POST',user,csrf:csrf[user],idempotencyKey:key,body:{bookingId,pin}
    });

  const ride=await create();
  assert.equal(ride.status,201,JSON.stringify(ride.body));
  const rideId=ride.body.ride.id;
  const p1=await reserve(1,rideId),p2=await reserve(2,rideId);
  assert.equal(p1.status,201,JSON.stringify(p1.body));
  assert.equal(p2.status,201,JSON.stringify(p2.body));
  const id1=p1.body.booking.bookingId,id2=p2.body.booking.bookingId;
  const noSession=await request('/api/bookings/boarding-pin',{
    method:'POST',anonymous:true,body:{bookingId:id1}
  });
  assert.equal(noSession.status,401);
  assert.equal((await issue(1,id1,false)).status,403);
  assert.equal((await issue(1,id1)).status,409,'do not expose PIN before pickup report');
  assert.equal((await issue(3,id1)).status,403,'stranger cannot request a PIN');
  assert.equal((await issue(2,id1)).status,403,'other passenger cannot request PIN');
  assert.equal((await issue(0,id1)).status,403,'driver never reads passenger PIN');
  assert.equal((await verify(0,id1,'000000')).status,409,'driver cannot verify before pickup');
  assert.equal((await move(0,rideId,'depart')).status,200);
  assert.equal((await issue(1,id1)).status,409,'driver departure is not pickup');
  assert.equal((await move(0,rideId,'pickup')).status,200);

  const first=await issue(1,id1),repeat=await issue(1,id1);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.match(first.body.pin,/^[0-9]{6}$/);
  assert.equal(repeat.status,200);
  assert.equal(first.body.pin,repeat.body.pin,'retry in same valid window is stable');
  assert.ok(Date.parse(first.body.expiresAt)>Date.now());
  const second=await issue(2,id2);
  assert.equal(second.status,200);
  assert.match(second.body.pin,/^[0-9]{6}$/);
  const rows=await pool.query(
    'SELECT booking_id,boarding_pin_nonce,boarding_pin_expires_at,boarding_pin_attempts,boarded_at FROM public.campus_bookings WHERE booking_id=ANY($1::text[]) ORDER BY booking_id',
    [[id1,id2]]);
  assert.equal(rows.rows.length,2);
  assert.equal(new Set(rows.rows.map(r=>r.boarding_pin_nonce)).size,2,'unique per-booking seeds');
  assert.ok(rows.rows.every(r=>/^[0-9a-f]{48}$/.test(r.boarding_pin_nonce)));
  assert.ok(rows.rows.every(r=>r.boarded_at===null));
  const driverPrivate=await request('/api/bookings',{user:0});
  assert.equal(driverPrivate.status,200);
  assert.ok(driverPrivate.body.bookings.some(b=>b.bookingId===id1));
  assert.ok(driverPrivate.body.bookings.some(b=>b.bookingId===id2));
  assert.ok(driverPrivate.body.bookings.every(b=>!Object.hasOwn(b,'pin')&&!Object.hasOwn(b,'boardingPinNonce')));
  assert.equal((await request('/api/my-rides',{user:0})).body.rides[0].boardingPin,undefined);
  const passengerPrivate=await request('/api/bookings',{user:1});
  assert.ok(passengerPrivate.body.bookings.every(b=>!Object.hasOwn(b,'pin')));
  assert.equal((await verify(4,id1,first.body.pin)).status,403,'unrelated driver must be rejected');
  assert.equal((await verify(3,id1,first.body.pin)).status,403,'stranger must be rejected');
  assert.equal((await verify(0,id1,'abcd12')).status,400);
  assert.equal((await verify(0,id1,'1234567')).status,400);

  // Two concurrent verification requests with distinct idempotency keys
  // consume only one boarding event and yield one stable timestamp.
  const parallel=await Promise.all([
    verify(0,id1,first.body.pin),verify(0,id1,first.body.pin)
  ]);
  assert.ok(parallel.every(r=>r.status===200),JSON.stringify(parallel));
  assert.ok(parallel.some(r=>r.body.alreadyBoarded===true));
  const successful=parallel.find(r=>r.body.boardedAt);
  assert.ok(successful.body.boardedAt);
  const afterSuccess=(await pool.query(
    'SELECT boarded_at,boarding_pin_nonce,boarding_pin_expires_at,boarding_pin_attempts FROM public.campus_bookings WHERE booking_id=$1',[id1])).rows[0];
  assert.ok(afterSuccess.boarded_at);
  assert.equal(afterSuccess.boarding_pin_nonce,null);
  assert.equal(afterSuccess.boarding_pin_expires_at,null);
  assert.equal(afterSuccess.boarding_pin_attempts,0);
  assert.equal((await issue(1,id1)).body.alreadyBoarded,true);
  assert.equal((await verify(0,id1,first.body.pin)).body.alreadyBoarded,true);

  // Wrong guesses are counted transactionally even with concurrent different keys.
  const wrong=second.body.pin==='000000'?'999999':'000000';
  const guesses=await Promise.all([
    verify(0,id2,wrong),verify(0,id2,wrong),
    verify(0,id2,wrong),verify(0,id2,wrong),verify(0,id2,wrong)
  ]);
  assert.equal(guesses.filter(x=>x.status===409).length,4);
  assert.equal(guesses.filter(x=>x.status===429).length,1);
  assert.equal((await verify(0,id2,second.body.pin)).status,429);
  assert.equal((await issue(2,id2)).status,429,'passenger cannot reset a live lockout');
  assert.equal((await pool.query('SELECT boarding_pin_attempts FROM public.campus_bookings WHERE booking_id=$1',
    [id2])).rows[0].boarding_pin_attempts,5);
  await pool.query("UPDATE public.campus_bookings SET boarding_pin_expires_at=clock_timestamp()-interval '1 second' WHERE booking_id=$1",[id2]);
  assert.equal((await verify(0,id2,second.body.pin)).status,409);
  const renewed=await issue(2,id2);
  assert.equal(renewed.status,200,'expired code can be rotated by passenger');
  const rotated=(await pool.query('SELECT boarding_pin_attempts,boarding_pin_nonce FROM public.campus_bookings WHERE booking_id=$1',[id2])).rows[0];
  assert.equal(rotated.boarding_pin_attempts,0);
  assert.notEqual(rotated.boarding_pin_nonce,rows.rows.find(x=>x.booking_id===id2).boarding_pin_nonce);
  if(renewed.body.pin!==second.body.pin)
    assert.equal((await verify(0,id2,second.body.pin)).status,409,'old code cannot verify after rotation');

  // Arrival is vehicle-level attestation, not passenger-level confirmation.
  assert.equal((await move(0,rideId,'arrive')).status,200);
  const afterArrival=(await request('/api/bookings',{user:0})).body.bookings;
  const confirmed=afterArrival.find(b=>b.bookingId===id1);
  const notBoarded=afterArrival.find(b=>b.bookingId===id2);
  assert.ok(confirmed.boardedAt);
  assert.equal(notBoarded.boardedAt,null);
  assert.equal(confirmed.journeyStage,'arrived');
  assert.equal(notBoarded.journeyStage,'arrived');
  assert.equal(confirmed.paymentStatus,'Pending');
  assert.equal(notBoarded.paymentStatus,'Pending');
  assert.equal((await issue(2,id2)).status,409,'no issue after arrival');
  assert.equal((await verify(0,id2,renewed.body.pin)).status,409,'cannot backdate boarding after arrival');

  // Driver emergency cancellation must revoke outstanding PIN even if still
  // at pickup, with no accidental successful verification or debt settlement.
  const emergency=await create(4,1);
  assert.equal(emergency.status,201);
  const emergencyRideId=emergency.body.ride.id;
  const emergencySeat=await reserve(3,emergencyRideId);
  assert.equal(emergencySeat.status,201);
  const emergencyBookingId=emergencySeat.body.booking.bookingId;
  assert.equal((await move(4,emergencyRideId,'depart')).status,200);
  assert.equal((await move(4,emergencyRideId,'pickup')).status,200);
  const issuedEmergency=await issue(3,emergencyBookingId);
  assert.equal(issuedEmergency.status,200);
  const cancel=await request('/api/rides/cancel',{
    method:'POST',user:4,csrf:csrf[4],body:{rideId:emergencyRideId}
  });
  assert.equal(cancel.status,200);
  assert.equal((await verify(4,emergencyBookingId,issuedEmergency.body.pin)).status,409);
  assert.equal((await issue(3,emergencyBookingId)).status,409);
  assert.equal((await pool.query('SELECT payment_status FROM public.campus_bookings WHERE booking_id=$1',
    [emergencyBookingId])).rows[0].payment_status,'Pending');

  // Re-run additive 011 on real populated (disposable-only) rows.
  const before=(await pool.query('SELECT boarded_at,boarding_pin_nonce,boarding_pin_attempts FROM public.campus_bookings WHERE booking_id=$1',
    [id1])).rows[0];
  await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations','011_in_app_boarding_pin.sql'),'utf8'));
  const after=(await pool.query('SELECT boarded_at,boarding_pin_nonce,boarding_pin_attempts FROM public.campus_bookings WHERE booking_id=$1',
    [id1])).rows[0];
  assert.deepEqual(after,before);
  const constraint=await pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.campus_bookings'::regclass AND conname='campus_booking_boarding_pin_check' AND convalidated");
  assert.equal(constraint.rows[0].n,1);
  t.diagnostic('CAMPUS_BOARDING_PIN_RESULT '+JSON.stringify({
    disposableOnly:true,actors:ids.length,perBooking:true,passengerPrivate:true,
    driverOnlyVerify:true,csrfRequired:true,issuedAtPickup:true,
    wrongAttemptsLocked:true,expiryRenewal:true,concurrentSingleBoarding:true,
    arrivalDoesNotVerifyUnboardedPassenger:true,
    pendingNeverAutoSettled:true,cancelledPinRejected:true,migration011Replay:true,
    noExternalOtpOrSms:true
  }));
}
module.exports={runBoardingPin};
