'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
async function runPrivacy({t,pool,ids,tokens,emails,phones,basic,port}){
  assert.equal(process.env.RIDES_HTTP_PRIVACY_DISPOSABLE_DB,'YES');
  const db=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(db.hostname));
  assert.equal(db.pathname,'/campuspool_stage1_ci');assert.equal(db.search+db.hash,'');
  const csrf=[],base='http://127.0.0.1:'+port,key=()=>crypto.randomUUID();
  async function req(route,{actor=0,body,k=key(),anon=false,etag}={}){
    const headers={Authorization:basic};
    if(!anon)headers.Cookie='cp_session='+tokens[actor];
    if(etag)headers['If-None-Match']=etag;
    if(body!==undefined)Object.assign(headers,{'Content-Type':'application/json','X-CSRF-Token':csrf[actor],'Idempotency-Key':k});
    const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    return {status:r.status,data:r.status===304?null:await r.json(),etag:r.headers.get('etag'),cache:r.headers.get('cache-control'),replayed:r.headers.get('idempotency-replayed')};
  }
  let checks=0;
  function noKeys(value,keys){
    if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){
      assert.ok(!keys.includes(k),'Protected field: '+k);noKeys(v,keys);
    }
  }
  function hidden(value,keys=['driverEmail','driverPhone','upiId']){noKeys(value,keys);checks++;}
  function denied(r,status){assert.equal(r.status,status);hidden(r.data,['driverPhone','driverEmail','passengerEmail','upiId','lat','lng','location']);}
  for(let i=0;i<ids.length;i++){const r=await req('/api/auth/me',{actor:i});assert.equal(r.status,200);csrf.push(r.data.csrfToken);}
  const input={vehicle:'Car',vehicleModel:'CI privacy vehicle',pickup:'CI Gate',destination:'CI Station',
    departureTime:'2027-02-01T17:00:00',seatsTotal:3,uberBenchmark:100,studentFare:30,driverPayout:26,
    note:'private note '+emails[0],upiId:'private-fixture@bank'};
  const bookKey=key();
  const create=await req('/api/rides',{body:input});assert.equal(create.status,201);
  const rideId=create.data.ride.id;assert.equal(create.data.ride.driverEmail,emails[0]);hidden(create.data,['driverPhone','upiId','note']);
  await pool.query("UPDATE public.campus_rides SET upi_id='historical-fixture@bank' WHERE id=$1",[rideId]);
  const feed=await req('/api/rides',{actor:3});assert.equal(feed.status,200);assert.equal(feed.cache,'no-store');
  assert.ok(feed.data.rides.some(r=>r.id===rideId));
  hidden(feed.data,['driverEmail','driverPhone','passengerEmail','upiId','note','driverUserId','pickupCoordinates','destinationCoordinates','lat','lng']);
  assert.ok(!JSON.stringify(feed.data).includes(emails[0]));assert.ok(!JSON.stringify(feed.data).includes(phones[0]));
  assert.deepEqual((await req('/api/rides',{actor:0})).data,feed.data);
  assert.equal((await req('/api/rides',{actor:1,etag:feed.etag})).status,304);
  denied(await req('/api/rides',{anon:true}),401);
  const own=await req('/api/my-rides',{actor:0});assert.equal(own.data.rides[0].driverEmail,emails[0]);hidden(own.data,['driverPhone','upiId']);
  denied(await req('/api/my-rides?email='+encodeURIComponent(emails[0]),{actor:3}),403);
  const first=await req('/api/bookings',{actor:1,body:{rideId},k:bookKey});assert.equal(first.status,201);
  const bid=first.data.booking.bookingId;assert.equal(first.data.booking.passengerEmail,emails[1]);hidden(first.data);
  assert.equal((await req('/api/bookings',{actor:2,body:{rideId}})).status,201);
  const active=await req('/api/bookings',{actor:1});assert.equal(active.data.bookings.length,1);
  assert.equal(active.data.bookings[0].driverPhone,phones[0]);hidden(active.data,['driverEmail','upiId']);
  const driver=await req('/api/bookings',{actor:0});assert.equal(driver.data.bookings.length,2);hidden(driver.data,['passengerEmail','driverPhone','upiId']);
  assert.deepEqual((await req('/api/bookings',{actor:3})).data.bookings,[]);
  denied(await req('/api/bookings?email='+encodeURIComponent(emails[1]),{actor:3}),403);
  const settle=await req('/api/user/settlement-status',{actor:1});assert.equal(settle.data.hasUnpaidBooking,true);hidden(settle.data);
  const blocked=await req('/api/bookings',{actor:1,body:{rideId}});assert.equal(blocked.status,403);hidden(blocked.data);
  const actorHash=crypto.createHash('sha256').update('campus-user:'+ids[1]).digest('hex');
  const stored=(await pool.query('SELECT response_json FROM public.campus_idempotency_keys WHERE actor_hash=$1 AND route=$2 AND request_key=$3',[actorHash,'POST /api/bookings',bookKey])).rows[0].response_json;
  const obj=typeof stored==='string'?JSON.parse(stored):stored;hidden(obj);
  const legacy={...obj,booking:{...obj.booking,driverEmail:emails[0],driverPhone:phones[0],upiId:'legacy-fixture@bank'}};
  await pool.query('UPDATE public.campus_idempotency_keys SET response_json=$4 WHERE actor_hash=$1 AND route=$2 AND request_key=$3',[actorHash,'POST /api/bookings',bookKey,JSON.stringify(legacy)]);
  const replay=await req('/api/bookings',{actor:1,body:{rideId},k:bookKey});assert.equal(replay.replayed,'true');hidden(replay.data);
  const gps='/api/rides/location',pgps='/api/bookings/passenger-location';
  const lease=(await req(gps,{actor:0,body:{rideId,action:'start'}})).data.lease;
  const write=await req(gps,{actor:0,body:{rideId,action:'update',lease,lat:18.5,lng:73.9,accuracy:10,speed:0,heading:0,capturedAt:Date.now()}});assert.equal(write.status,200);hidden(write.data,['driverEmail','passengerEmail']);
  const read=await req(gps+'?rideId='+rideId,{actor:1});assert.equal(read.status,200);assert.equal(read.data.location.lat,18.5);hidden(read.data,['driverEmail','passengerEmail']);
  denied(await req(gps+'?rideId='+rideId,{actor:3}),403);
  denied(await req(gps,{actor:1,body:{rideId,action:'start'}}),403);
  const passengerLease=(await req(pgps,{actor:1,body:{bookingId:bid,action:'start'}})).data.lease;
  const pw=await req(pgps,{actor:1,body:{bookingId:bid,action:'update',lease:passengerLease,lat:18.51,lng:73.91,accuracy:10,capturedAt:Date.now()}});assert.equal(pw.status,200);hidden(pw.data,['driverEmail','passengerEmail']);
  const pr=await req(pgps+'?bookingId='+bid,{actor:0});assert.equal(pr.status,200);assert.equal(pr.data.location.lat,18.51);hidden(pr.data,['driverEmail','passengerEmail']);
  denied(await req(pgps+'?bookingId='+bid,{actor:2}),403);
  denied(await req(pgps+'?bookingId='+bid,{actor:3}),403);
  denied(await req(pgps,{actor:2,body:{bookingId:bid,action:'start'}}),403);
  assert.equal((await req('/api/bookings/cancel',{actor:1,body:{bookingId:bid}})).status,200);
  assert.deepEqual((await req('/api/bookings',{actor:1})).data.bookings,[]);
  denied(await req(gps+'?rideId='+rideId,{actor:1}),403);
  denied(await req(pgps+'?bookingId='+bid,{actor:1}),403);
  denied(await req(pgps+'?bookingId='+bid,{actor:0}),403);
  const after=await req('/api/bookings',{actor:1,body:{rideId},k:bookKey});assert.equal(after.status,201);assert.equal(after.replayed,'true');assert.equal(after.data.booking.bookingId,bid);hidden(after.data);
  assert.equal((await req('/api/rides/cancel',{actor:0,body:{rideId}})).status,200);
  denied(await req(gps+'?rideId='+rideId,{actor:0}),403);denied(await req(gps+'?rideId='+rideId,{actor:2}),403);
  assert.deepEqual((await req('/api/bookings',{actor:2})).data.bookings,[]);
  let limited=false;
  for(let i=0;i<78;i++){const r=await req('/api/bookings/payment-status',{body:{}});if(r.status===429){limited=true;break;}assert.equal(r.status,501);}
  assert.ok(limited);
  const throttled=await req('/api/bookings',{actor:1,body:{rideId},k:bookKey});assert.equal(throttled.status,201);assert.equal(throttled.replayed,'true');hidden(throttled.data);
  const rows=(await pool.query("SELECT seats_left::int AS available,seats_total::int AS total,status,(SELECT count(*)::int FROM public.campus_bookings WHERE ride_id=$1 AND status='active') AS active FROM public.campus_rides WHERE id=$1",[rideId])).rows;
  assert.deepEqual(rows,[{available:3,total:3,status:'cancelled',active:0}]);
  t.diagnostic('CAMPUS_PRIVACY_RESULT '+JSON.stringify({projectionChecks:checks,actors:4,activePassengerContact:true,discoveryRedacted:true,legacyReceiptRedacted:true,normalAndThrottledReplay:true,gpsIsolation:true,cancelRevocation:true,seatInvariant:true,upiWithheld:true}));
}
module.exports={runPrivacy};
