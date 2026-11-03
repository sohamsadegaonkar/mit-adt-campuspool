'use strict';
// End-to-end HTTP contract for opt-in PostgreSQL Rides using a disposable local DB.
// Never run against Render, Supabase, or a database with real student records.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {Pool}=require('pg');
const {migrate}=require('./stage1-otp/migrate');

const url=process.env.OTP_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)){
  throw Error('Refusing to run HTTP Rides tests against a nonlocal PostgreSQL database');
}
function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const p=server.address().port;
      server.close(()=>resolve(p));
    });
  });
}
function waitForServer(child){
  return new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(Error('Server startup timed out: '+output.slice(-500))),22000);
    const onData=chunk=>{
      output+=String(chunk).slice(0,1000);
      if(output.includes('active on port')){
        clearTimeout(timer);child.stdout.off('data',onData);resolve();
      }
    };
    child.stdout.on('data',onData);
    child.stderr.on('data',chunk=>{output+=String(chunk).slice(0,600)});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+': '+output.slice(-600)))});
  });
}
test('HTTP rides and bookings switch to verified PostgreSQL user identities',
 {skip:!url?'requires local isolated CI PostgreSQL':false},async()=>{
  await migrate({connectionString:url,ssl:false});
  const pool=new Pool({connectionString:url,ssl:false});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-rides-http-'));
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  const email=i=>'rides-http-'+crypto.randomBytes(6).toString('hex')+'@students.mituniversity.edu.in';
  const emails=[email(0),email(1)];
  const phones=['9765412380','9765412381'];
  const tokens=ids.map(()=>crypto.randomBytes(32).toString('base64url'));
  const pass='ci-private-'+crypto.randomBytes(32).toString('hex');
  const basic='Basic '+Buffer.from('staging:'+pass).toString('base64');
  const port=await freePort();
  let child,rideId,bookingId;
  const base='http://127.0.0.1:'+port;
  async function request(endpoint,{method='GET',user=0,body,csrf,anonymous=false,idempotencyKey}={}){
    const headers={Authorization:basic};
    if(!anonymous)headers.Cookie='cp_session='+tokens[user];
    if(body!==undefined)headers['Content-Type']='application/json';
    if(csrf)headers['x-csrf-token']=csrf;
    if(method==='POST' && ['/api/rides','/api/bookings','/api/rides/cancel','/api/bookings/cancel'].includes(endpoint))
      headers['Idempotency-Key']=idempotencyKey||crypto.randomUUID();
    const response=await fetch(base+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    let json;try{json=await response.json();}catch{json=null;}
    return {status:response.status,body:json,replayed:response.headers.get('Idempotency-Replayed')};
  }
  try{
    await pool.query([
      'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified)',
      'VALUES ($1,$2,$3,$4,$5,true),($6,$7,$8,$9,$10,true)'
    ].join(' '),[ids[0],'CI Driver',emails[0],phones[0],'Testing',
      ids[1],'CI Passenger',emails[1],phones[1],'Testing']);
    for(let i=0;i<2;i++){
      const hash=crypto.createHash('sha256').update(tokens[i]).digest('hex');
      await pool.query(
        "INSERT INTO public.campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [hash,ids[i]]);
    }
    child=spawn(process.execPath,['server.js'],{cwd:__dirname,
      env:{...process.env,PORT:String(port),NODE_ENV:'production',APP_ENV:'staging',
        STAGING_BASIC_AUTH_PASSWORD:pass,AUTH_OTP_BACKEND:'postgres',RIDES_BACKEND:'postgres',
        OTP_DB_SSL:'false',OTP_HMAC_KEY:'ci-only-'+crypto.randomBytes(32).toString('hex'),
        OTP_SECRET:crypto.randomBytes(32).toString('hex'),ENABLE_CLUSTER:'false',
        DATABASE_PATH:path.join(temp,'ephemeral.db'),
        EMAIL_PROVIDER:'disabled',SMS_PROVIDER:'disabled'
      },stdio:['ignore','pipe','pipe']});
    await waitForServer(child);
    const ready=await request('/healthz',{anonymous:true});
    assert.equal(ready.status,200);
    const blocked=await fetch(base+'/api/rides',{headers:{}});
    assert.equal(blocked.status,401);
    const driver=await request('/api/auth/me',{user:0});
    const passenger=await request('/api/auth/me',{user:1});
    assert.equal(driver.status,200);assert.equal(passenger.status,200);
    assert.equal(driver.body.user.email,emails[0]);
    assert.equal(passenger.body.user.email,emails[1]);
    const csrfDriver=driver.body.csrfToken,csrfPassenger=passenger.body.csrfToken;
    const rideInput={vehicle:'Car',vehicleModel:'CI Vehicle',pickup:'CI Pickup',
      destination:'CI Destination',departureTime:'2027-02-01T09:00:00',
      seatsTotal:1,uberBenchmark:100,studentFare:30,driverPayout:26,
      driverEmail:emails[1],driverName:'Spoofed',note:'HTTP CI only'};
    const noCsrf=await request('/api/rides',{method:'POST',user:0,body:rideInput});
    assert.equal(noCsrf.status,403);
    const spoof=await request('/api/rides',{method:'POST',user:0,body:rideInput,csrf:csrfDriver});
    assert.equal(spoof.status,403,'The HTTP boundary rejects spoofed driver emails');
    const cleanInput={...rideInput};
    delete cleanInput.driverEmail;
    delete cleanInput.driverName;
    const rideKey=crypto.randomUUID();
    const created=await request('/api/rides',{method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(created.status,201,JSON.stringify(created.body));
    rideId=created.body.ride.id;
    const rideReplay=await request('/api/rides',{method:'POST',user:0,body:cleanInput,csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(rideReplay.status,201);
    assert.equal(rideReplay.body.ride.id,rideId);
    assert.equal(rideReplay.replayed,'true');
    const collision=await request('/api/rides',{method:'POST',user:0,body:{...cleanInput,note:'Changed'},csrf:csrfDriver,idempotencyKey:rideKey});
    assert.equal(collision.status,409);
    assert.equal(collision.body.error,'IDEMPOTENCY_KEY_REUSED');
    assert.equal(created.body.ride.driverEmail,emails[0]);
    const visible=await request('/api/rides',{user:1});
    assert.equal(visible.status,200);
    assert.equal(visible.body.rides.some(r=>r.id===rideId),true);
    const cannotBookSelf=await request('/api/bookings',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId}});
    assert.equal(cannotBookSelf.status,403,JSON.stringify(cannotBookSelf.body));
    const bookKey=crypto.randomUUID();
    const seat=await request('/api/bookings',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId,passengerEmail:emails[1]},idempotencyKey:bookKey});
    assert.equal(seat.status,201,JSON.stringify(seat.body));
    bookingId=seat.body.booking.bookingId;
    // Previously a replay failed the unpaid-booking guard. It must now
    // return the original booking without consuming a second seat.
    const seatReplay=await request('/api/bookings',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId,passengerEmail:emails[1]},idempotencyKey:bookKey});
    assert.equal(seatReplay.status,201);
    assert.equal(seatReplay.body.booking.bookingId,bookingId);
    assert.equal(seatReplay.replayed,'true');
    const booked=await request('/api/rides',{user:0});
    assert.equal(booked.body.rides.find(r=>r.id===rideId).seatsLeft,0);
    const wrongCancel=await request('/api/bookings/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{bookingId}});
    assert.equal(wrongCancel.status,403);
    const cancelKey=crypto.randomUUID();
    const cancelled=await request('/api/bookings/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{bookingId},idempotencyKey:cancelKey});
    assert.equal(cancelled.status,200);
    const cancelReplay=await request('/api/bookings/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{bookingId},idempotencyKey:cancelKey});
    assert.equal(cancelReplay.status,200);
    assert.equal(cancelReplay.replayed,'true');
    const restored=await request('/api/rides',{user:1});
    assert.equal(restored.body.rides.find(r=>r.id===rideId).seatsLeft,1);
    const wrongRide=await request('/api/rides/cancel',{method:'POST',user:1,
      csrf:csrfPassenger,body:{rideId}});
    assert.equal(wrongRide.status,403);
    const cancelRideKey=crypto.randomUUID();
    const cancelRide=await request('/api/rides/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId},idempotencyKey:cancelRideKey});
    assert.equal(cancelRide.status,200);
    const rideCancelReplay=await request('/api/rides/cancel',{method:'POST',user:0,
      csrf:csrfDriver,body:{rideId},idempotencyKey:cancelRideKey});
    assert.equal(rideCancelReplay.status,200);
    assert.equal(rideCancelReplay.replayed,'true');
    const empty=await request('/api/my-rides',{user:0});
    assert.equal(empty.status,200);
    assert.deepEqual(empty.body.rides,[]);
  }finally{
    if(child){
      child.kill('SIGTERM');
      await new Promise(resolve=>{
        if(child.exitCode!==null||child.signalCode!==null)return resolve();
        const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);
        child.once('exit',()=>{clearTimeout(timer);resolve()});
      });
    }
    if(rideId){
      await pool.query('DELETE FROM public.campus_bookings WHERE ride_id=$1',[rideId]);
      await pool.query('DELETE FROM public.campus_rides WHERE id=$1',[rideId]);
    }
    await pool.query('DELETE FROM public.campus_sessions WHERE user_id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',
      [ids.map(id=>crypto.createHash('sha256').update('campus-user:'+id.toLowerCase()).digest('hex'))]);
    await pool.end();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
