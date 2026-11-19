'use strict';
// Actual PostgreSQL mixed-write stress, never a live/staging database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {Pool}=require('pg');
const {migrate}=require('./stage1-otp/migrate');
const {PgRidesStore,RidesError}=require('./stage1-otp/rides-store');
const {PgIdempotencyStore}=require('./idempotency');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DB='campuspool_stage1_ci';
const rounds=12;
const appName='campuspool_ride_stress';
const url=process.env.OTP_DATABASE_URL;
function validateTarget(){
  assert.equal(process.env.RIDES_STRESS_DISPOSABLE_DB,'YES','Explicit disposable DB opt-in required');
  assert.ok(url,'Disposable PostgreSQL URL required');
  const u=new URL(url);
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname),'Remote databases forbidden');
  assert.equal(u.pathname,'/'+DB,'Exact disposable database name required');
  assert.equal(u.search,'','Connection override parameters forbidden');
  assert.equal(u.hash,'');
}
function hash(actor){return crypto.createHash('sha256').update('campus-user:'+actor).digest('hex');}
function percentile(values,q){const sorted=[...values].sort((a,b)=>a-b);return Number(sorted[Math.ceil(sorted.length*q)-1].toFixed(2));}
const rideFixture={vehicle:'Car',vehicleModel:'Synthetic Car',pickup:'Test Gate',
  destination:'Test Stop',departureTime:'2027-01-02T09:00:00',seatsTotal:4,
  uberBenchmark:100,studentFare:20,driverPayout:18,note:'Synthetic concurrency test',upiId:''};

test('PostgreSQL mixed ride writes conserve seats, replay receipts and roll back atomically',
  {timeout:180000},async t=>{
    validateTarget();
    const admin=new Pool({connectionString:url,ssl:false,max:3,connectionTimeoutMillis:5000,
      statement_timeout:10000,lock_timeout:5000});
    const pools=[];
    const users=Array.from({length:17},()=>crypto.randomUUID());
    const driver=users[0],riders=users.slice(1);
    const hashes=users.map(hash);
    const runTag=crypto.randomBytes(8).toString('hex');
    const stats={rounds:0,waves:0,attempts:0,accepted:0,replayed:0,rejected:0,
      lockObservedWaves:0,snapshotChecks:0,peakQueued:0,rollbackChecks:0,latencies:[],rejectionCodes:{}};
    let inserted=false;
    try{
      const target=await admin.query('SELECT current_database() AS db');
      assert.equal(target.rows[0].db,DB);
      await migrate({connectionString:url,ssl:false});
      const workerSlots=Array.from({length:4},(_,i)=>{
        const pool=new Pool({connectionString:url,ssl:false,max:4,connectionTimeoutMillis:5000,
          statement_timeout:12000,lock_timeout:8000,
          application_name:appName,options:'-c role=campuspool_staging_app'});
        pools.push(pool);
        return {pool,rides:new PgRidesStore({pool}),idem:new PgIdempotencyStore(pool)};
      });
      for(const worker of workerSlots){
        const who=await worker.pool.query('SELECT current_user AS role,current_database() AS db');
        assert.equal(who.rows[0].role,'campuspool_staging_app');
        assert.equal(who.rows[0].db,DB);
        await worker.rides.ready();
        await worker.idem.ready();
      }
      // Admin is used only for fixture setup, a deterministic lock barrier,
      // committed-state observation and exact-fixture cleanup.
      const phoneBase=crypto.randomInt(1000000,9000000);
      await admin.query('INSERT INTO public.campus_users (id,name,email,phone,dept,is_verified) SELECT * FROM unnest($1::uuid[],$2::text[],$3::text[],$4::text[],$5::text[],$6::boolean[])',
        [users,users.map((_,i)=>'Stress Student '+i),
          users.map((_,i)=>'stress-'+runTag+'-'+i+'@students.mituniversity.edu.in'),
          users.map((_,i)=>'981'+String(phoneBase+i)),users.map(()=> 'Synthetic'),users.map(()=>true)]);
      inserted=true;
      function op(kind,actor,body,key=crypto.randomUUID()){
        return {kind,actor,body,key,route:'POST '+({book:'/api/bookings',
          passengerCancel:'/api/bookings/cancel',driverCancel:'/api/rides/cancel'})[kind]};
      }
      function perform(worker,o,injectFailure=false){
        return worker.idem.run({...o,execute:async client=>{
          let body;
          if(o.kind==='book')body={booking:await worker.rides.bookRide({
            rideId:o.body.rideId,passengerUserId:o.actor,client})};
          else if(o.kind==='passengerCancel')body=await worker.rides.cancelBooking({
            bookingId:o.body.bookingId,passengerUserId:o.actor,client});
          else body=await worker.rides.cancelRide({rideId:o.body.rideId,driverUserId:o.actor,client});
          if(injectFailure)throw Error('SYNTHETIC_AFTER_WRITE');
          return {status:o.kind==='book'?201:200,body};
        }});
      }
      async function snapshot(id){
        // One SQL statement: read ride and booking rows from one MVCC snapshot.
        const r=await admin.query(`
          SELECT r.status,r.seats_total::int AS total,r.seats_left::int AS available,
            count(b.booking_id) FILTER (WHERE b.status='active')::int AS active,
            count(DISTINCT b.passenger_user_id) FILTER (WHERE b.status='active')::int AS distinct_active,
            count(b.booking_id) FILTER (WHERE
              (b.status='active' AND b.cancelled_at IS NOT NULL) OR
              (b.status='cancelled' AND b.cancelled_at IS NULL))::int AS bad_cancel,
            COALESCE(jsonb_agg(jsonb_build_object('id',b.booking_id,'actor',b.passenger_user_id,
              'status',b.status) ORDER BY b.booking_id) FILTER (WHERE b.booking_id IS NOT NULL),'[]'::jsonb) AS bookings
          FROM public.campus_rides r LEFT JOIN public.campus_bookings b ON b.ride_id=r.id
          WHERE r.id=$1 GROUP BY r.id`,[id]);
        assert.equal(r.rows.length,1);
        const s=r.rows[0];
        stats.snapshotChecks++;
        assert.ok(s.available>=0&&s.available<=s.total,'Seat bounds violated');
        assert.equal(s.available+s.active,s.total,'Seat conservation violated');
        assert.equal(s.active,s.distinct_active,'Duplicate active passenger');
        assert.equal(s.bad_cancel,0,'Cancellation timestamp inconsistency');
        if(s.status==='cancelled'){
          assert.equal(s.active,0,'Active booking on cancelled ride');
          assert.equal(s.available,s.total,'Cancelled ride did not release every seat');
        }
        return s;
      }
      async function verifyReceipts(ops,results){
        const groups=new Map();
        for(let i=0;i<ops.length;i++){
          const o=ops[i],r=results[i];
          const g=groups.get(o.key)||{o,results:[]};g.results.push(r);groups.set(o.key,g);
        }
        for(const {o,results:group} of groups.values()){
          const successful=group.filter(x=>x.status==='fulfilled').map(x=>x.value);
          const receipt=await workerSlots[0].idem.findCompleted(o);
          if(!successful.length){assert.equal(receipt,null,'Rejected operation committed receipt');continue;}
          assert.ok(receipt&&receipt.replayed,'Successful key missing durable receipt');
          assert.equal(successful.filter(x=>!x.replayed).length,1,'Key executed more than once');
          for(const v of successful){
            assert.equal(v.status,receipt.status);
            assert.deepEqual(v.body,receipt.body);
          }
          const replay=await workerSlots[1].idem.run({...o,execute:()=>{throw Error('REPLAY_EXECUTED');}});
          assert.equal(replay.replayed,true);
          assert.deepEqual(replay.body,receipt.body);
        }
      }
      const acceptedCodes={book:new Set(['RIDE_FULL','ALREADY_BOOKED','RIDE_NOT_FOUND']),
        passengerCancel:new Set(['BOOKING_NOT_FOUND']),driverCancel:new Set(['RIDE_NOT_FOUND'])};
      async function wave(id,ops){
        stats.waves++;
        // Force actual row lock contention before releasing workers. All
        // mutations run via different restricted-role pools, not this client.
        const blocker=await admin.connect();
        let requests;
        let barrierError;
        try{
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM public.campus_rides WHERE id=$1 FOR UPDATE',[id]);
          requests=Promise.allSettled(ops.map(async(o,i)=>{
            const start=performance.now();
            try{return await perform(workerSlots[i%workerSlots.length],o);}
            finally{stats.latencies.push(performance.now()-start);}
          }));
          const deadline=performance.now()+3000;
          let observed=false;
          while(performance.now()<deadline){
            const locks=await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[appName]);
            stats.peakQueued=Math.max(stats.peakQueued,pools.reduce((n,p)=>n+p.waitingCount,0));
            if(locks.rows[0].n>0){observed=true;break;}
            await sleep(10);
          }
          assert.ok(observed,'Expected real PostgreSQL lock contention');
          stats.lockObservedWaves++;
          await snapshot(id);
        }catch(e){barrierError=e;}
        finally{
          try{await blocker.query('ROLLBACK');}finally{blocker.release();}
        }
        if(!requests)throw barrierError||Error('No requests dispatched');
        let complete=false;
        requests.then(()=>{complete=true;});
        let observationError;
        try{
          do{
            await snapshot(id);
            stats.peakQueued=Math.max(stats.peakQueued,pools.reduce((n,p)=>n+p.waitingCount,0));
            if(!complete)await sleep(5);
          }while(!complete);
        }catch(e){observationError=e;}
        const results=await requests;
        if(barrierError)throw barrierError;
        if(observationError)throw observationError;
        stats.attempts+=results.length;
        for(let i=0;i<results.length;i++){
          const result=results[i];
          if(result.status==='fulfilled'){
            stats.accepted++;
            if(result.value.replayed)stats.replayed++;
          }else{
            const e=result.reason;
            assert.ok(e instanceof RidesError&&acceptedCodes[ops[i].kind].has(e.code),
              'Unexpected transaction failure: '+String(e.code||e.message));
            stats.rejected++;
            stats.rejectionCodes[e.code]=(stats.rejectionCodes[e.code]||0)+1;
          }
        }
        await verifyReceipts(ops,results);
        return snapshot(id);
      }
      await t.test('12 rounds of last-seat pressure then mixed passenger and driver cancellation',async()=>{
        for(let round=0;round<rounds;round++){
          const ride=await workerSlots[0].rides.createRide({driverUserId:driver,ride:rideFixture});
          const id=ride.id;
          let state=await snapshot(id);
          assert.equal(state.available,4);
          // Fill three seats. The first wave competes for the final seat
          // while two existing bookings are being cancelled.
          const seeds=[];
          for(let i=0;i<3;i++){
            const seed=await perform(workerSlots[i],op('book',riders[i],{rideId:id}));
            seeds.push(seed.body.booking);
          }
          assert.equal((await snapshot(id)).available,1);
          const cancel1=op('passengerCancel',riders[0],{bookingId:seeds[0].bookingId});
          const cancel2=op('passengerCancel',riders[1],{bookingId:seeds[1].bookingId});
          const sameBook=op('book',riders[3],{rideId:id});
          const first=[cancel1,cancel1,op('passengerCancel',riders[0],cancel1.body),cancel2,
            sameBook,sameBook,op('book',riders[3],{rideId:id}),
            ...riders.slice(4,12).map(actor=>op('book',actor,{rideId:id}))];
          // Rotate ordering to vary which pool/business operation gets the lock.
          const offset=round%first.length;
          state=await wave(id,first.slice(offset).concat(first.slice(0,offset)));
          assert.equal(state.status,'active');
          assert.ok(state.bookings.some(b=>b.id===seeds[0].bookingId&&b.status==='cancelled'));
          assert.ok(state.bookings.some(b=>b.id===seeds[1].bookingId&&b.status==='cancelled'));
          const driverCancel=op('driverCancel',driver,{rideId:id});
          const passengerCancels=state.bookings.filter(b=>b.status==='active')
            .map(b=>op('passengerCancel',b.actor,{bookingId:b.id}));
          const second=[driverCancel,driverCancel,op('driverCancel',driver,{rideId:id}),
            ...passengerCancels.flatMap(o=>[o,o,op(o.kind,o.actor,o.body)]),
            ...riders.map(actor=>op('book',actor,{rideId:id}))];
          const secondOffset=(round*7)%second.length;
          state=await wave(id,second.slice(secondOffset).concat(second.slice(0,secondOffset)));
          assert.equal(state.status,'cancelled','Driver cancellation must commit');
          assert.equal(state.active,0);
          assert.equal(state.available,4);
          await assert.rejects(perform(workerSlots[3],op('book',riders[15],{rideId:id})),
            e=>e instanceof RidesError&&e.code==='RIDE_NOT_FOUND');
          stats.rounds++;
        }
      });
      await t.test('failure after real SQL write rolls back booking, passenger cancel and driver cancel',async()=>{
        const ride=await workerSlots[0].rides.createRide({driverUserId:driver,ride:rideFixture});
        const id=ride.id;
        async function failThenRetry(o){
          const before=await snapshot(id);
          await assert.rejects(perform(workerSlots[0],o,true),/SYNTHETIC_AFTER_WRITE/);
          assert.deepEqual(await snapshot(id),before,'Failed transaction changed committed ride/bookings');
          assert.equal(await workerSlots[1].idem.findCompleted(o),null,'Failed receipt survived rollback');
          const retry=await perform(workerSlots[2],o);
          assert.equal(retry.replayed,false);
          const replay=await perform(workerSlots[3],o);
          assert.equal(replay.replayed,true);
          assert.deepEqual(replay.body,retry.body);
          await snapshot(id);
          stats.rollbackChecks++;
          return retry;
        }
        const booked=await failThenRetry(op('book',riders[0],{rideId:id}));
        await failThenRetry(op('passengerCancel',riders[0],{bookingId:booked.body.booking.bookingId}));
        await perform(workerSlots[0],op('book',riders[1],{rideId:id}));
        await failThenRetry(op('driverCancel',driver,{rideId:id}));
        assert.equal((await snapshot(id)).status,'cancelled');
      });
      assert.equal(stats.rounds,rounds);
      assert.equal(stats.lockObservedWaves,rounds*2);
      assert.equal(stats.rollbackChecks,3);
      assert.equal(stats.attempts,stats.accepted+stats.rejected);
      assert.ok(stats.replayed>0&&stats.rejected>0);
      t.diagnostic('RIDES_STRESS_RESULT '+JSON.stringify({
        ...stats,latencies:undefined,p50Ms:percentile(stats.latencies,.5),
        p95Ms:percentile(stats.latencies,.95),p99Ms:percentile(stats.latencies,.99),
        poolCount:pools.length,poolMaxEach:4,unexpectedErrors:0
      }));
    }finally{
      await Promise.all(pools.map(p=>p.end()));
      try{
        if(inserted){
          // Only our randomly generated fixture identities and their rows.
          await admin.query('DELETE FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',[hashes]);
          await admin.query('DELETE FROM public.campus_bookings WHERE ride_id IN (SELECT id FROM public.campus_rides WHERE driver_user_id=$1)',[driver]);
          await admin.query('DELETE FROM public.campus_rides WHERE driver_user_id=$1',[driver]);
          await admin.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[users]);
          const cleanup=await admin.query('SELECT count(*)::int AS n FROM public.campus_users WHERE id=ANY($1::uuid[])',[users]);
          assert.equal(cleanup.rows[0].n,0);
        }
      }finally{await admin.end();}
    }
  });
