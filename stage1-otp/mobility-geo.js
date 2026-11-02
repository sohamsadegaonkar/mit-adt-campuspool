'use strict';
// Pure validation and coarse (~1 km) spatial/time grid helpers.
// Grid keys accelerate aggregate discovery; exact location matching uses
// PostGIS geography + GiST, NOT adjacent-cell equality.
class MobilityError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
function point(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      typeof value.lat!=='number' || typeof value.lon!=='number' ||
      !Number.isFinite(value.lat) || !Number.isFinite(value.lon) ||
      value.lat<6 || value.lat>37 || value.lon<68 || value.lon>98) {
    throw new MobilityError('INVALID_COORDINATES',400);
  }
  return {lat:value.lat,lon:value.lon};
}
function cell(p){
  const a=point(p);
  // Cell size is 0.01 degrees. This is a coarse deterministic bucket, NOT
  // a claim of identical meter dimensions across latitude/longitude.
  return Math.floor((a.lat+90)*100)+':'+Math.floor((a.lon+180)*100);
}
function bucket(date){
  const ms=date instanceof Date ? date.getTime() : Date.parse(date);
  if(!Number.isFinite(ms))throw new MobilityError('INVALID_TIME',400);
  return Math.floor(ms / 900000);
}
function strictTime(input){
  if(typeof input!=='string' || input.length>40 ||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input)){
    throw new MobilityError('INVALID_TIME',400);
  }
  const date=new Date(input);
  if(!Number.isFinite(date.getTime()))throw new MobilityError('INVALID_TIME',400);
  return date;
}
function windowTimes(start,end,now=new Date()){
  const first=strictTime(start),last=strictTime(end),t=now.getTime();
  const duration=last.getTime()-first.getTime();
  if(duration<=0 || duration>3*3600000 || first.getTime()<t-10*60000 ||
    first.getTime()>t+7*86400000 || last.getTime()>t+7*86400000+3*3600000){
    throw new MobilityError('INVALID_TIME_WINDOW',400);
  }
  return {first,last,firstBucket:bucket(first)};
}
function rideRouteInput(ride,now=new Date()){
  const keys=['pickupCoordinates','destinationCoordinates','departureAt'];
  const included=keys.filter(key=>ride?.[key]!==undefined && ride[key]!==null);
  if(included.length===0)return null; // Old UI rides remain supported.
  if(included.length!==keys.length)throw new MobilityError('INCOMPLETE_ROUTE_GEO',400);
  const pickup=point(ride.pickupCoordinates),dropoff=point(ride.destinationCoordinates);
  const departure=strictTime(ride.departureAt);
  if(departure.getTime()<now.getTime()-10*60000 ||
    departure.getTime()>now.getTime()+7*86400000){
    throw new MobilityError('INVALID_TIME_WINDOW',400);
  }
  return {pickup,dropoff,departure,pickupCell:cell(pickup),
    dropoffCell:cell(dropoff),departureBucket:bucket(departure)};
}
function rank(match){
  // Bounded transparent heuristic. NOT a road ETA, walking route or
  // safety approval. Ranking happens after exact distance filtering.
  const pickupMeters=Number(match.pickup_m),dropoffMeters=Number(match.dropoff_m);
  const score=Math.max(0,Math.min(100,Math.round(100-(pickupMeters+dropoffMeters)/50)));
  return {
    rideId:match.ride_id,
    vehicle:match.vehicle,
    seatsLeft:Number(match.seats_left),
    studentFare:Number(match.student_fare),
    departureAt:(match.departure_at instanceof Date ? match.departure_at.toISOString():String(match.departure_at)),
    pickupDistanceMeters:Math.round(pickupMeters),
    dropoffDistanceMeters:Math.round(dropoffMeters),
    matchScore:score,
    candidateOnly:true,
    roadRouteVerificationRequired:true
  };
}
module.exports={MobilityError,point,cell,bucket,strictTime,windowTimes,rideRouteInput,rank};
