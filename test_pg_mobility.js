'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {migrate}=require('./stage1-otp/migrate');
const {PgMobilityStore}=require('./stage1-otp/mobility-store');
const {PgRidesStore}=require('./stage1-otp/rides-store');

const connectionString=process.env.OTP_DATABASE_URL;
if(connectionString&&!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname)){
  throw Error('Never run mobility tests against remote staging or production');
}
const uid=()=>crypto.randomUUID();
const time=ms=>new Date(Date.now()+ms).toISOString();

test('PostGIS intent privacy, indexed candidate matching, ownership and booking concurrency',
  {skip:!connectionString?'isolated local PostgreSQL is required':false},async t=>{
    await migrate({connectionString,ssl:false});
    const pool=new Pool({connectionString,ssl:false,max:8});
    const mobility=new PgMobilityStore({pool});
    const rides=new PgRidesStore({pool});
    const users=[uid(),uid(),uid(),uid()],emails=users.map((_,i)=>
      'mobility-'+crypto.randomBytes(6).toString('hex')+'@students.mituniversity.edu.in');
    const phone=['9876543901','9876543902','9876543903','9876543904'];
    const rideIds=[];
    try{
      await mobility.ready();
      const perms=await pool.query([
        'SELECT relname,relrowsecurity FROM pg_class',
        "WHERE relname IN ('campus_trip_intents','campus_ride_geo')"
      ].join(' '));
      assert.equal(perms.rows.length,2);
      assert.ok(perms.rows.every(x=>x.relrowsecurity===true));
      await pool.query([
        'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified)',
        'VALUES ($1,$2,$3,$4,$5,true),($6,$7,$8,$9,$10,true),',
        '($11,$12,$13,$14,$15,true),($16,$17,$18,$19,$20,true)'
      ].join(' '),users.flatMap((id,i)=>[id,'CI Mobility '+(i+1),emails[i],phone[i],'Testing']));
      const origin={lat:18.5103,lon:73.9232};
      const nearOrigin={lat:18.5120,lon:73.9250};
      const destination={lat:18.4652,lon:74.0181};
      const nearDestination={lat:18.4670,lon:74.0190};
      const depart=time(24*3600000);
      const ride={
        vehicle:'Car',vehicleModel:'Test Car',pickup:'Test A',
        destination:'Test B',departureTime:depart,
        seatsTotal:1,studentFare:35,driverPayout:30,uberBenchmark:90,
        pickupCoordinates:origin,destinationCoordinates:destination,
        departureAt:depart
      };
      await t.test('Driver attaches route points atomically',async()=>{
        const created=await rides.createRide({driverUserId:users[0],ride});
        rideIds.push(created.id);
        const check=await pool.query(
          'SELECT pickup_cell,departure_bucket FROM public.campus_ride_geo WHERE ride_id=$1',
          [created.id]);
        assert.equal(check.rowCount,1);
        assert.equal(typeof check.rows[0].pickup_cell,'string');
        assert.equal(Number.isInteger(Number(check.rows[0].departure_bucket)),true);
      });
      let intent;
      await t.test('Verified student can submit one bounded active intent',async()=>{
        intent=await mobility.createIntent({studentUserId:users[1],
          pickup:nearOrigin,dropoff:nearDestination,
          earliestDeparture:time(23*3600000),latestDeparture:time(25*3600000)});
        assert.ok(intent.intentId);
        assert.equal(intent.status,'active');
        assert.equal(intent.pickup?.lat,undefined);
        await assert.rejects(mobility.createIntent({studentUserId:users[1],
          pickup:nearOrigin,dropoff:nearDestination,
          earliestDeparture:time(23*3600000),latestDeparture:time(25*3600000)}),
          e=>e.code==='ACTIVE_INTENT_EXISTS');
      });
      await t.test('Nearby compatible offer ranks, but does not reveal identities',async()=>{
        const result=await mobility.findCandidates({studentUserId:users[1],intentId:intent.intentId});
        assert.equal(result.candidates.length,1);
        const match=result.candidates[0];
        assert.equal(match.rideId,rideIds[0]);
        assert.ok(match.pickupDistanceMeters>0 && match.pickupDistanceMeters<1500);
        assert.ok(match.dropoffDistanceMeters>0 && match.dropoffDistanceMeters<1500);
        assert.equal(match.candidateOnly,true);
        assert.equal(match.roadRouteVerificationRequired,true);
        for(const secret of ['driverName','driverEmail','driverPhone','pickupCoordinates','dropoffCoordinates']){
          assert.equal(match[secret],undefined);
        }
        await assert.rejects(mobility.findCandidates({
          studentUserId:users[2],intentId:intent.intentId
        }),e=>e.code==='INTENT_NOT_FOUND');
        assert.equal((await mobility.getActiveIntent({studentUserId:users[2],intentId:intent.intentId})),null);
      });
      await t.test('Spatial and time prefilters exclude incompatible trips',async()=>{
        const farIntent=await mobility.createIntent({studentUserId:users[2],
          pickup:{lat:18.620,lon:73.770},dropoff:{lat:18.630,lon:73.780},
          earliestDeparture:time(23*3600000),latestDeparture:time(25*3600000)});
        const far=await mobility.findCandidates({studentUserId:users[2],intentId:farIntent.intentId});
        assert.equal(far.candidates.length,0);
        const lateIntent=await mobility.createIntent({studentUserId:users[3],
          pickup:nearOrigin,dropoff:nearDestination,
          earliestDeparture:time(40*3600000),latestDeparture:time(42*3600000)});
        const late=await mobility.findCandidates({studentUserId:users[3],intentId:lateIntent.intentId});
        assert.equal(late.candidates.length,0);
      });
      await t.test('Sold-out rides disappear from candidate listings',async()=>{
        const b=await rides.bookRide({rideId:rideIds[0],passengerUserId:users[2]});
        assert.ok(b.bookingId);
        assert.equal((await mobility.findCandidates({
          studentUserId:users[1],intentId:intent.intentId
        })).candidates.length,0);
        await rides.cancelBooking({bookingId:b.bookingId,passengerUserId:users[2]});
        assert.equal((await mobility.findCandidates({
          studentUserId:users[1],intentId:intent.intentId
        })).candidates.length,1);
      });
      await t.test('Only owner can cancel, then replace the intent',async()=>{
        await assert.rejects(mobility.cancelIntent({
          studentUserId:users[2],intentId:intent.intentId
        }),e=>e.code==='INTENT_NOT_FOUND');
        await mobility.cancelIntent({studentUserId:users[1],intentId:intent.intentId});
        await assert.rejects(mobility.findCandidates({
          studentUserId:users[1],intentId:intent.intentId
        }),e=>e.code==='INTENT_NOT_FOUND');
        const replacement=await mobility.createIntent({studentUserId:users[1],
          pickup:nearOrigin,dropoff:nearDestination,
          earliestDeparture:time(23*3600000),latestDeparture:time(25*3600000)});
        assert.notEqual(replacement.intentId,intent.intentId);
      });
      await t.test('GiST pickup index is available to the spatial planner',async()=>{
        await pool.query('SET enable_seqscan = off');
        try{
          const plan=await pool.query([
            'EXPLAIN SELECT ride_id FROM public.campus_ride_geo WHERE',
            'extensions.ST_DWithin(pickup_geo,',
            'extensions.ST_SetSRID(extensions.ST_MakePoint(73.924,18.511),4326)::extensions.geography,1500)'
          ].join(' '));
          const textPlan=plan.rows.map(r=>r['QUERY PLAN']).join('\n');
          assert.match(textPlan,/campus_ride_geo_pickup_gist_idx/);
        }finally{await pool.query('RESET enable_seqscan');}
      });
    }finally{
      // Disposable, isolated CI DB only; remove all test fixtures.
      await pool.query('DELETE FROM public.campus_trip_intents WHERE student_user_id=ANY($1::uuid[])',[users]);
      if(rideIds.length){
        await pool.query('DELETE FROM public.campus_bookings WHERE ride_id=ANY($1::text[])',[rideIds]);
        await pool.query('DELETE FROM public.campus_ride_geo WHERE ride_id=ANY($1::text[])',[rideIds]);
        await pool.query('DELETE FROM public.campus_rides WHERE id=ANY($1::text[])',[rideIds]);
      }
      await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[users]);
      await pool.end();
    }
  });
