'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {point,cell,bucket,windowTimes,rideRouteInput,rank}=require('./stage1-otp/mobility-geo');
test('Reject invalid or missing coordinates before database writes',()=>{
  for(const invalid of [null,{},[],{lat:18,lon:null},{lat:NaN,lon:74},
    {lat:90,lon:20},{lat:18,lon:'74'}, {lat:18,lon:100}, {lat:18.5}]){
    assert.throws(()=>point(invalid),{code:'INVALID_COORDINATES'});
  }
  assert.deepEqual(point({lat:18.47,lon:74.02}),{lat:18.47,lon:74.02});
});
test('Grid and time bucket are deterministic and bounded',()=>{
  const a={lat:18.471,lon:74.021};
  assert.equal(cell(a),cell({lat:18.475,lon:74.029}));
  assert.notEqual(cell(a),cell({lat:18.495,lon:74.021}));
  assert.equal(bucket('2027-01-02T09:01:00+05:30'),bucket('2027-01-02T03:31:00Z'));
  assert.equal(bucket('2027-01-02T03:31:00Z'),bucket('2027-01-02T03:44:59Z'));
  assert.notEqual(bucket('2027-01-02T03:31:00Z'),bucket('2027-01-02T03:45:00Z'));
});
test('Intent windows require offsets and do not allow old or unbounded dates',()=>{
  const now=new Date('2027-01-02T03:00:00Z');
  const dates=windowTimes('2027-01-02T03:30:00Z','2027-01-02T05:30:00Z',now);
  assert.equal(dates.firstBucket,bucket(dates.first));
  for(const [start,end] of [
    ['2027-01-02T03:30','2027-01-02T04:00Z'],
    ['2027-01-02T02:00Z','2027-01-02T02:05Z'],
    ['2027-01-02T04:00Z','2027-01-02T03:00Z'],
    ['2027-01-02T04:00Z','2027-01-02T08:01Z'],
    ['2027-01-10T04:00Z','2027-01-10T05:00Z']
  ])assert.throws(()=>windowTimes(start,end,now));
});
test('Geo ride accepts all-or-none validated coordinates',()=>{
  const now=new Date('2027-01-02T03:00:00Z');
  assert.equal(rideRouteInput({vehicle:'Car'},now),null);
  assert.throws(()=>rideRouteInput({pickupCoordinates:{lat:18,lon:74}},now),
    {code:'INCOMPLETE_ROUTE_GEO'});
  const route=rideRouteInput({
    pickupCoordinates:{lat:18.48,lon:74.01},
    destinationCoordinates:{lat:18.46,lon:74.03},
    departureAt:'2027-01-02T04:00:00Z'
  },now);
  assert.equal(route.departureBucket,bucket(route.departure));
  assert.equal(typeof route.pickupCell,'string');
});
test('Ranking reveals no private coordinates, driver identity, or road ETA',()=>{
  const suggestion=rank({ride_id:'ride_123',vehicle:'Car',seats_left:2,
    student_fare:'50.00',departure_at:new Date('2027-01-02T04:00:00Z'),
    pickup_m:280.4,dropoff_m:810.2,driver_email:'private@example.test',
    driver_phone:'9876543210'});
  assert.equal(suggestion.candidateOnly,true);
  assert.equal(suggestion.roadRouteVerificationRequired,true);
  assert.equal(suggestion.driver_email,undefined);
  assert.equal(suggestion.driver_phone,undefined);
  assert.equal(suggestion.lat,undefined);
  assert.ok(suggestion.matchScore>=0 && suggestion.matchScore<=100);
});
