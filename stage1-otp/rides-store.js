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
    upiId:r.upi_id,paymentMode:r.payment_mode||'legacy',...(r.actor_role?{actorRole:r.actor_role}:{}),status:r.status,cancelledAt:r.cancelled_at?asDate(r.cancelled_at):null,...journeyPublic(r),boardedAt:r.boarded_at?asDate(r.boarded_at):null,createdAt:asDate(r.created_at),...(r.pickup_case_id?{pickupCase:{id:r.pickup_case_id,state:r.pickup_case_state,openedAt:asDate(r.pickup_case_opened_at)}}:{})
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
  constructor({pool,freePilot=false,journeyEnabled=false,boardingPinEnabled=false,boardingPinKey='',pickupAbortEnabled=false,caseResponseEnabled=false,caseReviewEnabled=false}={}) {
    if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
      throw Error('PgRidesStore requires an existing private PostgreSQL pool');
    this.pool=pool;
    this.paymentMode=freePilot?'free_pilot':'legacy';
    this.journeyEnabled=journeyEnabled===true;
    this.boardingPinEnabled=boardingPinEnabled===true;
    this.pickupAbortEnabled=pickupAbortEnabled===true;
    this.caseSchemaReady=false;
    this.caseResponseEnabled=caseResponseEnabled===true;
    this.responseSchemaReady=false;
    this.caseReviewEnabled=caseReviewEnabled===true;
    this.reviewSchemaReady=false;
    if(this.caseReviewEnabled&&!this.caseResponseEnabled)
      throw Error('Case review requires private case response feature');
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
    // Read-only historical case review must survive feature rollback.
    // If 012 was not deployed yet, old applications can still boot with the
    // pickup feature OFF and review cancelled Pending by booking status.
    const caseTables=await this.pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('campus_booking_cases','campus_booking_case_events')");
    this.caseSchemaReady=caseTables.rows[0].n===2;
    if(this.pickupAbortEnabled&&!this.caseSchemaReady)
      throw Error('Migration 012 pickup cases are required');
    if(this.caseResponseEnabled){
      if(!this.caseSchemaReady)throw Error('Case responses require pickup case migration 012');
      const responses=await this.pool.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='campus_booking_case_responses'");
      this.responseSchemaReady=responses.rows[0].n===1;
      if(!this.responseSchemaReady)
        throw Error('Migration 013 private case responses are required');
    }
    if(this.caseReviewEnabled){
      const reviews=await this.pool.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('campus_case_reviewer_grants','campus_case_review_decisions','campus_case_appeals','campus_case_appeal_reviews')");
      this.reviewSchemaReady=reviews.rows[0].n===4;
      if(!this.reviewSchemaReady)
        throw Error('Migration 014 guarded review and appeals schema is required');
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
    const joinCase=this.caseSchemaReady
      ? "LEFT JOIN public.campus_booking_cases c ON c.booking_id=b.booking_id"
      : "";
    const caseColumns=this.caseSchemaReady
      ? ",c.id AS pickup_case_id,c.state AS pickup_case_state,c.opened_at AS pickup_case_opened_at"
      : "";
    const r=await this.pool.query([
      'SELECT b.*,r.journey_stage,r.departed_at,r.pickup_at,r.arrived_at,',
      "CASE WHEN r.driver_user_id=$1 THEN 'driver' ELSE 'passenger' END AS actor_role"+caseColumns,
      'FROM public.campus_bookings b JOIN public.campus_rides r ON r.id=b.ride_id',
      joinCase,
      'WHERE (b.passenger_user_id=$1 OR r.driver_user_id=$1)',
      'ORDER BY b.created_at DESC,b.booking_id DESC LIMIT $2 OFFSET $3'
    ].filter(Boolean).join(' '),[userId,limit,offset]);
    return r.rows.map(bookingPublic);
  }

  // An abort is a *claim only*. It never changes booking.status, seat
  // capacity, financial markers or the self-reported driver timeline.
  async reportPickupAbort({bookingId,actorUserId,reason,client:txClient}={}){
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
    },txClient);
  }


  // Read-only case timeline. Return role and bounded categorical claims,
  // never actor IDs, contact details, PIN material or settlement identifiers.
  async getBookingCase({bookingId,actorUserId}={}){
    if(!this.caseResponseEnabled||!this.responseSchemaReady)
      throw new RidesError('CASE_RESPONSE_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))
      throw new RidesError('INVALID_BOOKING',400);
    if(typeof actorUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    const r=await this.pool.query([
      'SELECT b.booking_id,b.passenger_user_id,r.driver_user_id,',
      'c.id AS case_id,c.state,c.opened_at',
      'FROM public.campus_bookings b',
      'JOIN public.campus_rides r ON r.id=b.ride_id',
      'LEFT JOIN public.campus_booking_cases c ON c.booking_id=b.booking_id',
      'WHERE b.booking_id=$1'
    ].join(' '),[bookingId]);
    const row=r.rows[0];
    if(!row)throw new RidesError('BOOKING_NOT_FOUND',404);
    const actorRole=row.passenger_user_id===actorUserId?'passenger'
      :row.driver_user_id===actorUserId?'driver':null;
    if(!actorRole)throw new RidesError('NOT_BOOKING_PARTICIPANT',403);
    if(!row.case_id)throw new RidesError('PICKUP_CASE_NOT_FOUND',404);
    const [claims,responses]=await Promise.all([
      this.pool.query([
        'SELECT actor_role,reason,created_at',
        'FROM public.campus_booking_case_events WHERE case_id=$1',
        'ORDER BY created_at ASC,id ASC LIMIT 20'
      ].join(' '),[row.case_id]),
      this.pool.query([
        'SELECT actor_role,response_code,created_at,actor_user_id',
        'FROM public.campus_booking_case_responses WHERE case_id=$1',
        'ORDER BY created_at ASC,id ASC LIMIT 2'
      ].join(' '),[row.case_id])
    ]);
    const otherClaim=claims.rows.some(x=>x.actor_role!==actorRole);
    let review=null,appeals=[],canAppeal=false;
    if(this.caseReviewEnabled){
      const [decision,appealRows]=await Promise.all([
        this.pool.query([
          'SELECT decision_code,created_at FROM public.campus_case_review_decisions',
          'WHERE case_id=$1'
        ].join(' '),[row.case_id]),
        this.pool.query([
          'SELECT a.id,a.actor_user_id,a.reason_code,a.created_at,',
          'ar.result_code,ar.created_at AS result_at',
          'FROM public.campus_case_appeals a',
          'LEFT JOIN public.campus_case_appeal_reviews ar ON ar.appeal_id=a.id',
          'WHERE a.case_id=$1 ORDER BY a.created_at,a.id'
        ].join(' '),[row.case_id])
      ]);
      if(decision.rows[0])review={
        code:decision.rows[0].decision_code,
        recordedAt:asDate(decision.rows[0].created_at)
      };
      // Appeal reasoning is private to its submitting actor; other party
      // can see that an appeal exists, never the actor ID or safety context.
      appeals=appealRows.rows.map(a=>({
        mine:a.actor_user_id===actorUserId,
        reason:a.actor_user_id===actorUserId?a.reason_code:null,
        filedAt:asDate(a.created_at),
        outcome:a.result_code||null,
        outcomeAt:a.result_at?asDate(a.result_at):null
      }));
      canAppeal=!!review&&!appealRows.rows.some(a=>a.actor_user_id===actorUserId);
    }
    return {bookingId,caseId:row.case_id,state:row.state,openedAt:asDate(row.opened_at),
      actorRole,canRespond:otherClaim&&!responses.rows.some(x=>x.actor_user_id===actorUserId),
      review,appeals,canAppeal,
      claims:claims.rows.map(x=>({
        actorRole:x.actor_role,reason:x.reason,createdAt:asDate(x.created_at)
      })),
      responses:responses.rows.map(x=>({
        actorRole:x.actor_role,code:x.response_code,createdAt:asDate(x.created_at)
      })),
      message:'Statements are unverified. Reviewer and appeal entries are administrative records, not payment, account penalties or proof of fault.'};
  }

  async respondToBookingCase({bookingId,actorUserId,code,client:txClient}={}){
    if(!this.caseResponseEnabled||!this.responseSchemaReady)
      throw new RidesError('CASE_RESPONSE_NOT_ENABLED',503);
    if(typeof bookingId!=='string'||!/^BKG-[0-9a-f-]{36}$/.test(bookingId))
      throw new RidesError('INVALID_BOOKING',400);
    const responseCodes=new Set(['present_at_pickup','could_not_find_partner',
      'attempted_contact','other_party_not_present','safety_concern','other']);
    if(!responseCodes.has(code)||typeof code!=='string')
      throw new RidesError('INVALID_CASE_RESPONSE',400);
    if(typeof actorUserId!=='string')throw new RidesError('AUTH_REQUIRED',401);
    return this.tx(async client=>{
      const {ride,booking}=await this.lockedBoardingBooking(client,bookingId);
      const role=booking.passenger_user_id===actorUserId?'passenger'
        :ride.driver_user_id===actorUserId?'driver':null;
      if(!role)throw new RidesError('NOT_BOOKING_PARTICIPANT',403);
      const c=await client.query(
        'SELECT id,state FROM public.campus_booking_cases WHERE booking_id=$1 FOR UPDATE',[bookingId]);
      if(!c.rows.length)throw new RidesError('PICKUP_CASE_NOT_FOUND',404);
      if(c.rows[0].state!=='open')throw new RidesError('CASE_NOT_OPEN',409);
      const hasOther=await client.query([
        'SELECT 1 FROM public.campus_booking_case_events',
        'WHERE case_id=$1 AND actor_user_id<>$2::uuid LIMIT 1'
      ].join(' '),[c.rows[0].id,actorUserId]);
      if(!hasOther.rows.length)
        throw new RidesError('COUNTERPARTY_CLAIM_REQUIRED',409);
      const recorded=await client.query([
        'INSERT INTO public.campus_booking_case_responses(case_id,actor_user_id,actor_role,response_code)',
        'VALUES ($1,$2,$3,$4)',
        'ON CONFLICT (case_id,actor_user_id) DO NOTHING RETURNING id,created_at'
      ].join(' '),[c.rows[0].id,actorUserId,role,code]);
      if(!recorded.rows.length){
        const previous=await client.query([
          'SELECT response_code FROM public.campus_booking_case_responses',
          'WHERE case_id=$1 AND actor_user_id=$2'
        ].join(' '),[c.rows[0].id,actorUserId]);
        if(previous.rows[0]?.response_code!==code)
          throw new RidesError('CASE_RESPONSE_ALREADY_RECORDED',409);
      }
      return {bookingId,caseId:c.rows[0].id,state:'open',
        recorded:recorded.rows.length===1,
        message:'Response recorded for neutral review. No fee, strike, ban or payment decision was made.'};
    },txClient);
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
    // Legacy Pending is a *historical database marker*, not proof that money
    // moved or that a passenger actually travelled. Keep cancelled/disputed
    // items in review; retain the existing active-only booking restriction
    // pending an explicit approved replacement policy.
    //
    // A driver has NO collectible commission without verified settlement
    // evidence. In particular seats_total-seats_left is a capacity counter,
    // not proof that the service occurred. Never convert it to a debt.
    //
    // One statement, one MVCC snapshot and a single pool acquisition,
    // including the caller-supplied transaction client where present.
    const caseJoin=this.caseSchemaReady
      ? 'LEFT JOIN public.campus_booking_cases pc ON pc.booking_id=b.booking_id'
      : '';
    const caseColumn=this.caseSchemaReady
      ? ',pc.id AS pickup_case_id,pc.state AS pickup_case_state,pc.opened_at AS pickup_case_opened_at'
      : '';
    const result=await (client||this.pool).query([
      'SELECT driver_stats.review_count AS driver_review_count,',
      'b.*,r.journey_stage,r.departed_at,r.pickup_at,r.arrived_at,'+
      'r.status AS ride_status'+caseColumn,
      'FROM (',
      'SELECT COUNT(*)::int AS review_count FROM public.campus_bookings db',
      'JOIN public.campus_rides dr ON dr.id=db.ride_id',
      "WHERE dr.driver_user_id=$1 AND db.payment_mode='legacy' AND db.payment_status='Pending'",
      ') driver_stats',
      'LEFT JOIN public.campus_bookings b ON b.passenger_user_id=$1',
      "AND b.payment_mode='legacy' AND b.payment_status='Pending'",
      'LEFT JOIN public.campus_rides r ON r.id=b.ride_id',
      caseJoin,
      'ORDER BY b.created_at DESC,b.booking_id DESC'
    ].filter(Boolean).join(' '),[userId]);
    const rows=result.rows;
    const driverReviewCount=Number(rows[0]?.driver_review_count||0);
    const activePending=[],review=[];
    for(const row of rows){
      if(row.booking_id===null)continue;
      const booking=bookingPublic(row);
      const disputed=Boolean(row.pickup_case_id);
      if(row.status==='active' && row.ride_status==='active'&&!disputed){
        activePending.push(booking);
      }else{
        review.push(booking);
      }
    }
    const hasUnpaidBooking=activePending.length>0;
    const hasReviewRequired=review.length>0||driverReviewCount>0;
    return {
      // Do not make an unverified commission collectible or restrict driver
      // access on a capacity-derived amount. Existing *active* Pending
      // passenger booking restrictions remain until owner approves policy.
      isBlocked:hasUnpaidBooking,reason:hasUnpaidBooking?'UNPAID_BOOKING':'NONE',
      hasUnsettledCommission:false,hasUnpaidBooking,
      commissionDue:0,
      driverCommission:{totalRides:0,grossFare:0,totalCommission:0,settled:0,netDue:0},
      pendingBookings:activePending,
      reviewRequiredBookings:review,
      hasReviewRequired,driverReviewCount,
      reviewStatus:hasReviewRequired?'REVIEW_REQUIRED':'NONE',
      financialMessage:'Pending is unverified. Cancelled or disputed records require review; no automatic charge, waiver, refund, fee or commission was made.'
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
