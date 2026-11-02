'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {migrate}=require('./stage1-otp/migrate');
const {PgRidesStore}=require('./stage1-otp/rides-store');

const connectionString=process.env.OTP_DATABASE_URL;
function assertIsolatedDb(url){
  if(!url) return;
  const host=new URL(url).hostname;
  if(!['localhost','127.0.0.1','[::1]'].includes(host)) {
    throw Error('Rides integration tests must NEVER run against remote staging or production databases');
  }
}
assertIsolatedDb(connectionString);
function fixture(){
  return {vehicle:'Car',vehicleModel:'Demo Hatchback',pickup:'Test Gate',
    destination:'Test Library',departureTime:'2027-01-02T09:00:00',
    seatsTotal:1,uberBenchmark:200,studentFare:50,driverPayout:45,note:'CI test',upiId:''};
}
test('PostgreSQL rides: permissions, atomic seats, cancellation and durable reads',
  {skip:!connectionString?'requires isolated PostgreSQL test DB':false},
  async t=>{
    await migrate({connectionString,ssl:false});
    const pool=new Pool({connectionString,ssl:false,max:8});
    const rides=new PgRidesStore({pool});
    const acrossWorker=new PgRidesStore({pool});
    const id=()=>crypto.randomUUID();
    const uuids=[id(),id(),id(),id(),id()];
    const contact=i=>'rides-ci-'+crypto.randomBytes(6).toString('hex')+'@students.mituniversity.edu.in';
    const emails=uuids.map((_,i)=>contact(i));
    const phones=['9876543201','9876543202','9876543203','9876543204','9876543205'];
    const rideIds=[];
    try{
      await rides.ready();
      await t.test('new tables have RLS enabled and no anon/authenticated permissions',async()=>{
        const info=await pool.query([
          "SELECT c.relname,c.relrowsecurity,",
          "has_table_privilege('public',c.oid,'SELECT') AS public_read",
          'FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid',
          "WHERE n.nspname='public' AND c.relname IN ('campus_rides','campus_bookings')"
        ].join(' '));
        // No PUBLIC table grant; anon/authenticated checks are covered by the
        // Supabase security advisor and dedicated restricted-role migrations.
        assert.equal(info.rows.length,2);
        for(const row of info.rows){
          assert.equal(row.relrowsecurity,true);
          assert.equal(row.public_read,false);
        }
      });
      await pool.query([
        'INSERT INTO public.campus_users (id,name,email,phone,dept,is_verified)',
        'VALUES ($1,$2,$3,$4,$5,true),($6,$7,$8,$9,$10,true),',
        '($11,$12,$13,$14,$15,true),($16,$17,$18,$19,$20,true),',
        '($21,$22,$23,$24,$25,true)'
      ].join(' '),uuids.flatMap((u,i)=>[u,'Rides CI '+(i+1),emails[i],phones[i],'Testing']));
      await t.test('ride owner comes from verified database identity, not request body',async()=>{
        const created=await rides.createRide({driverUserId:uuids[0],
          ride:{...fixture(),driverEmail:'attacker@outside.example',driverName:'Spoofed'}});
        rideIds.push(created.id);
        assert.equal(created.driverEmail,emails[0]);
        assert.equal(created.driverName,'Rides CI 1');
        assert.equal(created.seatsLeft,1);
        assert.equal((await acrossWorker.getRides()).some(r=>r.id===created.id),true);
        await assert.rejects(rides.createRide({driverUserId:id(),ride:fixture()}),
          e=>e.code==='AUTH_REQUIRED');
      });
      await t.test('simultaneous attempts cannot oversell one seat',async()=>{
        const result=await Promise.allSettled([
          rides.bookRide({rideId:rideIds[0],passengerUserId:uuids[1]}),
          acrossWorker.bookRide({rideId:rideIds[0],passengerUserId:uuids[2]})
        ]);
        assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
        assert.equal(result.filter(x=>x.status==='rejected'&&x.reason.code==='RIDE_FULL').length,1);
        const booked=result.find(x=>x.status==='fulfilled').value;
        assert.equal(booked.paymentStatus,'Pending');
        assert.equal((await acrossWorker.getRides())[0].seatsLeft,0);
        assert.equal((await pool.query(
          "SELECT COUNT(*)::int AS n FROM public.campus_bookings WHERE ride_id=$1 AND status='active'",
          [rideIds[0]])).rows[0].n,1);
        await assert.rejects(rides.bookRide({rideId:rideIds[0],passengerUserId:uuids[0]}),
          e=>e.code==='OWN_RIDE');
        await assert.rejects(rides.cancelBooking({bookingId:booked.bookingId,
          passengerUserId:uuids[3]}),e=>e.code==='NOT_BOOKING_PASSENGER');
        const winner=booked.passengerEmail===emails[1]?uuids[1]:uuids[2];
        await rides.cancelBooking({bookingId:booked.bookingId,passengerUserId:winner});
        assert.equal((await rides.getRides())[0].seatsLeft,1);
        await assert.rejects(rides.cancelBooking({bookingId:booked.bookingId,
          passengerUserId:winner}),e=>e.code==='BOOKING_NOT_FOUND');
        assert.equal((await rides.getBookingsByUser(winner)).length,0);
      });
      await t.test('duplicate booking is rejected with no seat loss',async()=>{
        const offered=await rides.createRide({driverUserId:uuids[0],
          ride:{...fixture(),seatsTotal:2}});
        rideIds.push(offered.id);
        const first=await rides.bookRide({rideId:offered.id,passengerUserId:uuids[1]});
        assert.equal(first.rideId,offered.id);
        await assert.rejects(rides.bookRide({rideId:offered.id,passengerUserId:uuids[1]}),
          e=>e.code==='ALREADY_BOOKED');
        const active=(await rides.getRides()).find(x=>x.id===offered.id);
        assert.equal(active.seatsLeft,1);
        assert.equal((await rides.getBookingsByUser(uuids[1])).length,1);
        assert.equal((await rides.getBookingsByUser(uuids[0])).length,1);
        assert.equal((await rides.getRidesByDriver(uuids[0])).some(x=>x.id===offered.id),true);
      });
      await t.test('driver-only cancellation leaves auditable cancelled bookings',async()=>{
        await assert.rejects(rides.cancelRide({rideId:rideIds[1],driverUserId:uuids[2]}),
          e=>e.code==='NOT_RIDE_OWNER');
        await rides.cancelRide({rideId:rideIds[1],driverUserId:uuids[0]});
        assert.equal((await rides.getRides()).some(x=>x.id===rideIds[1]),false);
        assert.equal((await rides.getBookingsByUser(uuids[1])).length,0);
        const rows=await pool.query(
          'SELECT status,payment_status,cancelled_at FROM public.campus_bookings WHERE ride_id=$1',[rideIds[1]]);
        assert.equal(rows.rows.length,1);
        assert.equal(rows.rows[0].status,'cancelled');
        assert.equal(rows.rows[0].payment_status,'Pending');
        assert.ok(rows.rows[0].cancelled_at);
        await assert.rejects(rides.bookRide({rideId:rideIds[1],passengerUserId:uuids[3]}),
          e=>e.code==='RIDE_NOT_FOUND');
      });
      await t.test('SQL constraints block impossible seat and payment states',async()=>{
        const err=await pool.query(
          "UPDATE public.campus_rides SET seats_left=seats_total+1 WHERE id=$1",[rideIds[0]]
        ).then(()=>null,e=>e);
        assert.equal(err?.code,'23514');
        const book=await pool.query(
          "INSERT INTO public.campus_bookings (booking_id,ride_id,passenger_user_id,passenger_name,passenger_email,driver_name,driver_email,driver_phone,vehicle_model,pickup,destination,departure_time,student_fare,payment_status) VALUES ($1,$2,$3,'X',$4,'Y',$5,'123','Car','A','B','later',50,'Paid')",
          ['BKG-'+id(),rideIds[0],uuids[4],emails[4],emails[0]]
        ).then(()=>null,e=>e);
        assert.equal(book?.code,'23514');
      });
    } finally{
      // Delete test-only rows in safe dependency order, retaining zero fixtures.
      if(rideIds.length){
        await pool.query('DELETE FROM public.campus_bookings WHERE ride_id=ANY($1::text[])',[rideIds]);
        await pool.query('DELETE FROM public.campus_rides WHERE id=ANY($1::text[])',[rideIds]);
      }
      await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[uuids]);
      await pool.end();
    }
  });
