'use strict';
const crypto=require('node:crypto');
const {MobilityError,point,cell,windowTimes,rank}=require('./mobility-geo');

// Demand-first travel intents, privacy-preserving candidate ranking, and
// index-aware PostGIS queries. No background workers or AI decisions yet.
class PgMobilityStore {
  constructor({pool}={}) {
    if(!pool || typeof pool.query!=='function' || typeof pool.connect!=='function'){
      throw Error('PgMobilityStore requires the private application PostgreSQL pool');
    }
    this.pool=pool;
  }
  async ready(){
    await this.pool.query('SELECT 1 FROM public.campus_trip_intents LIMIT 0');
    await this.pool.query('SELECT 1 FROM public.campus_ride_geo LIMIT 0');
  }
  async createIntent({studentUserId,pickup,dropoff,earliestDeparture,latestDeparture}={}){
    if(typeof studentUserId!=='string')throw new MobilityError('AUTH_REQUIRED',401);
    const origin=point(pickup),destination=point(dropoff);
    const {first,last,firstBucket}=windowTimes(earliestDeparture,latestDeparture);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // An expired intent cannot indefinitely block a new commute request.
      await client.query([
        "UPDATE public.campus_trip_intents SET status='expired',updated_at=now()",
        "WHERE student_user_id=$1::uuid AND status='active' AND latest_departure<now()"
      ].join(' '),[studentUserId]);
      const id=crypto.randomUUID();
      const sql=[
        'INSERT INTO public.campus_trip_intents',
        '(id,student_user_id,pickup_geo,dropoff_geo,pickup_cell,dropoff_cell,',
        'first_bucket,earliest_departure,latest_departure)',
        'SELECT $1,u.id,',
        'extensions.ST_SetSRID(extensions.ST_MakePoint($2,$3),4326)::extensions.geography,',
        'extensions.ST_SetSRID(extensions.ST_MakePoint($4,$5),4326)::extensions.geography,',
        '$6,$7,$8,$9,$10',
        'FROM public.campus_users u WHERE u.id=$11::uuid AND u.is_verified=true',
        'RETURNING id,pickup_cell,dropoff_cell,earliest_departure,latest_departure'
      ].join(' ');
      const result=await client.query(sql,[id,origin.lon,origin.lat,destination.lon,destination.lat,
        cell(origin),cell(destination),firstBucket,first,last,studentUserId]);
      if(result.rowCount!==1)throw new MobilityError('AUTH_REQUIRED',401);
      await client.query('COMMIT');
      const row=result.rows[0];
      return {
        intentId:row.id,status:'active',pickupCell:row.pickup_cell,dropoffCell:row.dropoff_cell,
        earliestDeparture:new Date(row.earliest_departure).toISOString(),
        latestDeparture:new Date(row.latest_departure).toISOString()
      };
    }catch(err){
      try{await client.query('ROLLBACK');}catch(_){}
      if(err.code==='23505')throw new MobilityError('ACTIVE_INTENT_EXISTS',409);
      throw err;
    }finally{client.release();}
  }
  async getActiveIntent({studentUserId,intentId}={}){
    if(!studentUserId)throw new MobilityError('AUTH_REQUIRED',401);
    const r=await this.pool.query([
      'SELECT id,pickup_cell,dropoff_cell,earliest_departure,latest_departure',
      'FROM public.campus_trip_intents WHERE student_user_id=$1',
      "AND status='active' AND latest_departure>=now()",
      ...(intentId?['AND id=$2::uuid']:[]),
      'ORDER BY created_at DESC LIMIT 1'
    ].join(' '),intentId?[studentUserId,intentId]:[studentUserId]);
    const item=r.rows[0];
    return item ? {
      intentId:item.id,status:'active',pickupCell:item.pickup_cell,
      dropoffCell:item.dropoff_cell,
      earliestDeparture:new Date(item.earliest_departure).toISOString(),
      latestDeparture:new Date(item.latest_departure).toISOString()
    }:null;
  }
  async cancelIntent({studentUserId,intentId}={}){
    if(!studentUserId)throw new MobilityError('AUTH_REQUIRED',401);
    if(typeof intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(intentId)){
      throw new MobilityError('INVALID_INTENT',400);
    }
    const r=await this.pool.query([
      "UPDATE public.campus_trip_intents SET status='cancelled',updated_at=now()",
      "WHERE id=$1::uuid AND student_user_id=$2::uuid AND status='active'",
      'RETURNING id'
    ].join(' '),[intentId,studentUserId]);
    if(!r.rows.length)throw new MobilityError('INTENT_NOT_FOUND',404);
    return {success:true};
  }
  async findCandidates({studentUserId,intentId,limit=10}={}){
    if(!studentUserId)throw new MobilityError('AUTH_REQUIRED',401);
    if(typeof intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(intentId)){
      throw new MobilityError('INVALID_INTENT',400);
    }
    const own=await this.getActiveIntent({studentUserId,intentId});
    if(!own)throw new MobilityError('INTENT_NOT_FOUND',404);
    const max=Math.max(1,Math.min(20,Number.isInteger(limit)?limit:10));
    // Both ST_DWithin predicates can use PostGIS GiST indexes. The DB filters
    // time and seats BEFORE evaluating distance-based ranking on candidates.
    // 1.5 km pickup and destination radii are *crow-flight* only.
    const sql=[
      'SELECT g.ride_id,r.vehicle,r.seats_left,r.student_fare,g.departure_at,',
      'extensions.ST_Distance(g.pickup_geo,i.pickup_geo) AS pickup_m,',
      'extensions.ST_Distance(g.dropoff_geo,i.dropoff_geo) AS dropoff_m',
      'FROM public.campus_trip_intents i',
      'JOIN public.campus_ride_geo g ON',
      'extensions.ST_DWithin(g.pickup_geo,i.pickup_geo,1500)',
      'AND extensions.ST_DWithin(g.dropoff_geo,i.dropoff_geo,1500)',
      'JOIN public.campus_rides r ON r.id=g.ride_id',
      "WHERE i.id=$1::uuid AND i.student_user_id=$2::uuid AND i.status='active'",
      "AND r.status='active' AND r.seats_left>0 AND r.driver_user_id<>$2::uuid",
      'AND g.departure_at>=i.earliest_departure AND g.departure_at<=i.latest_departure',
      'AND g.departure_at>=now()-interval \'10 minutes\'',
      'ORDER BY (extensions.ST_Distance(g.pickup_geo,i.pickup_geo)+',
      'extensions.ST_Distance(g.dropoff_geo,i.dropoff_geo)) ASC,g.departure_at ASC',
      'LIMIT $3'
    ].join(' ');
    const data=await this.pool.query(sql,[intentId,studentUserId,max]);
    return {
      intentId,matchingMode:'geometric_candidates',
      routeVerificationRequired:true,
      candidates:data.rows.map(rank)
    };
  }
}
module.exports={PgMobilityStore,MobilityError};
