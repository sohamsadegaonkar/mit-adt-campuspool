'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {
  assertDisposableTarget,privateServerAddress,size,percentile,validateCandidate,random
}=require('./mobility-load');

const safe={
  BENCH_DISPOSABLE_DB:'YES',
  OTP_DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:5432/campuspool_mobility_bench'
};
test('benchmark refuses missing flag, non-loopback, wrong database and credentials',()=>{
  assert.equal(assertDisposableTarget(safe).hostname,'127.0.0.1');
  assert.throws(()=>assertDisposableTarget({...safe,BENCH_DISPOSABLE_DB:'NO'}),/DISPOSABLE/);
  assert.throws(()=>assertDisposableTarget({...safe,OTP_DATABASE_URL:''}));
  for(const bad of [
    'postgresql://postgres:synthetic@db.supabase.co:5432/campuspool_mobility_bench',
    'postgresql://postgres:synthetic@127.0.0.1:5432/postgres',
    'postgresql://admin:synthetic@127.0.0.1:5432/campuspool_mobility_bench',
    'postgresql://postgres:synthetic@127.0.0.1:443/campuspool_mobility_bench',
    'postgresql://postgres:synthetic@127.0.0.1:5432/campuspool_mobility_bench?sslmode=require',
    'https://postgres:synthetic@127.0.0.1:5432/campuspool_mobility_bench'
  ])assert.throws(()=>assertDisposableTarget({...safe,OTP_DATABASE_URL:bad}),bad);
});

test('private PostGIS Docker bridge addresses are allowed, public addresses rejected',()=>{
  for(const value of ['127.0.0.1','::1','172.18.0.2','10.11.12.13','192.168.1.20'])
    assert.equal(privateServerAddress(value),true,value);
  for(const value of ['8.8.8.8','192.0.2.1','172.32.0.1','localhost',null,''])
    assert.equal(privateServerAddress(value),false,String(value));
});

test('student count and connection sizes are bounded',()=>{
  assert.equal(size(undefined,128,100,256),128);
  assert.equal(size('128',128,100,256),128);
  for(const invalid of [-1,0,99,257,1.5,'NaN',Infinity]){
    assert.throws(()=>size(invalid,128,100,256));
  }
});

test('nearest-rank percentiles are deterministic, sorted and do not mutate inputs',()=>{
  const values=Array.from({length:100},(_,i)=>100-i);
  assert.equal(percentile(values,50),50);
  assert.equal(percentile(values,95),95);
  assert.equal(percentile(values,99),99);
  assert.equal(percentile(values,100),100);
  assert.equal(values[0],100);
  assert.equal(percentile([2.555],95),2.56);
  assert.throws(()=>percentile([],95));
  assert.throws(()=>percentile([1,NaN],50));
  assert.throws(()=>percentile([1,-2],50));
  assert.throws(()=>percentile([1],101));
});

test('candidate output strictly excludes raw geometry, driver contacts and passenger IDs',()=>{
  const candidate={
    rideId:'ride_d4fa22bc-9b63-4ee5-a772-5a3cf4d1bd32',
    vehicle:'Car',seatsLeft:2,studentFare:40,
    departureAt:new Date().toISOString(),pickupDistanceMeters:100,
    dropoffDistanceMeters:200,matchScore:95,candidateOnly:true,
    roadRouteVerificationRequired:true
  };
  const valid={matchingMode:'geometric_candidates',
    routeVerificationRequired:true,candidates:[candidate]};
  assert.doesNotThrow(()=>validateCandidate(valid));
  for(const leak of ['driverEmail','driverPhone','driverName','pickup','pickupCoordinates',
    'dropoffCoordinates','lat','lon','studentUserId']){
    assert.throws(()=>validateCandidate({
      ...valid,candidates:[{...candidate,[leak]:'DO_NOT_LEAK'}]
    }),leak);
  }
  assert.throws(()=>validateCandidate({...valid,candidates:[{...candidate,candidateOnly:false}]}));
  assert.throws(()=>validateCandidate({...valid,candidates:Array(11).fill(candidate)}));
  assert.throws(()=>validateCandidate({...valid,routeVerificationRequired:false}));
});

test('fixture randomness is reproducible across fresh generators',()=>{
  const a=random(4096),b=random(4096);
  assert.deepEqual(Array.from({length:30},()=>a()),Array.from({length:30},()=>b()));
});
