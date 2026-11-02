'use strict';
// Disposable-local-PostGIS HTTP contract: no Render or live student data.
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

const connectionString=process.env.OTP_DATABASE_URL;
if(connectionString&&!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))
  throw Error('Refusing to run mobility HTTP tests on a remote database');
const future=ms=>new Date(Date.now()+ms).toISOString();
const id=()=>crypto.randomUUID();
function freePort(){
  return new Promise((resolve,reject)=>{
    const s=net.createServer();
    s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
}
function waitReady(child){
  return new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(Error('Startup timeout: '+output.slice(-500))),22000);
    const onData=b=>{
      output+=String(b).slice(0,900);
      if(output.includes('active on port')){
        clearTimeout(timer);child.stdout.off('data',onData);resolve();
      }
    };
    child.stdout.on('data',onData);
    child.stderr.on('data',b=>{output+=String(b).slice(0,700)});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Startup failure '+code+' '+output.slice(-500)))});
  });
}
test('Mobility API: verified intent, CSRF, private matches and cancellation',
  {skip:!connectionString?'isolated PostGIS database required':false},async()=>{
    await migrate({connectionString,ssl:false});
    const pool=new Pool({connectionString,ssl:false});
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-mobility-http-'));
    const users=[id(),id(),id()];
    const emails=users.map(()=> 'mob-http-'+crypto.randomBytes(6).toString('hex')+'@students.mituniversity.edu.in');
    const tokens=users.map(()=>crypto.randomBytes(32).toString('base64url'));
    const pass='ci-only-'+crypto.randomBytes(32).toString('hex');
    const basic='Basic '+Buffer.from('staging:'+pass).toString('base64');
    const port=await freePort();
    const base='http://127.0.0.1:'+port;
    let child,rideId;
    async function request(route,{method='GET',user=0,body,csrf,anonymous=false}={}){
      const headers={Authorization:basic};
      if(!anonymous)headers.Cookie='cp_session='+tokens[user];
      if(csrf)headers['x-csrf-token']=csrf;
      if(body!==undefined)headers['Content-Type']='application/json';
      const res=await fetch(base+route,{method,headers,
        body:body===undefined?undefined:JSON.stringify(body)});
      let data=null;
      try{data=await res.json()}catch{}
      return {status:res.status,data};
    }
    try{
      const values=users.flatMap((u,i)=>[u,'Mobility Student '+i,emails[i],
        '987651234'+i,'Testing']);
      await pool.query([
        'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified)',
        'VALUES ($1,$2,$3,$4,$5,true),($6,$7,$8,$9,$10,true),($11,$12,$13,$14,$15,true)'
      ].join(' '),values);
      for(let i=0;i<users.length;i++){
        await pool.query(
          "INSERT INTO public.campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '2 hours')",
          [crypto.createHash('sha256').update(tokens[i]).digest('hex'),users[i]]);
      }
      child=spawn(process.execPath,['server.js'],{cwd:__dirname,
        env:{...process.env,PORT:String(port),NODE_ENV:'production',APP_ENV:'staging',
          STAGING_BASIC_AUTH_PASSWORD:pass,AUTH_OTP_BACKEND:'postgres',RIDES_BACKEND:'postgres',
          MOBILITY_MATCHING_ENABLED:'true',OTP_DB_SSL:'false',
          OTP_HMAC_KEY:'ci-only-'+crypto.randomBytes(32).toString('hex'),
          OTP_SECRET:crypto.randomBytes(32).toString('hex'),ENABLE_CLUSTER:'false',
          DATABASE_PATH:path.join(temp,'test.db'),EMAIL_PROVIDER:'disabled',SMS_PROVIDER:'disabled'
        },stdio:['ignore','pipe','pipe']});
      await waitReady(child);
      assert.equal((await fetch(base+'/api/mobility/intent')).status,401);
      const me=await Promise.all(users.map((_,i)=>request('/api/auth/me',{user:i})));
      for(const m of me)assert.equal(m.status,200);
      const [csrfDriver,csrfRider]=me.map(m=>m.data.csrfToken);
      const depart=future(24*3600000);
      const origin={lat:18.5103,lon:73.9232};
      const dest={lat:18.4652,lon:74.0181};
      const rideBody={
        vehicle:'Car',vehicleModel:'Mobility Test Car',pickup:'CI Origin',
        destination:'CI Destination',departureTime:depart,seatsTotal:2,
        studentFare:40,driverPayout:35,uberBenchmark:100,
        pickupCoordinates:origin,destinationCoordinates:dest,departureAt:depart
      };
      const ride=await request('/api/rides',{method:'POST',user:0,
        csrf:csrfDriver,body:rideBody});
      assert.equal(ride.status,201,JSON.stringify(ride.data));
      rideId=ride.data.ride.id;
      assert.equal((await request('/api/mobility/intent',{user:1})).data.intent,null);
      const intentBody={pickup:{lat:18.512,lon:73.925},dropoff:{lat:18.467,lon:74.019},
        earliestDeparture:future(23*3600000),latestDeparture:future(25*3600000)};
      const blocked=await request('/api/mobility/intents',{method:'POST',user:1,body:intentBody});
      assert.equal(blocked.status,403);
      const created=await request('/api/mobility/intents',{method:'POST',user:1,
        csrf:csrfRider,body:intentBody});
      assert.equal(created.status,201,JSON.stringify(created.data));
      const intentId=created.data.intent.intentId;
      const duplicate=await request('/api/mobility/intents',{method:'POST',user:1,
        csrf:csrfRider,body:intentBody});
      assert.equal(duplicate.status,409);
      const other=await request('/api/mobility/matches?intentId='+intentId,{user:2});
      assert.equal(other.status,404);
      const matches=await request('/api/mobility/matches?intentId='+intentId,{user:1});
      assert.equal(matches.status,200,JSON.stringify(matches.data));
      assert.equal(matches.data.candidates.length,1);
      assert.equal(matches.data.candidates[0].rideId,rideId);
      assert.equal(matches.data.candidates[0].candidateOnly,true);
      for(const privateKey of ['driverEmail','driverPhone','driverName','lat','lon','pickupCoordinates']){
        assert.equal(matches.data.candidates[0][privateKey],undefined);
      }
      const otherCancel=await request('/api/mobility/intents/cancel',{method:'POST',
        user:2,csrf:me[2].data.csrfToken,body:{intentId}});
      assert.equal(otherCancel.status,404);
      const cancel=await request('/api/mobility/intents/cancel',{method:'POST',
        user:1,csrf:csrfRider,body:{intentId}});
      assert.equal(cancel.status,200);
      assert.equal((await request('/api/mobility/intent',{user:1})).data.intent,null);
      assert.equal((await request('/api/mobility/matches?intentId='+intentId,{user:1})).status,404);
    }finally{
      if(child){
        child.kill('SIGTERM');
        await new Promise(resolve=>{
          if(child.exitCode!==null||child.signalCode!==null)return resolve();
          const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);
          child.once('exit',()=>{clearTimeout(timer);resolve()});
        });
      }
      await pool.query('DELETE FROM public.campus_trip_intents WHERE student_user_id=ANY($1::uuid[])',[users]);
      if(rideId){
        await pool.query('DELETE FROM public.campus_ride_geo WHERE ride_id=$1',[rideId]);
        await pool.query('DELETE FROM public.campus_rides WHERE id=$1',[rideId]);
      }
      await pool.query('DELETE FROM public.campus_sessions WHERE user_id=ANY($1::uuid[])',[users]);
      await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[users]);
      await pool.end();
      fs.rmSync(temp,{recursive:true,force:true});
    }
  });
