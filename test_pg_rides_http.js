'use strict';
// End-to-end HTTP contract for opt-in PostgreSQL Rides using a disposable local DB.
// Never run against Render, Supabase, or a database with real student records.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {Pool}=require('pg');
const {migrate}=require('./stage1-otp/migrate');
const {CampusPgPool,PgPoolBusyError}=require('./stage1-otp/pg-store');

const url=process.env.OTP_DATABASE_URL;
const stress=process.env.RIDES_HTTP_STRESS_DISPOSABLE_DB==='YES';
if(stress){
  assert.ok(url,'Stress requires disposable PostgreSQL');
  const u=new URL(url);
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
  assert.equal(u.pathname,'/campuspool_stage1_ci');
  assert.equal(u.search,'');
  assert.equal(u.hash,'');
}
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)){
  throw Error('Refusing to run HTTP Rides tests against a nonlocal PostgreSQL database');
}
function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const p=server.address().port;
      server.close(()=>resolve(p));
    });
  });
}
function waitForServer(child){
  return new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(Error('Server startup timed out: '+output.slice(-500))),22000);
    const onData=chunk=>{
      output+=String(chunk).slice(0,1000);
      if(output.includes('active on port')){
        clearTimeout(timer);child.stdout.off('data',onData);resolve();
      }
    };
    child.stdout.on('data',onData);
    child.stderr.on('data',chunk=>{output+=String(chunk).slice(0,600)});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+': '+output.slice(-600)))});
  });
}
test('HTTP rides and bookings switch to verified PostgreSQL user identities',
 {skip:!url?'requires local isolated CI PostgreSQL':false,timeout:120000},async t=>{
  await migrate({connectionString:url,ssl:false});
  const pool=new Pool({connectionString:url,ssl:false});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-rides-http-'));
  const ids=Array.from({length:stress?6:2},()=>crypto.randomUUID());
  const email=i=>'rides-http-'+crypto.randomBytes(6).toString('hex')+'@students.mituniversity.edu.in';
  const emails=ids.map((_,i)=>email(i));
  const phoneBase=crypto.randomInt(1000000,9000000);
  const phones=ids.map((_,i)=>'976'+String(phoneBase+i));
  const appName='cp_http_stress_'+crypto.randomBytes(6).toString('hex');
  const tokens=ids.map(()=>crypto.randomBytes(32).toString('base64url'));
  const pass='ci-private-'+crypto.randomBytes(32).toString('hex');
  const basic='Basic '+Buffer.from('staging:'+pass).toString('base64');
  const port=await freePort();
  let child,rideId,bookingId;
  const base='http://127.0.0.1:'+port;
  async function request(endpoint,{method='GET',user=0,body,csrf,anonymous=false,idempotencyKey}={}){
    const headers={Authorization:basic};
    if(!anonymous)headers.Cookie='cp_session='+tokens[user];
    if(body!==undefined)headers['Content-Type']='application/json';
    if(csrf)headers['x-csrf-token']=csrf;
    if(method==='POST' && ['/api/rides','/api/bookings','/api/rides/cancel','/api/bookings/cancel'].includes(endpoint))
      headers['Idempotency-Key']=idempotencyKey||crypto.randomUUID();
    const response=await fetch(base+endpoint,{method,headers,signal:AbortSignal.timeout(15000),body:body===undefined?undefined:JSON.stringify(body)});
    let json;try{json=await response.json();}catch{json=null;}
    return {status:response.status,body:json,replayed:response.headers.get('Idempotency-Replayed'),retryAfter:response.headers.get('Retry-After')};
  }
  try{
    if(stress){
      const target=await pool.query('SELECT current_database() AS db');
      assert.equal(target.rows[0].db,'campuspool_stage1_ci');
    }
    await pool.query('INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified) SELECT * FROM unnest($1::uuid[],$2::text[],$3::text[],$4::text[],$5::text[],$6::boolean[])',
      [ids,ids.map((_,i)=>'CI User '+i),emails,phones,ids.map(()=> 'Testing'),ids.map(()=>true)]);
    for(let i=0;i<ids.length;i++){
      const hash=crypto.createHash('sha256').update(tokens[i]).digest('hex');
      await pool.query(
        "INSERT INTO public.campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [hash,ids[i]]);
    }
    child=spawn(process.execPath,['server.js'],{cwd:__dirname,
      env:{...process.env,PORT:String(port),NODE_ENV:'production',APP_ENV:'staging',
        STAGING_BASIC_AUTH_PASSWORD:pass,AUTH_OTP_BACKEND:'postgres',RIDES_BACKEND:'postgres',
        OTP_DB_SSL:'false',OTP_HMAC_KEY:'ci-only-'+crypto.randomBytes(32).toString('hex'),
        OTP_SECRET:crypto.randomBytes(32).toString('hex'),ENABLE_CLUSTER:'false',
        DATABASE_PATH:path.join(temp,'ephemeral.db'),
        EMAIL_PROVIDER:'disabled',SMS_PROVIDER:'disabled',PGAPPNAME:appName
      },stdio:['ignore','pipe','pipe']});
    await waitForServer(child);
    const ready=await request('/healthz',{anonymous:true});
    assert.equal(ready.status,200);
    const blocked=await fetch(base+'/api/rides',{headers:{}});
    assert.equal(blocked.status,401);
    const driver=await request('/api/auth/me',{user:0});
    const passenger=await request('/api/auth/me',{user:1});
    assert.equal(driver.status,200);assert.equal(passenger.status,200);
    assert.equal(driver.body.user.email,emails[0]);
    assert.equal(passenger.body.user.email,emails[1]);
    const csrfDriver=driver.body.csrfToken,csrfPassenger=passenger.body.csrfToken;
    const rideInput={vehicle:'Car',vehicleModel:'CI Vehicle',pickup:'CI Pickup',
      destination:'CI Destination',departureTime:'2027-02-01T09:00:00',
      seatsTotal:1,uberBenchmark:100,studentFare:30,driverPayout:26,
      driverEmail:emails[1],driverName:'Spoofed',note:'HTTP CI only'};
    const noCsrf=await request('/api/rides',{method:'POST',user:0,body:rideInput});
    assert.equal(noCsrf.status,403);
    const spoof=await request('/api/rides',{method:'POST',user:0,body:rideInput,csrf:csrfDriver});
    assert.equal(spoof.status,403,'The HTTP boundary rejects spoofed driver emails');
    const cleanInput={...rideInput};
    delete cleanInput.driverEmail;
    delete cleanInput.driverName;
    const rideKey=crypto.randomUUID();
    const created=await request('/api/rides',{method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(created.status,201,JSON.stringify(created.body));
    rideId=created.body.ride.id;
    const rideReplay=await request('/api/rides',{method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(rideReplay.status,201);
    assert.equal(rideReplay.body.ride.id,rideId);
    assert.equal(rideReplay.replayed,'true');
    const collision=await request('/api/rides',{method:'POST',user:0,body:{...cleanInput,note:'Changed'},csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(collision.status,409);
    assert.equal(collision.body.error,'IDEMPOTENCY_KEY_REUSED');
    assert.equal(created.body.ride.driverEmail,emails[0]);
    const visible=await request('/api/rides',{user:1});
    assert.equal(visible.status,200);
    assert.equal(visible.body.rides.some(r=>r.id===rideId),true);
    const cannotBookSelf=await request('/api/bookings',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId}});
    assert.equal(cannotBookSelf.status,403,JSON.stringify(cannotBookSelf.body));
    const bookKey=crypto.randomUUID();
    const seat=await request('/api/bookings',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId,passengerEmail:emails[1]},idempotencyKey:bookKey});
    assert.equal(seat.status,201,JSON.stringify(seat.body));
    bookingId=seat.body.booking.bookingId;
    // Previously a replay failed the unpaid-booking guard. It must now
    // return the original booking without consuming a second seat.
    const seatReplay=await request('/api/bookings',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId,passengerEmail:emails[1]},idempotencyKey:bookKey});
    assert.equal(seatReplay.status,201);
    assert.equal(seatReplay.body.booking.bookingId,bookingId);
    assert.equal(seatReplay.replayed,'true');
    const booked=await request('/api/rides',{user:0});
    assert.equal(booked.body.rides.find(r=>r.id===rideId).seatsLeft,0);
    const wrongCancel=await request('/api/bookings/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{bookingId}});
    assert.equal(wrongCancel.status,403);
    const cancelKey=crypto.randomUUID();
    const cancelled=await request('/api/bookings/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{bookingId},idempotencyKey:cancelKey});
    assert.equal(cancelled.status,200);
    const cancelReplay=await request('/api/bookings/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{bookingId},idempotencyKey:cancelKey});
    assert.equal(cancelReplay.status,200);
    assert.equal(cancelReplay.replayed,'true');
    const restored=await request('/api/rides',{user:1});
    assert.equal(restored.body.rides.find(r=>r.id===rideId).seatsLeft,1);
    const wrongRide=await request('/api/rides/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId}});
    assert.equal(wrongRide.status,403);
    const cancelRideKey=crypto.randomUUID();
    const cancelRide=await request('/api/rides/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId},idempotencyKey:cancelRideKey});
    assert.equal(cancelRide.status,200);
    const rideCancelReplay=await request('/api/rides/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId},idempotencyKey:cancelRideKey});
    assert.equal(rideCancelReplay.status,200);
    assert.equal(rideCancelReplay.replayed,'true');
    if(stress){
      const csrf=[csrfDriver,csrfPassenger];
      for(let user=2;user<ids.length;user++){
        const session=await request('/api/auth/me',{user});
        assert.equal(session.status,200);
        csrf[user]=session.body.csrfToken;
      }
      let attempts=0;
      const durations=[];
      const codes={};
      const send=async(endpoint,user,body,key=crypto.randomUUID(),extra={})=>{
        const start=performance.now();
        const r=await request(endpoint,{method:'POST',user,body,csrf:csrf[user],idempotencyKey:key,...extra});
        durations.push(performance.now()-start);attempts++;
        const label=r.status+':'+(r.body?.error||'OK');
        codes[label]=(codes[label]||0)+1;
        return r;
      };
      const create=async()=>{
        const r=await send('/api/rides',0,{...cleanInput,seatsTotal:2});
        assert.equal(r.status,201);
        return r.body.ride.id;
      };
      const a=await create(),b=await create();
      let snapshots=0;
      async function invariant(id){
        const {rows}=await pool.query(`SELECT r.status,r.seats_total::int AS total,r.seats_left::int AS available,
          count(b.booking_id) FILTER (WHERE b.status='active')::int AS active,
          count(DISTINCT b.passenger_user_id) FILTER (WHERE b.status='active')::int AS distinct_active
          FROM public.campus_rides r LEFT JOIN public.campus_bookings b ON b.ride_id=r.id
          WHERE r.id=$1 GROUP BY r.id`,[id]);
        assert.equal(rows.length,1);
        const state=rows[0];snapshots++;
        assert.equal(state.available+state.active,state.total);
        assert.ok(state.available>=0&&state.available<=state.total);
        assert.equal(state.active,state.distinct_active);
        if(state.status==='cancelled')assert.equal(state.active,0);
        return state;
      }
      // Same actor, two distinct rides, two keys, plus a same-key retry.
      // The actor lock must prevent two simultaneous unpaid obligations.
      const keyA=crypto.randomUUID(),keyB=crypto.randomUUID();
      const actorRace=await Promise.all([
        send('/api/bookings',1,{rideId:a},keyA),
        send('/api/bookings',1,{rideId:a},keyA),
        send('/api/bookings',1,{rideId:b},keyB)
      ]);
      const winners=actorRace.filter(r=>r.status===201);
      assert.equal(winners.filter(r=>r.replayed!=='true').length,1);
      for(const r of actorRace)assert.ok(r.status===201||(r.status===403&&r.body.error==='SETTLEMENT_REQUIRED'));
      assert.equal(new Set(winners.map(r=>r.body.booking.bookingId)).size,1);
      const won=winners[0].body.booking;
      const losingRide=won.rideId===a?b:a;
      assert.equal((await invariant(a)).active+(await invariant(b)).active,1);
      const before=await request('/api/user/settlement-status',{user:1});
      assert.equal(before.status,200);assert.equal(before.body.hasUnpaidBooking,true);
      // Concurrent bookings, legitimate passenger cancellation and owner
      // cancellation; unauthorized attempts on the other, active ride.
      const driverKey=crypto.randomUUID(),cancelKey2=crypto.randomUUID();
      const mixed=await Promise.all([
        send('/api/bookings/cancel',1,{bookingId:won.bookingId},cancelKey2),
        send('/api/bookings/cancel',1,{bookingId:won.bookingId},cancelKey2),
        send('/api/rides/cancel',0,{rideId:won.rideId},driverKey),
        send('/api/rides/cancel',0,{rideId:won.rideId},driverKey),
        send('/api/bookings',2,{rideId:won.rideId}),
        send('/api/bookings',3,{rideId:won.rideId}),
        send('/api/bookings',4,{rideId:won.rideId}),
        send('/api/bookings',5,{rideId:won.rideId}),
        send('/api/rides/cancel',2,{rideId:losingRide}),
        send('/api/bookings',3,{rideId:losingRide},crypto.randomUUID(),{csrf:csrf[4]}),
        send('/api/bookings',4,{rideId:losingRide},crypto.randomUUID(),{anonymous:true}),
        send('/api/bookings',5,{rideId:losingRide,passengerEmail:emails[2]})
      ]);
      for(const r of mixed.slice(0,2))assert.ok(r.status===200||(r.status===404&&r.body.error==='BOOKING_NOT_FOUND'));
      assert.equal(mixed[2].status,200);assert.equal(mixed[3].status,200);
      assert.equal(mixed.slice(2,4).filter(r=>r.replayed==='true').length,1);
      for(const r of mixed.slice(4,8))assert.ok(r.status===201||
        (r.status===404&&r.body.error==='RIDE_NOT_FOUND')||(r.status===409&&r.body.error==='RIDE_FULL'));
      assert.equal(mixed[8].status,403);assert.equal(mixed[8].body.error,'NOT_RIDE_OWNER');
      assert.equal(mixed[9].status,403);assert.equal(mixed[9].body.error,'CSRF_REQUIRED');
      assert.equal(mixed[10].status,401);
      assert.equal(mixed[11].status,403);assert.equal(mixed[11].body.error,'NOT_ALLOWED');
      assert.equal((await invariant(won.rideId)).status,'cancelled');
      assert.equal((await invariant(losingRide)).active,0,'Denied requests must not book');
      const after=await request('/api/user/settlement-status',{user:1});
      assert.equal(after.body.hasUnpaidBooking,false);
      const retry=await send('/api/bookings',1,{rideId:losingRide});
      assert.equal(retry.status,201,'Cancellation must release unpaid-booking block');
      assert.equal((await invariant(losingRide)).active,1);
      const finish=await send('/api/rides/cancel',0,{rideId:losingRide});
      assert.equal(finish.status,200);
      assert.equal((await invariant(losingRide)).status,'cancelled');
      // Prove both pg-pool acquisition APIs classify only the real pending
      // deadline. A real SQL failure is still the original PG error.
      const tinyPool=new CampusPgPool({connectionString:url,ssl:false,max:1,connectionTimeoutMillis:100});
      try{
        const held=await tinyPool.connect();
        try{
          await assert.rejects(tinyPool.connect(),e=>e instanceof PgPoolBusyError);
          await assert.rejects(tinyPool.query('SELECT 1'),e=>e instanceof PgPoolBusyError);
        }finally{held.release();}
        await assert.rejects(tinyPool.query('SELECT cp_nonexistent_column'),e=>e.code==='42703'&&!(e instanceof PgPoolBusyError));
        assert.equal((await tinyPool.query('SELECT 1 AS n')).rows[0].n,1);
      }finally{await tinyPool.end();}
      const pressureRide=await create();
      const pressureKey=crypto.randomUUID();
      const pressureActorHash=crypto.createHash('sha256').update('campus-user:'+ids[1]).digest('hex');
      const receiptCount=async()=>Number((await pool.query(
        "SELECT count(*)::int AS n FROM public.campus_idempotency_keys WHERE actor_hash=$1 AND route='POST /api/bookings' AND request_key=$2",
        [pressureActorHash,pressureKey])).rows[0].n);
      // Real five-connection saturation: lock session reads in the separate
      // disposable observer connection; never inject a fake PG error.
      const blocker=await pool.connect();
      let blocked=[],queued=[];
      let peakLocked=0;
      let timeoutResponses=[];
      const pressureStart=performance.now();
      try{
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE public.campus_sessions IN ACCESS EXCLUSIVE MODE');
        blocked=Array.from({length:5},()=>request('/api/auth/me',{user:1}));
        const deadline=performance.now()+3000;
        while(performance.now()<deadline){
          const {rows}=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[appName]);
          peakLocked=Math.max(peakLocked,rows[0].n);
          if(peakLocked===5)break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(peakLocked,5,'All five app pool connections must be occupied');
        queued=[
          request('/api/auth/me',{user:1}),
          request('/api/bookings',{method:'POST',user:1,csrf:csrf[1],body:{rideId:pressureRide},idempotencyKey:pressureKey}),
          request('/api/bookings',{method:'POST',user:1,csrf:csrf[1],body:{rideId:pressureRide},idempotencyKey:pressureKey})
        ];
        const health=await request('/healthz',{anonymous:true});
        assert.equal(health.status,200,'Public health remains responsive');
        timeoutResponses=await Promise.all(queued);
        for(const r of timeoutResponses){
          assert.equal(r.status,503);
          assert.equal(r.body.error,'DB_POOL_BUSY');
          assert.equal(r.body.success,false);
          assert.ok(['2','3','4'].includes(r.retryAfter));
          assert.equal(Number(r.retryAfter),r.body.retryAfter);
          assert.match(r.body.message,/campus traffic jam/);
          assert.equal(r.replayed,null);
        }
        assert.equal(await receiptCount(),0,'Overload cannot reserve a receipt');
        assert.equal((await invariant(pressureRide)).active,0,'Overload cannot consume a seat');
      }finally{
        try{await blocker.query('ROLLBACK');}finally{blocker.release();}
        const drained=await Promise.allSettled([...blocked,...queued]);
        for(const r of drained)assert.equal(r.status,'fulfilled');
      }
      for(const r of await Promise.all(blocked))assert.equal(r.status,200);
      const recovered=await Promise.all(Array.from({length:8},()=>request('/api/auth/me',{user:1})));
      assert.ok(recovered.every(r=>r.status===200),'Pool must recover when lock releases');
      const retried=await request('/api/bookings',{method:'POST',user:1,csrf:csrf[1],
        body:{rideId:pressureRide},idempotencyKey:pressureKey});
      assert.equal(retried.status,201);
      assert.equal(retried.replayed,null);
      const replayed=await request('/api/bookings',{method:'POST',user:1,csrf:csrf[1],
        body:{rideId:pressureRide},idempotencyKey:pressureKey});
      assert.equal(replayed.status,201);
      assert.equal(replayed.replayed,'true');
      assert.equal(replayed.body.booking.bookingId,retried.body.booking.bookingId);
      assert.equal(await receiptCount(),1);
      assert.equal((await invariant(pressureRide)).active,1);
      const pressureCancel=await request('/api/rides/cancel',{method:'POST',user:0,csrf:csrf[0],body:{rideId:pressureRide}});
      assert.equal(pressureCancel.status,200);
      assert.equal((await invariant(pressureRide)).status,'cancelled');
      const sorted=durations.sort((a,b)=>a-b);
      t.diagnostic('HTTP_RIDES_STRESS_RESULT '+JSON.stringify({
        attempts,codes,snapshots,actorOriginalSuccesses:1,deniedWithoutMutation:4,
        poolConnectionsBlocked:peakLocked,poolAcquireTimeouts:timeoutResponses.length,
        timeoutHttpStatus:503,acquisitionApisVerified:2,sqlErrorPreserved:true,overloadMutationAttempts:2,sameKeyRecovery:true,recovered:recovered.length,pressureMs:Math.round(performance.now()-pressureStart),
        p50Ms:Number(sorted[Math.ceil(sorted.length*.5)-1].toFixed(2)),
        p95Ms:Number(sorted[Math.ceil(sorted.length*.95)-1].toFixed(2)),
        unexpectedMixedMutationErrors:0
      }));
    }
    // Once the global per-IP mutation bucket is full, only authenticated,
    // already-committed same-key receipts are eligible for bounded replay.
    let limited=false;
    for(let i=0;i<75;i++){
      const hit=await request('/api/bookings/payment-status',{
        method:'POST',user:0,csrf:csrfDriver,body:{}
      });
      if(hit.status===429){limited=true;break;}
      assert.equal(hit.status,501);
    }
    assert.equal(limited,true,'Mutation rate limit must be enforceable');
    const overLimitReplay=await request('/api/rides',{
      method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:rideKey
    });
    assert.equal(overLimitReplay.status,201,JSON.stringify(overLimitReplay.body));
    assert.equal(overLimitReplay.replayed,'true');
    assert.equal(overLimitReplay.body.ride.id,rideId);
    const overLimitMismatch=await request('/api/rides',{
      method:'POST',user:0,body:{...cleanInput,note:'Changed again'},
      csrf:csrfDriver,idempotencyKey:rideKey
    });
    assert.equal(overLimitMismatch.status,409);
    const overLimitNew=await request('/api/rides',{
      method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:crypto.randomUUID()
    });
    assert.equal(overLimitNew.status,429);
    const crossAccount=await request('/api/rides',{
      method:'POST',user:1,body:cleanInput,csrf:csrfPassenger,idempotencyKey:rideKey
    });
    assert.equal(crossAccount.status,429,'Other actors cannot reuse completed receipts');
    const empty=await request('/api/my-rides',{user:0});
    assert.equal(empty.status,200);
    assert.deepEqual(empty.body.rides,[]);
  }finally{
    if(child){
      child.kill('SIGTERM');
      await new Promise(resolve=>{
        if(child.exitCode!==null||child.signalCode!==null)return resolve();
        const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);
        child.once('exit',()=>{clearTimeout(timer);resolve()});
      });
    }
    await pool.query('DELETE FROM public.campus_bookings WHERE ride_id IN (SELECT id FROM public.campus_rides WHERE driver_user_id=ANY($1::uuid[]))',[ids]);
    await pool.query('DELETE FROM public.campus_rides WHERE driver_user_id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM public.campus_sessions WHERE user_id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',
      [ids.map(id=>crypto.createHash('sha256').update('campus-user:'+id.toLowerCase()).digest('hex'))]);
    await pool.end();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
