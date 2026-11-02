'use strict';
// Durable, opt-in PostgreSQL Rides/Bookings data layer.
// Phase 2 deliberately does NOT switch live HTTP routes or import SQLite data.
// The caller supplies the authenticated campus_user UUID; never accept owner
// identity from request JSON. This store shares the existing private PG pool.
const crypto=require('node:crypto');
const {rideRouteInput}=require('./mobility-geo');

class RidesError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

function asEmail(value){return String(value||'').trim().toLowerCase();}
function finiteMoney(value) {
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>10000)throw new RidesError('INVALID_RIDE');
  return Math.round(n*100)/100;
}
function validText(value,max,optional=false) {
  return typeof value==='string' && value.length<=max &&
    (optional || value.trim().length>0) && !/[<>\u0000-\u001f]/.test(value);
}
function asDate(value){return value instanceof Date?value.toISOString():String(value);}
function ridePublic(r){
  if(!r)return null;
  return {
    id:r.id,driverName:r.driver_name,driverEmail:r.driver_email,
    driverPhone:r.driver_phone,dept:r.dept,vehicle:r.vehicle,
    vehicleModel:r.vehicle_model,pickup:r.pickup,destination:r.destination,
    departureTime:r.departure_time,seatsTotal:Number(r.seats_total),
    seatsLeft:Number(r.seats_left),uberBenchmark:Number(r.uber_benchmark),
    studentFare:Number(r.student_fare),driverPayout:Number(r.driver_payout),
    note:r.note,upiId:r.upi_id,createdAt:asDate(r.created_at)
  };
}
function bookingPublic(r){
  if(!r)return null;
  return {
    bookingId:r.booking_id,rideId:r.ride_id,
    passengerEmail:r.passenger_email,passengerName:r.passenger_name,
    driverName:r.driver_name,driverEmail:r.driver_email,driverPhone:r.driver_phone,
    dept:r.dept,vehicleModel:r.vehicle_model,pickup:r.pickup,
    destination:r.destination,departureTime:r.departure_time,
    studentFare:Number(r.student_fare),paymentStatus:r.payment_status,
    upiId:r.upi_id,createdAt:asDate(r.created_at)
  };
}
function checkRideInput(r) {
  if(!r||!['Car','Bike'].includes(r.vehicle)||
    !validText(r.vehicleModel,80)||!validText(r.pickup,120)||
    !validText(r.destination,120)||!validText(r.departureTime,120)||
    !validText(r.note||'',500,true)||!validText(r.upiId||'',128,true))
    throw new RidesError('INVALID_RIDE');
  const requested=Number(r.seatsTotal);
  if(!Number.isInteger(requested)||requested<1||requested>4)
    throw new RidesError('INVALID_RIDE');
  const seats=r.vehicle==='Bike'?1:requested;
  return {
    vehicle:r.vehicle,vehicleModel:r.vehicleModel.trim(),pickup:r.pickup.trim(),
    destination:r.destination.trim(),departureTime:r.departureTime.trim(),
    seats,uberBenchmark:finiteMoney(r.uberBenchmark),
    studentFare:finiteMoney(r.studentFare),driverPayout:finiteMoney(r.driverPayout),
    note:r.note||'',upiId:r.upiId||''
  };
}

class PgRidesStore {
  constructor({pool}={}) {
    if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
      throw Error('PgRidesStore requires an existing private PostgreSQL pool');
    this.pool=pool;
  }
  async ready(){
    await this.pool.query('SELECT 1 FROM public.campus_rides LIMIT 0');
    await this.pool.query('SELECT 1 FROM public.campus_bookings LIMIT 0');
  }
  async tx(fn){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const result=await fn(client);
      await client.query('COMMIT');
      return result;
    }catch(e){
      try{await client.query('ROLLBACK');}catch(_){}
      throw e;
    }finally{client.release();}
  }
  async createRide({driverUserId,ride}={}){
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    const r=checkRideInput(ride);
    const geo=rideRouteInput(ride);
    const id='ride_'+crypto.randomUUID();
    // The ride and its optional geo points are created atomically.
    // Without coordinates, legacy ride listings still work unchanged.
    return this.tx(async client=>{
      const sql=[
        'INSERT INTO public.campus_rides',
        '(id,driver_user_id,driver_name,driver_email,driver_phone,dept,vehicle,vehicle_model,',
        'pickup,destination,departure_time,seats_total,seats_left,uber_benchmark,',
        'student_fare,driver_payout,note,upi_id)',
        'SELECT $1,u.id,u.name,u.email,u.phone,u.dept,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12',
        'FROM public.campus_users u WHERE u.id=$13::uuid AND u.is_verified=true',
        'RETURNING *'
      ].join(' ');
      const params=[id,r.vehicle,r.vehicleModel,r.pickup,r.destination,r.departureTime,
        r.seats,r.uberBenchmark,r.studentFare,r.driverPayout,r.note,r.upiId,driverUserId];
      const result=await client.query(sql,params);
      if(result.rows.length!==1)throw new RidesError('AUTH_REQUIRED',401);
      if(geo){
        await client.query([
          'INSERT INTO public.campus_ride_geo',
          '(ride_id,pickup_geo,dropoff_geo,departure_at,pickup_cell,dropoff_cell,departure_bucket)',
          'VALUES ($1,',
          'extensions.ST_SetSRID(extensions.ST_MakePoint($2,$3),4326)::extensions.geography,',
          'extensions.ST_SetSRID(extensions.ST_MakePoint($4,$5),4326)::extensions.geography,',
          '$6,$7,$8,$9)'
        ].join(' '),[id,geo.pickup.lon,geo.pickup.lat,geo.dropoff.lon,geo.dropoff.lat,
          geo.departure,geo.pickupCell,geo.dropoffCell,geo.departureBucket]);
      }
      return ridePublic(result.rows[0]);
    });
  }
  async getRides(){
    const r=await this.pool.query(
      "SELECT * FROM public.campus_rides WHERE status='active' ORDER BY created_at DESC");
    return r.rows.map(ridePublic);
  }
  async getRidesByDriver(userId){
    const r=await this.pool.query(
      "SELECT * FROM public.campus_rides WHERE driver_user_id=$1 AND status='active' ORDER BY created_at DESC",
      [userId]);
    return r.rows.map(ridePublic);
  }
  async getBookingsByUser(userId){
    const r=await this.pool.query([
      'SELECT * FROM public.campus_bookings',
      "WHERE status='active' AND (passenger_user_id=$1",
      'OR ride_id IN (SELECT id FROM public.campus_rides WHERE driver_user_id=$1))',
      'ORDER BY created_at DESC'
    ].join(' '),[userId]);
    return r.rows.map(bookingPublic);
  }
  async bookRide({rideId,passengerUserId}={}){
    if(typeof passengerUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof rideId!=='string'||rideId.length>64)throw new RidesError('INVALID_RIDE');
    return this.tx(async client=>{
      // One lock serializes reservations, cancellations and capacity checks
      // across all Node workers/instances.
      const rideResult=await client.query(
        'SELECT * FROM public.campus_rides WHERE id=$1 FOR UPDATE',[rideId]);
      const ride=rideResult.rows[0];
      if(!ride||ride.status!=='active')throw new RidesError('RIDE_NOT_FOUND',404);
      const userResult=await client.query(
        'SELECT id,name,email FROM public.campus_users WHERE id=$1::uuid AND is_verified=true',[passengerUserId]);
      const passenger=userResult.rows[0];
      if(!passenger)throw new RidesError('AUTH_REQUIRED',401);
      if(ride.driver_user_id===passenger.id)throw new RidesError('OWN_RIDE',403);
      const duplicate=await client.query(
        "SELECT 1 FROM public.campus_bookings WHERE ride_id=$1 AND passenger_user_id=$2 AND status='active' LIMIT 1",
        [rideId,passengerUserId]);
      if(duplicate.rows.length)throw new RidesError('ALREADY_BOOKED',409);
      if(Number(ride.seats_left)<1)throw new RidesError('RIDE_FULL',409);
      await client.query(
        "UPDATE public.campus_rides SET seats_left=seats_left-1,updated_at=now() WHERE id=$1 AND seats_left>0",
        [rideId]);
      const bookingId='BKG-'+crypto.randomUUID();
      const insert=await client.query([
        'INSERT INTO public.campus_bookings',
        '(booking_id,ride_id,passenger_user_id,passenger_name,passenger_email,',
        'driver_name,driver_email,driver_phone,dept,vehicle_model,pickup,destination,',
        'departure_time,student_fare,upi_id)',
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        'RETURNING *'
      ].join(' '),[bookingId,rideId,passenger.id,passenger.name,passenger.email,
        ride.driver_name,ride.driver_email,ride.driver_phone,ride.dept,
        ride.vehicle_model,ride.pickup,ride.destination,ride.departure_time,
        ride.student_fare,ride.upi_id]);
      return bookingPublic(insert.rows[0]);
    });
  }
  async cancelBooking({bookingId,passengerUserId}={}){
    if(typeof passengerUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof bookingId!=='string'||bookingId.length>64)throw new RidesError('INVALID_BOOKING');
    return this.tx(async client=>{
      // Acquire locks in ride -> booking order to match reservation/ride cancellation.
      const found=await client.query(
        'SELECT ride_id FROM public.campus_bookings WHERE booking_id=$1',[bookingId]);
      if(!found.rows.length)throw new RidesError('BOOKING_NOT_FOUND',404);
      await client.query('SELECT id FROM public.campus_rides WHERE id=$1 FOR UPDATE',[found.rows[0].ride_id]);
      const current=await client.query(
        'SELECT * FROM public.campus_bookings WHERE booking_id=$1 FOR UPDATE',[bookingId]);
      const booking=current.rows[0];
      if(!booking||booking.status!=='active')throw new RidesError('BOOKING_NOT_FOUND',404);
      if(booking.passenger_user_id!==passengerUserId)throw new RidesError('NOT_BOOKING_PASSENGER',403);
      await client.query(
        "UPDATE public.campus_bookings SET status='cancelled',cancelled_at=now() WHERE booking_id=$1",
        [bookingId]);
      await client.query(
        'UPDATE public.campus_rides SET seats_left=LEAST(seats_total,seats_left+1),updated_at=now() WHERE id=$1',
        [booking.ride_id]);
      return {success:true,rideId:booking.ride_id};
    });
  }
  async isRideDriver(rideId,userId){
    if(!rideId||!userId)return false;
    const r=await this.pool.query(
      "SELECT 1 FROM public.campus_rides WHERE id=$1 AND driver_user_id=$2 AND status='active' LIMIT 1",
      [rideId,userId]);
    return r.rows.length>0;
  }
  async isRideParticipant(rideId,userId){
    if(!rideId||!userId)return false;
    const r=await this.pool.query([
      'SELECT 1 FROM public.campus_rides r WHERE r.id=$1 AND r.status=\'active\'',
      "AND (r.driver_user_id=$2 OR EXISTS (SELECT 1 FROM public.campus_bookings b",
      "WHERE b.ride_id=r.id AND b.passenger_user_id=$2 AND b.status='active')) LIMIT 1"
    ].join(' '),[rideId,userId]);
    return r.rows.length>0;
  }
  async isBookingPassenger(bookingId,userId){
    if(!bookingId||!userId)return false;
    const r=await this.pool.query(
      "SELECT 1 FROM public.campus_bookings WHERE booking_id=$1 AND passenger_user_id=$2 AND status='active' LIMIT 1",
      [bookingId,userId]);
    return r.rows.length>0;
  }
  async isBookingParticipant(bookingId,userId){
    if(!bookingId||!userId)return false;
    const r=await this.pool.query([
      'SELECT 1 FROM public.campus_bookings b',
      'JOIN public.campus_rides r ON r.id=b.ride_id',
      "WHERE b.booking_id=$1 AND b.status='active' AND r.status='active'",
      'AND (b.passenger_user_id=$2 OR r.driver_user_id=$2) LIMIT 1'
    ].join(' '),[bookingId,userId]);
    return r.rows.length>0;
  }
  async checkUserSettlementBlock(userId){
    if(!userId)return {isBlocked:false,reason:'NONE'};
    // Payment settlement is intentionally disabled. Existing 'Pending'
    // bookings and unpaid driver commission continue to block new actions.
    const [commission,pending]=await Promise.all([
      this.pool.query([
        'SELECT COALESCE(SUM(seats_total-seats_left),0)::int AS seats_sold,',
        'COALESCE(SUM((seats_total-seats_left)*student_fare),0) AS gross',
        'FROM public.campus_rides WHERE driver_user_id=$1'
      ].join(' '),[userId]),
      this.pool.query([
        'SELECT b.* FROM public.campus_bookings b',
        "WHERE b.passenger_user_id=$1 AND b.status='active' AND b.payment_status='Pending'",
        'ORDER BY b.created_at DESC'
      ].join(' '),[userId])
    ]);
    const totalRides=Number(commission.rows[0].seats_sold);
    const grossFare=Number(commission.rows[0].gross);
    const totalCommission=Math.round(grossFare*0.1);
    const commissionDue=totalCommission;
    const pendingBookings=pending.rows.map(bookingPublic);
    const hasUnsettledCommission=commissionDue>0;
    const hasUnpaidBooking=pendingBookings.length>0;
    return {
      isBlocked:hasUnsettledCommission||hasUnpaidBooking,
      hasUnsettledCommission,hasUnpaidBooking,commissionDue,
      driverCommission:{totalRides,grossFare,totalCommission,settled:0,netDue:commissionDue},
      pendingBookings,
      reason:hasUnsettledCommission?'COMMISSION_DUE':hasUnpaidBooking?'UNPAID_BOOKING':'NONE'
    };
  }

  async cancelRide({rideId,driverUserId}={}){
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof rideId!=='string'||rideId.length>64)throw new RidesError('INVALID_RIDE');
    return this.tx(async client=>{
      const result=await client.query(
        'SELECT * FROM public.campus_rides WHERE id=$1 FOR UPDATE',[rideId]);
      const ride=result.rows[0];
      if(!ride||ride.status!=='active')throw new RidesError('RIDE_NOT_FOUND',404);
      if(ride.driver_user_id!==driverUserId)throw new RidesError('NOT_RIDE_OWNER',403);
      await client.query(
        "UPDATE public.campus_bookings SET status='cancelled',cancelled_at=now() WHERE ride_id=$1 AND status='active'",
        [rideId]);
      await client.query(
        "UPDATE public.campus_rides SET status='cancelled',seats_left=seats_total,updated_at=now() WHERE id=$1",
        [rideId]);
      return {success:true};
    });
  }
}
module.exports={PgRidesStore,RidesError,ridePublic,bookingPublic,checkRideInput};
