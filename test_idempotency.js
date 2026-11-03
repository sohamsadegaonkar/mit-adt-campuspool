'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const SQLiteCampusDatabase=require('./database');
const {SqliteIdempotencyStore,IdempotencyError}=require('./idempotency');

test('SQLite: atomic keyed writes, canonical replay, conflicts, rollback and seats',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-idem-'));
  const dbPath=path.join(dir,'idempotency.db');
  let storeDb;
  try{
    storeDb=new SQLiteCampusDatabase(dbPath);
    const idem=new SqliteIdempotencyStore(storeDb.db);
    const driver='idem-driver@students.mituniversity.edu.in';
    const rider='idem-rider@students.mituniversity.edu.in';
    storeDb.createProfile({name:'Idempotency Driver',email:driver,phone:'9865432180',dept:'Test'});
    storeDb.createProfile({name:'Idempotency Rider',email:rider,phone:'9865432181',dept:'Test'});
    const ride={
      driverName:'Idempotency Driver',driverEmail:driver,driverPhone:'9865432180',
      dept:'Test',vehicle:'Car',vehicleModel:'Test',pickup:'Campus',
      destination:'Station',departureTime:'2027-03-01T09:00:00',seatsTotal:1,
      uberBenchmark:90,studentFare:30,driverPayout:25,note:''
    };
    const createKey=crypto.randomUUID();
    const payload={vehicle:'Car',pickup:'Campus'};
    const args={actor:driver,route:'POST /api/rides',key:createKey,body:payload};
    const created=idem.run({...args,execute:()=>({status:201,body:{
      success:true,ride:storeDb.createRide(ride)
    }})});
    assert.equal(created.status,201);
    assert.equal(created.replayed,false);
    const rideId=created.body.ride.id;
    const replay=idem.run({...args,body:{pickup:'Campus',vehicle:'Car'},
      execute:()=>{throw Error('replay must never execute');}});
    assert.equal(replay.replayed,true);
    assert.deepEqual(replay.body,created.body);
    const prior = idem.findCompleted(args);
    assert.equal(prior.replayed,true);
    assert.deepEqual(prior.body,created.body);
    assert.equal(idem.findCompleted({...args,key:crypto.randomUUID()}),null);
    assert.equal(idem.findCompleted({...args,actor:rider}),null);
    assert.throws(()=>idem.findCompleted({...args,body:{vehicle:'Bike'}}),
      e=>e instanceof IdempotencyError&&e.code==='IDEMPOTENCY_KEY_REUSED');
    assert.equal(storeDb.getRides().filter(x=>x.id===rideId).length,1);
    assert.throws(()=>idem.run({...args,body:{pickup:'Other',vehicle:'Car'},execute:()=>({status:201,body:{}})}),
      e=>e instanceof IdempotencyError&&e.code==='IDEMPOTENCY_KEY_REUSED');
    assert.throws(()=>idem.run({...args,key:'weak',execute:()=>({status:200,body:{}})}),
      e=>e instanceof IdempotencyError&&e.code==='INVALID_IDEMPOTENCY_KEY');
    assert.throws(()=>idem.run({...args,key:undefined,execute:()=>({status:200,body:{}})}),
      e=>e instanceof IdempotencyError&&e.code==='IDEMPOTENCY_KEY_REQUIRED');

    const rollbackKey=crypto.randomUUID();
    const before=storeDb.getRides().length;
    assert.throws(()=>idem.run({...args,key:rollbackKey,execute:()=>{
      storeDb.createRide({...ride,note:'Rollback'});
      throw Error('Simulated server failure');
    }}),/Simulated server failure/);
    assert.equal(storeDb.getRides().length,before);
    assert.equal(storeDb.db.prepare('SELECT count(*) AS total FROM idempotency_keys WHERE request_key=?').get(rollbackKey).total,0);

    const bookingKey=crypto.randomUUID();
    const bookArgs={actor:rider,route:'POST /api/bookings',key:bookingKey,body:{rideId}};
    const booked=idem.run({...bookArgs,execute:()=>({status:201,body:{
      success:true,booking:storeDb.bookRide({rideId,passengerEmail:rider,passengerName:'Idempotency Rider'})
    }})});
    const bookingId=booked.body.booking.bookingId;
    const bookedReplay=idem.run({...bookArgs,execute:()=>{throw Error('duplicate booking effect');}});
    assert.equal(bookedReplay.body.booking.bookingId,bookingId);
    assert.equal(bookedReplay.replayed,true);
    assert.equal(storeDb.getRides().find(x=>x.id===rideId).seatsLeft,0);
    const cancelArgs={actor:rider,route:'POST /api/bookings/cancel',
      key:crypto.randomUUID(),body:{bookingId}};
    const cancel=idem.run({...cancelArgs,execute:()=>({status:200,body:{
      success:true,...storeDb.cancelBooking(bookingId,rider)
    }})});
    const cancelReplay=idem.run({...cancelArgs,execute:()=>{throw Error('double cancellation');}});
    assert.equal(cancel.status,200);
    assert.deepEqual(cancelReplay.body,cancel.body);
    assert.equal(storeDb.getRides().find(x=>x.id===rideId).seatsLeft,1);
    const otherUserKey=idem.run({...args,actor:rider,execute:()=>({status:200,body:{success:true}})});
    assert.equal(otherUserKey.replayed,false,'User scopes are isolated');
  }finally{
    try{storeDb?.db.close()}catch(_){}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('SQLite idempotency keys expire and may be replaced',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-idem-expire-'));
  const db=new SQLiteCampusDatabase(path.join(dir,'data.db'));
  try{
    const idem=new SqliteIdempotencyStore(db.db);
    const args={actor:'expire-user',route:'POST /api/rides',key:crypto.randomUUID(),body:{x:1}};
    const initial=idem.run({...args,execute:()=>({status:201,body:{value:1}})});
    assert.equal(initial.body.value,1);
    db.db.prepare('UPDATE idempotency_keys SET expires_at=? WHERE request_key=?').run(Date.now()-1,args.key);
    assert.equal(idem.findCompleted(args),null,'Expired receipts are never replayed');
    const later=idem.run({...args,execute:()=>({status:201,body:{value:2}})});
    assert.equal(later.body.value,2);
    assert.equal(later.replayed,false);
  }finally{db.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
