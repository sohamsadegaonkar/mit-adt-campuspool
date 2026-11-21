'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {PgRidesStore}=require('../stage1-otp/rides-store');
async function runPilot({t,pool,ids,tokens,basic,port}){
  assert.equal(process.env.RIDES_HTTP_FREE_PILOT_DISPOSABLE_DB,'YES');
  const u=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));assert.equal(u.pathname,'/campuspool_stage1_ci');assert.equal(u.search+u.hash,'');
  const base='http://127.0.0.1:'+port,csrf=[],key=()=>crypto.randomUUID();
  async function req(route,actor=0,body,k=key(),badCsrf=false){
    const headers={Authorization:basic,Cookie:'cp_session='+tokens[actor]};
    if(body!==undefined)Object.assign(headers,{'Content-Type':'application/json','X-CSRF-Token':badCsrf?'bad':csrf[actor],'Idempotency-Key':k});
    const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    return {status:res.status,data:await res.json(),replayed:res.headers.get('idempotency-replayed')};
  }
  for(let i=0;i<ids.length;i++){const a=await req('/api/auth/me',i);assert.equal(a.status,200);assert.equal(a.data.freeRidesPilot,true);csrf.push(a.data.csrfToken);}
  const free={vehicle:'Car',vehicleModel:'CI volunteer car',pickup:'CI Gate',destination:'CI Station',departureTime:'2027-02-01T17:00:00',seatsTotal:2,uberBenchmark:0,studentFare:0,driverPayout:0,upiId:'',note:''};
  const legacy=new PgRidesStore({pool});
  const paid=await legacy.createRide({driverUserId:ids[2],ride:{...free,uberBenchmark:100,studentFare:30,driverPayout:27}});
  const oldZero=await legacy.createRide({driverUserId:ids[3],ride:free});
  const oldPaidBooking=await legacy.bookRide({rideId:paid.id,passengerUserId:ids[4]});
  const oldZeroBooking=await legacy.bookRide({rideId:oldZero.id,passengerUserId:ids[5]});
  const snapshot=async()=>(await pool.query("SELECT booking_id,payment_status,payment_mode,student_fare::text AS fare FROM public.campus_bookings WHERE booking_id=ANY($1::text[]) ORDER BY booking_id",[[oldPaidBooking.bookingId,oldZeroBooking.bookingId]])).rows;
  const before=await snapshot();
  assert.equal(before.length,2);assert.ok(before.every(b=>b.payment_status==='Pending'&&b.payment_mode==='legacy'));
  await pool.query(fs.readFileSync(path.join(__dirname,'../stage1-otp/migrations/009_free_rides_pilot.sql'),'utf8'));assert.deepEqual(await snapshot(),before);
  for(const patch of [{studentFare:1},{driverPayout:1},{uberBenchmark:1},{upiId:'synthetic@bank'},{studentFare:'0'},{studentFare:null}]){
    const x=await req('/api/rides',0,{...free,...patch});assert.equal(x.status,400);assert.equal(x.data.error,'FREE_PILOT_ZERO_FARE_REQUIRED');
  }
  const k1=key(),a=await req('/api/rides',0,free,k1);
  assert.equal(a.status,201);assert.equal(a.data.ride.paymentMode,'free_pilot');assert.equal(a.data.ride.studentFare,0);
  const rid=a.data.ride.id;
  const again=await req('/api/rides',0,free,k1);assert.equal(again.replayed,'true');assert.deepEqual(again.data,a.data);
  const b=await req('/api/rides',0,{...free,destination:'CI Second Station'});assert.equal(b.status,201);const rid2=b.data.ride.id;
  const feed=await req('/api/rides',1);assert.equal(feed.status,200);assert.ok(feed.data.rides.some(r=>r.id===rid));assert.ok(feed.data.rides.every(r=>r.paymentMode==='free_pilot'));
  for(const id of [paid.id,oldZero.id])assert.equal((await req('/api/bookings',1,{rideId:id})).data.error,'RIDE_PAYMENT_MODE_UNAVAILABLE');
  for(const actor of [4,5]){assert.equal((await req('/api/user/settlement-status',actor)).data.hasUnpaidBooking,true);const blocked=await req('/api/bookings',actor,{rideId:rid});assert.equal(blocked.status,403);assert.equal(blocked.data.error,'SETTLEMENT_REQUIRED');}
  // Reserved seats on a legacy ride never prove a collectible driver commission.
  const driverReview=await req('/api/user/settlement-status',2);
  assert.equal(driverReview.status,200);
  assert.equal(driverReview.data.commissionDue,0);
  assert.equal(driverReview.data.hasUnsettledCommission,false);
  assert.equal(driverReview.data.isBlocked,false);
  assert.equal(driverReview.data.driverReviewCount,1);
  assert.equal(driverReview.data.hasReviewRequired,true);
  const commission=await req('/api/rides',2,free);
  assert.equal(commission.status,201,'phantom legacy commission must not block zero-fare service');
  assert.equal(commission.data.ride.paymentMode,'free_pilot');
  assert.equal((await req('/api/bookings',1,{rideId:rid},key(),true)).status,403);
  assert.equal((await req('/api/bookings',0,{rideId:rid})).data.error,'OWN_RIDE');
  const bk=key(),pair=await Promise.all([req('/api/bookings',1,{rideId:rid},bk),req('/api/bookings',1,{rideId:rid},bk)]);
  assert.ok(pair.every(x=>x.status===201&&x.data.booking.paymentStatus==='NoPaymentRequired'&&x.data.booking.paymentMode==='free_pilot'&&x.data.booking.studentFare===0));
  assert.equal(pair[0].data.booking.bookingId,pair[1].data.booking.bookingId);assert.equal(pair.filter(x=>x.replayed==='true').length,1);
  assert.equal((await req('/api/bookings',1,{rideId:rid})).data.error,'ALREADY_BOOKED');
  assert.equal((await req('/api/bookings',1,{rideId:rid2})).status,201);
  assert.equal((await req('/api/bookings',6,{rideId:rid})).status,201);
  assert.equal((await req('/api/bookings',3,{rideId:rid})).data.error,'RIDE_FULL');
  for(const actor of [0,1,6]){const st=await req('/api/user/settlement-status',actor);assert.equal(st.status,200);assert.equal(st.data.isBlocked,false);assert.equal(st.data.commissionDue,0);assert.deepEqual(st.data.pendingBookings,[]);}
  assert.equal((await req('/api/rides',0,{...free,destination:'CI Third Station'})).status,201);
  const bid=pair[0].data.booking.bookingId;
  assert.equal((await req('/api/bookings/payment-status',1,{bookingId:bid,paymentStatus:'Paid'})).status,501);
  assert.equal((await req('/api/driver/settle-commission',0,{amount:0})).status,501);
  const bad=async(sql,args)=>assert.equal((await pool.query(sql,args).then(()=>null,e=>e))?.code,'23514');
  await bad('UPDATE public.campus_rides SET student_fare=1 WHERE id=$1',[rid]);
  await bad("UPDATE public.campus_bookings SET payment_status='Paid' WHERE booking_id=$1",[bid]);
  await bad("UPDATE public.campus_bookings SET payment_status='NoPaymentRequired' WHERE booking_id=$1",[oldZeroBooking.bookingId]);
  assert.equal((await pool.query("UPDATE public.campus_bookings SET payment_mode='free_pilot',payment_status='NoPaymentRequired' WHERE booking_id=$1",[oldZeroBooking.bookingId]).then(()=>null,e=>e))?.code,'23503');
  await assert.rejects(legacy.bookRide({rideId:rid2,passengerUserId:ids[6]}),{code:'RIDE_PAYMENT_MODE_UNAVAILABLE'});
  assert.equal((await req('/api/bookings/cancel',1,{bookingId:bid})).status,200);
  const replay=await req('/api/bookings',1,{rideId:rid},bk);assert.equal(replay.replayed,'true');assert.equal(replay.data.booking.bookingId,bid);
  const state=(await pool.query("SELECT r.seats_left::int AS available,r.seats_total::int AS total,(SELECT count(*)::int FROM public.campus_bookings b WHERE b.ride_id=r.id AND b.status='active')::int AS active FROM public.campus_rides r WHERE r.id=$1",[rid])).rows[0];
  assert.deepEqual(state,{available:1,total:2,active:1});assert.deepEqual(await snapshot(),before);
  const counts=(await pool.query("SELECT count(*)::int AS n,count(*) FILTER(WHERE b.student_fare<>0 OR b.payment_status<>'NoPaymentRequired' OR b.upi_id<>'')::int AS bad FROM public.campus_bookings b JOIN public.campus_rides r ON r.id=b.ride_id WHERE r.driver_user_id=ANY($1::uuid[]) AND r.payment_mode='free_pilot'",[ids])).rows[0];
  assert.deepEqual(counts,{n:3,bad:0});
  t.diagnostic('CAMPUS_FREE_PILOT_RESULT '+JSON.stringify({actors:ids.length,freeBookings:counts.n,monetaryViolations:counts.bad,legacyObligationsPreserved:2,zeroFareLegacyStillBlocked:true,legacyDriverCommissionReviewNotCollectible:true,repeatBooking:true,driverCanOfferAgain:true,duplicateReplay:true,modeIsolation:true,dbConstraints:true,migrationReapply:true,cancelSeatInvariant:true,paymentApisDisabled:true}));
}
module.exports={runPilot};
