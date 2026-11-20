'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Database=require('better-sqlite3');
const CampusDb=require('../database');
async function runGps({t,pool,ids,tokens,basic,port,dbPath}){
  assert.equal(process.env.RIDES_HTTP_GPS_DISPOSABLE_DB,'YES');
  const uri=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(uri.hostname));
  assert.equal(uri.pathname,'/campuspool_stage1_ci');
  const base='http://127.0.0.1:'+port;
  const csrf=[];
  async function request(route,actor=0,body,extra={}){
    const headers={Authorization:basic,Cookie:'cp_session='+tokens[actor],...extra};
    if(body!==undefined)Object.assign(headers,{'Content-Type':'application/json','X-CSRF-Token':csrf[actor],'Idempotency-Key':crypto.randomUUID()});
    const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
  }
  for(let i=0;i<ids.length;i++){const r=await request('/api/auth/me',i);assert.equal(r.status,200);csrf.push(r.data.csrfToken);}
  const r=await request('/api/rides',0,{vehicle:'Car',vehicleModel:'CI car',pickup:'Gate',destination:'Station',departureTime:'2027-02-01T17:00:00',seatsTotal:2,uberBenchmark:100,studentFare:30,driverPayout:26});
  assert.equal(r.status,201);const rideId=r.data.ride.id;
  const book=await request('/api/bookings',1,{rideId});assert.equal(book.status,201);const bookingId=book.data.booking.bookingId;
  const driver='/api/rides/location',passenger='/api/bookings/passenger-location';
  const dr=driver+'?rideId='+rideId,pr=passenger+'?bookingId='+bookingId;
  const local=new Database(dbPath);local.pragma('busy_timeout=5000');
  const read=(route,actor)=>request(route,actor);
  const start=async(route,actor,fields)=>{const r=await request(route,actor,{...fields,action:'start'});assert.equal(r.status,200);assert.equal(r.data.ttlSeconds,60);assert.match(r.data.lease,/^[A-Za-z0-9_-]{43}$/);return r.data.lease;};
  const fix=(lease,capturedAt,lat=18.5)=>({rideId,action:'update',lease,lat,lng:73.9,accuracy:10,speed:0,heading:0,capturedAt});
  const row=()=>local.prepare('SELECT type,data,updated_at FROM live_locations WHERE id=?').get(rideId);
  let cases=0;
  try{
    assert.equal((await read(dr,1)).data.location,null);
    assert.equal((await request(driver,0,{rideId,lat:18.5,lng:73.9})).status,400);
    assert.equal((await request(driver,2,{rideId,action:'start'})).status,403);
    const lease=await start(driver,0,{rideId});cases++;
    assert.equal((await read(dr,1)).data.location,null);
    const captured=Date.now();
    const accepted=await request(driver,0,fix(lease,captured));assert.equal(accepted.status,200);cases++;
    assert.equal(accepted.data.location.expiresAt,captured+60000);
    assert.equal((await read(dr,1)).data.location.lat,18.5);
    assert.equal((await read(dr,1)).cache,'no-store');
    assert.equal((await read(dr,2)).status,403);
    assert.ok(!row().data.includes(lease));assert.ok(!row().data.includes(tokens[0]));
    const old=await request(driver,0,fix(lease,captured-1,18.6));assert.equal(old.status,409);assert.equal(old.data.error,'GPS_FIX_OUT_OF_ORDER');
    const duplicate=await request(driver,0,fix(lease,captured,18.7));assert.equal(duplicate.status,409);
    assert.equal((await read(dr,1)).data.location.lat,18.5);assert.equal(row().updated_at,captured);cases++;
    assert.equal((await request(driver,0,fix(lease,Date.now()-31000))).status,409);
    assert.equal((await request(driver,0,fix(lease,Date.now()+6000))).status,409);
    assert.equal((await request(driver,0,{...fix(lease,Date.now()),accuracy:-1})).status,400);cases++;
    // New valid session for same actor is not entitled to the existing lease.
    const other=crypto.randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO public.campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHash('sha256').update(other).digest('hex'),ids[0]]);
    const otherAuth=await fetch(base+'/api/auth/me',{headers:{Authorization:basic,Cookie:'cp_session='+other}});
    const otherCsrf=(await otherAuth.json()).csrfToken;
    const stolen=await fetch(base+driver,{method:'POST',headers:{Authorization:basic,Cookie:'cp_session='+other,'X-CSRF-Token':otherCsrf,'Content-Type':'application/json'},body:JSON.stringify(fix(lease,Date.now()+1))});
    assert.equal(stolen.status,409);cases++;
    const replacement=await start(driver,0,{rideId});
    assert.equal((await read(dr,1)).data.location,null);
    assert.equal((await request(driver,0,fix(lease,Date.now()))).status,409);
    assert.equal((await request(driver,0,{rideId,action:'stop',lease})).status,200);
    assert.equal((await request(driver,0,fix(replacement,Date.now()))).status,200);cases++;
    // Two independent SQLite handles observe the same state (no local cache).
    const worker=new CampusDb(dbPath);
    try{
      assert.equal(worker.getLiveLocation(rideId,'ride').lat,18.5);
      // Deterministic clock exercise on actual DB: no sleeping for 60 seconds.
      const at=row().updated_at;assert.equal(worker.getLiveLocation(rideId,'ride',at+60000),null);
      assert.equal(worker.pruneLiveLocations(at+60000),1);
      assert.equal(row(),undefined);
      assert.equal((await read(dr,1)).data.location,null);
      assert.equal((await request(driver,0,fix(replacement,Date.now()))).status,409);cases++;
    }finally{worker.db.close();}
    const next=await start(driver,0,{rideId});
    assert.equal((await request(driver,0,fix(next,Date.now()))).status,200);
    assert.equal((await request(driver,0,{rideId,action:'stop',lease:next})).status,200);
    assert.equal(row(),undefined);
    assert.equal((await read(dr,1)).data.location,null);
    assert.equal((await request(driver,0,fix(next,Date.now()+1))).status,409);cases++;
    local.prepare('INSERT INTO live_locations(id,type,data,updated_at) VALUES(?,?,?,?)').run(rideId,'ride',JSON.stringify({lat:18.77,lng:73.88,driverEmail:'synthetic@example.test'}),Date.now());
    assert.equal((await read(dr,1)).data.location,null);
    const finalLease=await start(driver,0,{rideId});
    assert.equal((await request(driver,0,fix(finalLease,Date.now()))).status,200);
    const pl=await start(passenger,1,{bookingId});
    assert.equal((await request(passenger,1,{bookingId,action:'update',lease:pl,lat:18.51,lng:73.91,accuracy:10,capturedAt:Date.now()})).status,200);
    assert.equal((await read(pr,0)).data.location.lat,18.51);
    assert.equal((await read(pr,2)).status,403);cases++;
    assert.equal((await request('/api/bookings/cancel',1,{bookingId})).status,200);
    assert.equal((await read(dr,1)).status,403);assert.equal((await read(pr,0)).status,403);
    assert.equal((await request(passenger,1,{bookingId,action:'start'})).status,403);cases++;
    assert.equal((await request('/api/rides/cancel',0,{rideId})).status,200);
    assert.equal((await read(dr,0)).status,403);assert.equal((await request(driver,0,fix(finalLease,Date.now()))).status,403);cases++;
    const remaining=local.prepare('SELECT count(*) AS n FROM live_locations').get().n;
    assert.equal(remaining,2,'Only latest row per resource, no history');
    t.diagnostic('CAMPUS_GPS_RESULT '+JSON.stringify({cases,ttlSeconds:60,pruneIntervalSeconds:30,sessionBound:true,oldFixRejected:true,stopPreventsResurrection:true,independentSqliteHandles:true,legacyHidden:true,cancellationDenied:true,latestRows:remaining}));
  }finally{local.close();}
}
module.exports={runGps};
