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
function journeyPublic(r){
 return {journeyStage:r.journey_stage||'scheduled',
 departedAt:r.departed_at?asDate(r.departed_at):null,
 pickupAt:r.pickup_at?asDate(r.pickup_at):null,
 arrivedAt:r.arrived_at?asDate(r.arrived_at):null};
}
function ridePublic(r){
  if(!r)return null;
  return {
    id:r.id,driverName:r.driver_name,driverEmail:r.driver_email,
    driverPhone:r.driver_phone,dept:r.dept,vehicle:r.vehicle,
    vehicleModel:r.vehicle_model,pickup:r.pickup,destination:r.destination,
    departureTime:r.departure_time,seatsTotal:Number(r.seats_total),
    seatsLeft:Number(r.seats_left),uberBenchmark:Number(r.uber_benchmark),
    studentFare:Number(r.student_fare),driverPayout:Number(r.driver_payout),
    note:r.note,upiId:r.upi_id,paymentMode:r.payment_mode||'legacy',...journeyPublic(r),createdAt:asDate(r.created_at)
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
    upiId:r.upi_id,paymentMode:r.payment_mode||'legacy',status:r.status,cancelledAt:r.cancelled_at?asDate(r.cancelled_at):null,...journeyPublic(r),boardedAt:r.boarded_at?asDate(r.boarded_at):null,createdAt:asDate(r.created_at),...(r.pickup_case_id?{pickupCase:{id:r.pickup_case_id,state:r.pickup_case_state,openedAt:asDate(r.pickup_case_opened_at)}}:{})
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
  constructor({pool,freePilot=false,journeyEnabled=false,boardingPinEnabled=false,boardingPinKey='',pickupAbortEnabled=false}={}) {
    if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
      throw Error('PgRidesStore requires an existing private PostgreSQL pool');
    this.pool=pool;
    this.paymentMode=freePilot?'free_pilot':'legacy';
    this.journeyEnabled=journeyEnabled===true;
    this.boardingPinEnabled=boardingPinEnabled===true;
    this.pickupAbortEnabled=pickupAbortEnabled===true;
    if(this.pickupAbortEnabled && (!this.journeyEnabled||!this.boardingPinEnabled))
      throw Error('Pickup abort requires journey + per-passenger boarding proof');
    if(this.boardingPinEnabled && (!this.journeyEnabled || Buffer.byteLength(boardingPinKey,'utf8')<32))
      throw Error('Boarding PIN requires enabled journey and a strong private key');
    this.boardingPinKey=this.boardingPinEnabled?Buffer.from(boardingPinKey,'utf8'):null;
  }
  async ready(){
    await this.pool.query('SELECT payment_mode FROM public.campus_rides LIMIT 0');
    await this.pool.query('SELECT payment_mode FROM public.campus_bookings LIMIT 0');
    const {rows}=await this.pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE convalidated AND ((conrelid='public.campus_rides'::regclass AND conname='campus_ride_payment_mode_check') OR (conrelid='public.campus_bookings'::regclass AND conname IN ('campus_booking_payment_mode_check','campus_booking_ride_payment_mode_fk')))");
    if(rows[0].n!==3)throw Error('Migration 009 payment mode constraints are required');
    const journey=await this.pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.campus_rides'::regclass AND conname='campus_ride_journey_stage_check' AND convalidated");
    if(journey.rows[0].n!==1)throw Error('Migration 010 journey constraints are required');
    if(this.boardingPinEnabled){
      const pin=await this.pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.campus_bookings'::regclass AND conname='campus_booking_boarding_pin_check' AND convalidated");
      if(pin.rows[0].n!==1)throw Error('Migration 011 boarding PIN constraints are required');
    }
    if(this.pickupAbortEnabled){
      const r=await this.pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('campus_booking_cases','campus_booking_case_events')");
      if(r.rows[0].n!==2)throw Error('Migration 012 pickup cases are required');
    }
  }
  async tx(fn,externalClient){
    if(externalClient)return fn(externalClient);
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
  async createRide({driverUserId,ride,client:txClient}={}){
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    const r=checkRideInput(ride);
    if(this.paymentMode==='free_pilot' && (ride.studentFare!==0||ride.driverPayout!==0||ride.uberBenchmark!==0||r.upiId!==''))throw new RidesError('FREE_PILOT_ZERO_FARE_REQUIRED',400);
    const geo=rideRouteInput(ride);
    const id='ride_'+crypto.randomUUID();
    // The ride and its optional geo points are created atomically.
    // Without coordinates, legacy ride listings still work unchanged.
    return this.tx(async client=>{
      const sql=[
        'INSERT INTO public.campus_rides',
        '(id,driver_user_id,driver_name,driver_email,driver_phone,dept,vehicle,vehicle_model,',
        'pickup,destination,departure_time,seats_total,seats_left,uber_benchmark,',
        'student_fare,driver_payout,note,upi_id,payment_mode)',
        'SELECT $1,u.id,u.name,u.email,u.phone,u.dept,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$14',
        'FROM public.campus_users u WHERE u.id=$13::uuid AND u.is_verified=true',
        'RETURNING *'
      ].join(' ');
      const params=[id,r.vehicle,r.vehicleModel,r.pickup,r.destination,r.departureTime,
        r.seats,r.uberBenchmark,r.studentFare,r.driverPayout,r.note,r.upiId,driverUserId,this.paymentMode];
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
    },txClient);
  }
  async getRides(){
    const r=await this.pool.query(
      "SELECT * FROM public.campus_rides WHERE status='active' AND journey_stage='scheduled' AND payment_mode=$1 ORDER BY created_at DESC",[this.paymentMode]);
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
      'SELECT b.*,r.journey_stage,r.departed_at,r.pickup_at,r.arrived_at FROM public.campus_bookings b',
      'JOIN public.campus_rides r ON r.id=b.ride_id',
      "WHERE b.status='active' AND (b.passenger_user_id=$1 OR r.driver_user_id=$1)",
      'ORDER BY b.created_at DESC'
    ].join(' '),[userId]);
    return r.rows.map(bookingPublic);
  }
  // Historical read path does NOT filter by active booking or ride; cancelled
  // Pending remains visible but is never auto-declared collectible or waived.
  async getBookingHistory(userId,{limit=30,offset=0}={}){
    if(!userId||!Number.isInteger(limit)||limit<1||limit>50||
       !Number.isInteger(offset)||offset<0||offset>1000)
      throw new RidesError('INVALID_HISTORY_PAGE',400);
    const joinCase=this.pickupAbortEnabled
      ? "LEFT JOIN public.campus_booking_cases c ON c.booking_id=b.booking_id"
      : "";
    const caseColumns=this.pickupAbortEnabled
      ? ",c.id AS pickup_case_id,c.state AS pickup_case_state,c.opened_at AS pickup_case_opened_at"
      : "";
    const r=await this.pool.query([
      'SELECT b.*,r.journey_stage,r.departed_at,r.pickup_at,r.arrived_at'+caseColumns,
      'FROM public.campus_bookings b JOIN public.campus_rides r ON r.id=b.ride_id',
      joinCase,
      'WHERE (b.passenger_user_id=$1 OR r.driver_user_id=$1)',
      'ORDER BY b.created_at DESC,b.booking_id DESC LIMIT $2 OFFSET $3'
    ].filter(Boolean).join(' '),[userId,limit,offset]);
    return r.rows.map(bookingPublic);
  }

  // An abort is a *claim only*. It never changes booking.status, seat
  // capacity, financial markers or the self-reported driver timeline.
  async reportPickupAbort({bookingId,actorUserId,reason}={}){
    if(!this.pickupAbortEnabled)throw new RidesError('PICKUP_ABORT_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))
      throw new RidesError('INVALID_BOOKING',400);
    const reasons=new Set(['no_response','could_not_locate','changed_plans','safety_emergency','other']);
    if(typeof reason!=='string'||!reasons.has(reason))
      throw new RidesError('INVALID_PICKUP_REASON',400);
    if(typeof actorUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    return this.tx(async client=>{
      const {ride,booking}=await this.lockedBoardingBooking(client,bookingId);
      const role=booking.passenger_user_id===actorUserId?'passenger'
        :ride.driver_user_id===actorUserId?'driver':null;
      if(!role)throw new RidesError('NOT_BOOKING_PARTICIPANT',403);
      const emergency=reason==='safety_emergency';
      if(!emergency){
        if(ride.status!=='active'||booking.status!=='active'||
          ride.journey_stage!=='pickup_ready'||booking.boarded_at)
          throw new RidesError('PICKUP_NOT_UNRESOLVED',409);
        const elapsed=await client.query(
          "SELECT clock_timestamp() >= $1::timestamptz + interval '5 minutes' AS allowed",
          [ride.pickup_at]);
        if(!elapsed.rows[0].allowed)throw new RidesError('PICKUP_WAIT_NOT_ELAPSED',409);
      }
      const c=await client.query([
        'INSERT INTO public.campus_booking_cases(booking_id) VALUES ($1)',
        'ON CONFLICT (booking_id) DO NOTHING RETURNING id,state,opened_at'
      ].join(' '),[bookingId]);
      const current=c.rows[0]|| (await client.query(
        'SELECT id,state,opened_at FROM public.campus_booking_cases WHERE booking_id=$1',[bookingId])).rows[0];
      const event=await client.query([
        'INSERT INTO public.campus_booking_case_events(case_id,actor_user_id,actor_role,reason)',
        'VALUES ($1,$2,$3,$4)',
        'ON CONFLICT (case_id,actor_user_id,reason) DO NOTHING RETURNING id'
      ].join(' '),[current.id,actorUserId,role,reason]);
      return {caseId:current.id,bookingId,state:current.state,
        openedAt:asDate(current.opened_at),recorded:event.rows.length===1,
        message:'Pickup report recorded for review. No penalty or payment change was made.'};
    });
  }

  async pickupWaitStatus({bookingId,actorUserId}={}){
    if(!this.pickupAbortEnabled)throw new RidesError('PICKUP_ABORT_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))
      throw new RidesError('INVALID_BOOKING',400);
    const r=await this.pool.query([
      'SELECT b.booking_id,b.status AS booking_status,b.boarded_at,',
      'r.driver_user_id,b.passenger_user_id,r.journey_stage,r.status AS ride_status,r.pickup_at,',
      'c.id AS case_id,c.state AS case_state,clock_timestamp() AS server_now',
      'FROM public.campus_bookings b JOIN public.campus_rides r ON r.id=b.ride_id',
      'LEFT JOIN public.campus_booking_cases c ON c.booking_id=b.booking_id',
      'WHERE b.booking_id=$1'
    ].join(' '),[bookingId]);
    const row=r.rows[0];
    if(!row)throw new RidesError('BOOKING_NOT_FOUND',404);
    if(row.driver_user_id!==actorUserId&&row.passenger_user_id!==actorUserId)
      throw new RidesError('NOT_BOOKING_PARTICIPANT',403);
    const due=row.pickup_at?new Date(new Date(row.pickup_at).getTime()+300000):null;
    const eligible=row.ride_status==='active'&&row.booking_status==='active'
      &&row.journey_stage==='pickup_ready'&&!row.boarded_at&&due
      &&new Date(row.server_now)>=due;
    return {bookingId,serverNow:asDate(row.server_now),
      pickupReportedAt:row.pickup_at?asDate(row.pickup_at):null,
      abortEligibleAt:due?due.toISOString():null,eligible:!!eligible,
      boardingConfirmed:!!row.boarded_at,caseId:row.case_id||null,
      caseState:row.case_state||null,
      note:'Pickup time is reported by the driver, not independently verified.'};
  }

  async bookRide({rideId,passengerUserId,client:txClient}={}){
    if(typeof passengerUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof rideId!=='string'||rideId.length>64)throw new RidesError('INVALID_RIDE');
    return this.tx(async client=>{
      // One lock serializes reservations, cancellations and capacity checks
      // across all Node workers/instances.
      const rideResult=await client.query(
        'SELECT * FROM public.campus_rides WHERE id=$1 FOR UPDATE',[rideId]);
      const ride=rideResult.rows[0];
      if(!ride||ride.status!=='active')throw new RidesError('RIDE_NOT_FOUND',404);
      if(ride.payment_mode!==this.paymentMode)throw new RidesError('RIDE_PAYMENT_MODE_UNAVAILABLE',409);
      if(ride.journey_stage!=='scheduled')throw new RidesError('JOURNEY_BOOKING_CLOSED',409);
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
        'departure_time,student_fare,upi_id,payment_mode,payment_status)',
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
        'RETURNING *'
      ].join(' '),[bookingId,rideId,passenger.id,passenger.name,passenger.email,
        ride.driver_name,ride.driver_email,ride.driver_phone,ride.dept,
        ride.vehicle_model,ride.pickup,ride.destination,ride.departure_time,
        ride.student_fare,ride.upi_id,ride.payment_mode,ride.payment_mode==='free_pilot'?'NoPaymentRequired':'Pending']);
      return bookingPublic(insert.rows[0]);
    },txClient);
  }
  async cancelBooking({bookingId,passengerUserId,client:txClient}={}){
    if(typeof passengerUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof bookingId!=='string'||bookingId.length>64)throw new RidesError('INVALID_BOOKING');
    return this.tx(async client=>{
      // Acquire locks in ride -> booking order to match reservation/ride cancellation.
      const found=await client.query(
        'SELECT ride_id FROM public.campus_bookings WHERE booking_id=$1',[bookingId]);
      if(!found.rows.length)throw new RidesError('BOOKING_NOT_FOUND',404);
      const lockedRide=await client.query('SELECT journey_stage FROM public.campus_rides WHERE id=$1 FOR UPDATE',[found.rows[0].ride_id]);
      const current=await client.query(
        'SELECT * FROM public.campus_bookings WHERE booking_id=$1 FOR UPDATE',[bookingId]);
      const booking=current.rows[0];
      if(!booking||booking.status!=='active')throw new RidesError('BOOKING_NOT_FOUND',404);
      if(booking.passenger_user_id!==passengerUserId)throw new RidesError('NOT_BOOKING_PASSENGER',403);
      if(lockedRide.rows[0]?.journey_stage!=='scheduled')throw new RidesError('JOURNEY_ALREADY_STARTED',409);
      await client.query(
        "UPDATE public.campus_bookings SET status='cancelled',cancelled_at=now() WHERE booking_id=$1",
        [bookingId]);
      await client.query(
        'UPDATE public.campus_rides SET seats_left=LEAST(seats_total,seats_left+1),updated_at=now() WHERE id=$1',
        [booking.ride_id]);
      return {success:true,rideId:booking.ride_id};
    },txClient);
  }
  async isRideDriver(rideId,userId){
    if(!rideId||!userId)return false;
    const r=await this.pool.query(
      "SELECT 1 FROM public.campus_rides WHERE id=$1 AND driver_user_id=$2 AND status='active' AND journey_stage<>'arrived' LIMIT 1",
      [rideId,userId]);
    return r.rows.length>0;
  }
  async isRideParticipant(rideId,userId){
    if(!rideId||!userId)return false;
    const r=await this.pool.query([
      'SELECT 1 FROM public.campus_rides r WHERE r.id=$1 AND r.status=\'active\' AND r.journey_stage<>\'arrived\'',
      "AND (r.driver_user_id=$2 OR EXISTS (SELECT 1 FROM public.campus_bookings b",
      "WHERE b.ride_id=r.id AND b.passenger_user_id=$2 AND b.status='active')) LIMIT 1"
    ].join(' '),[rideId,userId]);
    return r.rows.length>0;
  }
  async isBookingPassenger(bookingId,userId){
    if(!bookingId||!userId)return false;
    const r=await this.pool.query(
      "SELECT 1 FROM public.campus_bookings b JOIN public.campus_rides r ON r.id=b.ride_id WHERE b.booking_id=$1 AND b.passenger_user_id=$2 AND b.status='active' AND r.status='active' AND r.journey_stage<>'arrived' LIMIT 1",
      [bookingId,userId]);
    return r.rows.length>0;
  }
  async isBookingParticipant(bookingId,userId){
    if(!bookingId||!userId)return false;
    const r=await this.pool.query([
      'SELECT 1 FROM public.campus_bookings b',
      'JOIN public.campus_rides r ON r.id=b.ride_id',
      "WHERE b.booking_id=$1 AND b.status='active' AND r.status='active' AND r.journey_stage<>'arrived'",
      'AND (b.passenger_user_id=$2 OR r.driver_user_id=$2) LIMIT 1'
    ].join(' '),[bookingId,userId]);
    return r.rows.length>0;
  }
  async checkUserSettlementBlock(userId,client){
    if(!userId)return {isBlocked:false,reason:'NONE'};
    // Payment settlement is intentionally disabled. Existing 'Pending'
    // bookings and unpaid driver commission continue to block new actions.
    // One statement, one MVCC snapshot and (without a transaction client)
    // one pool acquisition. Aggregate before joining so pending rows cannot
    // multiply the driver totals. Keep native PG column types for bookingPublic.
    const {rows}=await (client||this.pool).query([
      'SELECT c.seats_sold,c.gross,b.* FROM (',
      'SELECT COALESCE(SUM(seats_total-seats_left),0)::int AS seats_sold,',
      'COALESCE(SUM((seats_total-seats_left)*student_fare),0) AS gross',
      'FROM public.campus_rides WHERE driver_user_id=$1',
      ') c LEFT JOIN public.campus_bookings b',
      "ON b.passenger_user_id=$1 AND b.status='active' AND b.payment_status='Pending'",
      'ORDER BY b.created_at DESC'
    ].join(' '),[userId]);
    const totalRides=Number(rows[0].seats_sold);
    const grossFare=Number(rows[0].gross);
    const totalCommission=Math.round(grossFare*0.1);
    const commissionDue=totalCommission;
    // LEFT JOIN retains the commission row even when no pending booking exists.
    const pendingBookings=rows.filter(row=>row.booking_id!==null).map(bookingPublic);
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


  // PINs are derived only on demand with a server-secret HMAC and random nonce.
  // The database never stores the six-digit code, and general booking reads never include it.
  deriveBoardingPin(bookingId,nonce){
    const digest=crypto.createHmac('sha256',this.boardingPinKey)
      .update('campuspool:boarding:v1:'+bookingId+':'+nonce).digest();
    return String(digest.readUInt32BE(0)%1000000).padStart(6,'0');
  }
  async lockedBoardingBooking(client,bookingId){
    const result=await client.query('SELECT ride_id FROM public.campus_bookings WHERE booking_id=$1',[bookingId]);
    if(!result.rows.length)throw new RidesError('BOOKING_NOT_FOUND',404);
    // Reuse universal ride -> booking lock order to avoid cancellation deadlocks.
    const ride=(await client.query('SELECT id,driver_user_id,status,journey_stage,pickup_at FROM public.campus_rides WHERE id=$1 FOR UPDATE',[result.rows[0].ride_id])).rows[0];
    const booking=(await client.query('SELECT * FROM public.campus_bookings WHERE booking_id=$1 FOR UPDATE',[bookingId])).rows[0];
    if(!ride||!booking)throw new RidesError('BOOKING_NOT_FOUND',404);
    return {ride,booking};
  }
  async issueBoardingPin({bookingId,passengerUserId}={}){
    if(!this.boardingPinEnabled)throw new RidesError('BOARDING_PIN_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))throw new RidesError('INVALID_BOOKING',400);
    if(typeof passengerUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    return this.tx(async client=>{
      const {ride,booking}=await this.lockedBoardingBooking(client,bookingId);
      if(booking.passenger_user_id!==passengerUserId)throw new RidesError('NOT_BOOKING_PASSENGER',403);
      if(ride.status!=='active'||booking.status!=='active')throw new RidesError('BOOKING_NOT_ACTIVE',409);
      if(booking.boarded_at)return {success:true,alreadyBoarded:true,boardedAt:asDate(booking.boarded_at)};
      if(ride.journey_stage!=='pickup_ready')throw new RidesError('BOARDING_NOT_AT_PICKUP',409);
      const now=(await client.query('SELECT clock_timestamp() AS observed_at')).rows[0].observed_at;
      if(booking.boarding_pin_nonce&&booking.boarding_pin_expires_at>now){
        if(booking.boarding_pin_attempts>=5)throw new RidesError('BOARDING_PIN_LOCKED',429);
        return {success:true,pin:this.deriveBoardingPin(bookingId,booking.boarding_pin_nonce),
          expiresAt:asDate(booking.boarding_pin_expires_at)};
      }
      const nonce=crypto.randomBytes(24).toString('hex');
      const issued=await client.query(
        "UPDATE public.campus_bookings SET boarding_pin_nonce=$2,boarding_pin_expires_at=clock_timestamp()+interval '20 minutes',boarding_pin_attempts=0 WHERE booking_id=$1 RETURNING boarding_pin_expires_at",
        [bookingId,nonce]);
      return {success:true,pin:this.deriveBoardingPin(bookingId,nonce),
        expiresAt:asDate(issued.rows[0].boarding_pin_expires_at)};
    });
  }
  async verifyBoardingPin({bookingId,driverUserId,pin,client:txClient}={}){
    if(!this.boardingPinEnabled)throw new RidesError('BOARDING_PIN_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))throw new RidesError('INVALID_BOOKING',400);
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof pin!=='string'||!/^\d{6}$/.test(pin))throw new RidesError('INVALID_BOARDING_PIN',400);
    return this.tx(async client=>{
      const {ride,booking}=await this.lockedBoardingBooking(client,bookingId);
      if(ride.driver_user_id!==driverUserId)throw new RidesError('NOT_RIDE_OWNER',403);
      if(ride.status!=='active'||booking.status!=='active')throw new RidesError('BOOKING_NOT_ACTIVE',409);
      if(booking.boarded_at)return {status:200,body:{success:true,alreadyBoarded:true,boardedAt:asDate(booking.boarded_at)}};
      if(ride.journey_stage!=='pickup_ready')throw new RidesError('BOARDING_NOT_AT_PICKUP',409);
      const now=(await client.query('SELECT clock_timestamp() AS observed_at')).rows[0].observed_at;
      if(!booking.boarding_pin_nonce||!booking.boarding_pin_expires_at||booking.boarding_pin_expires_at<=now)
        throw new RidesError('BOARDING_PIN_EXPIRED',409);
      if(booking.boarding_pin_attempts>=5)
        return {status:429,body:{success:false,error:'BOARDING_PIN_LOCKED'}};
      const expected=this.deriveBoardingPin(bookingId,booking.boarding_pin_nonce);
      if(!crypto.timingSafeEqual(Buffer.from(pin),Buffer.from(expected))){
        const attempts=Number(booking.boarding_pin_attempts)+1;
        await client.query('UPDATE public.campus_bookings SET boarding_pin_attempts=$2 WHERE booking_id=$1',
          [bookingId,attempts]);
        return {status:attempts>=5?429:409,body:{success:false,
          error:attempts>=5?'BOARDING_PIN_LOCKED':'INVALID_BOARDING_PIN'}};
      }
      const done=await client.query(
        'UPDATE public.campus_bookings SET boarded_at=clock_timestamp(),boarding_pin_nonce=NULL,boarding_pin_expires_at=NULL,boarding_pin_attempts=0 WHERE booking_id=$1 RETURNING boarded_at',
        [bookingId]);
      return {status:200,body:{success:true,boardedAt:asDate(done.rows[0].boarded_at)}};
    },txClient);
  }

  async advanceJourney({rideId,driverUserId,action,client:txClient}={}){
    if(!this.journeyEnabled)throw new RidesError('JOURNEY_NOT_ENABLED',503);
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof rideId!=='string'||rideId.length>64||!rideId.startsWith('ride_'))throw new RidesError('INVALID_RIDE');
    const transitions={depart:['scheduled','departed','departed_at'],pickup:['departed','pickup_ready','pickup_at'],arrive:['pickup_ready','arrived','arrived_at']};
    const step=typeof action==='string' && Object.hasOwn(transitions,action)?transitions[action]:null;
    if(!step)throw new RidesError('INVALID_JOURNEY_ACTION',400);
    return this.tx(async client=>{
      const current=await client.query('SELECT * FROM public.campus_rides WHERE id=$1 FOR UPDATE',[rideId]);
      const ride=current.rows[0];
      if(!ride||ride.status!=='active')throw new RidesError('RIDE_NOT_FOUND',404);
      if(ride.driver_user_id!==driverUserId)throw new RidesError('NOT_RIDE_OWNER',403);
      if(ride.journey_stage!==step[0])throw new RidesError('JOURNEY_INVALID_TRANSITION',409);
      // now() is frozen at transaction start; a queued request can acquire
      // the row lock later. clock_timestamp() reflects the write instant, and
      // GREATEST enforces monotonic timestamps even across clock adjustments.
      const predecessor=action==='pickup'?'departed_at':action==='arrive'?'pickup_at':null;
      const stampedAt=predecessor?'GREATEST(clock_timestamp(),'+predecessor+')':'clock_timestamp()';
      const result=await client.query('UPDATE public.campus_rides SET journey_stage=$2,'+step[2]+'='+stampedAt+',updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[rideId,step[1]]);
      return ridePublic(result.rows[0]);
    },txClient);
  }
  async cancelRide({rideId,driverUserId,client:txClient}={}){
    if(typeof driverUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    if(typeof rideId!=='string'||rideId.length>64)throw new RidesError('INVALID_RIDE');
    return this.tx(async client=>{
      const result=await client.query(
        'SELECT * FROM public.campus_rides WHERE id=$1 FOR UPDATE',[rideId]);
      const ride=result.rows[0];
      if(!ride||ride.status!=='active')throw new RidesError('RIDE_NOT_FOUND',404);
      if(ride.driver_user_id!==driverUserId)throw new RidesError('NOT_RIDE_OWNER',403);
      if(ride.journey_stage==='arrived')throw new RidesError('JOURNEY_ALREADY_ARRIVED',409);
      await client.query(
        "UPDATE public.campus_bookings SET status='cancelled',cancelled_at=now() WHERE ride_id=$1 AND status='active'",
        [rideId]);
      await client.query(
        "UPDATE public.campus_rides SET status='cancelled',seats_left=seats_total,updated_at=now() WHERE id=$1",
        [rideId]);
      return {success:true};
    },txClient);
  }
}
module.exports={PgRidesStore,RidesError,ridePublic,bookingPublic,checkRideInput};
