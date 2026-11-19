'use strict';
// Disposable-only, paced HTTP workload. No runtime instrumentation, external
// traffic or new dependencies. Source addresses are actual TCP loopback peers.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const os=require('node:os');
const {setTimeout:sleep}=require('node:timers/promises');
const {monitorEventLoopDelay}=require('node:perf_hooks');
const optIn=()=>{
  assert.equal(process.env.RIDES_HTTP_RUSH_DISPOSABLE_DB,'YES');
  const url=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/campuspool_stage1_ci');
  assert.equal(url.search+url.hash,'');
};
const percentile=(values,p)=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return Number(sorted[Math.ceil(sorted.length*p)-1].toFixed(2));
};
function installPoolProbe(){
  optIn();
  assert.equal(typeof process.send,'function');
  const {CampusPgPool}=require('../stage1-otp/pg-store');
  const original=CampusPgPool.prototype.connect;
  let waits=[],peakQueue=0,peakConnections=0,errors=0;
  let cpu=process.cpuUsage(),start=performance.now();
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();
  CampusPgPool.prototype.connect=function(callback){
    const began=performance.now();
    const record=err=>{waits.push(performance.now()-began);if(err)errors++;};
    const result=typeof callback==='function'
      ? original.call(this,(err,client,release)=>{record(err);callback(err,client,release);})
      : original.call(this).then(client=>{record(null);return client;},err=>{record(err);throw err;});
    peakQueue=Math.max(peakQueue,this.waitingCount);
    peakConnections=Math.max(peakConnections,this.totalCount);
    return result;
  };
  process.on('message',message=>{
    if(message?.type!=='rushSnapshot')return;
    const elapsed=performance.now()-start;
    const used=process.cpuUsage(cpu);
    process.send({type:'rushSnapshot',id:message.id,acquisitions:waits.length,acquisitionErrors:errors,
      acquireP50Ms:percentile(waits,.5),acquireP95Ms:percentile(waits,.95),acquireP99Ms:percentile(waits,.99),
      peakQueue,peakConnections,cpuCorePercent:Number(((used.user+used.system)/1000/elapsed*100).toFixed(2)),
      rssMiB:Number((process.memoryUsage().rss/1048576).toFixed(2)),eventLoopP99Ms:Number((loop.percentile(99)/1e6).toFixed(2))});
    waits=[];peakQueue=0;peakConnections=0;errors=0;cpu=process.cpuUsage();start=performance.now();loop.reset();
  });
}
async function runRushHour({t,child,pool,ids,tokens,basic,port,appName}){
  optIn();assert.equal(ids.length,96);
  const target=await pool.query('SELECT current_database() AS db');
  assert.equal(target.rows[0].db,'campuspool_stage1_ci');
  const agent=new http.Agent({keepAlive:true,maxSockets:8,maxTotalSockets:160});
  const actors=ids.map((id,i)=>({id,i,csrf:null,offers:[],booking:null,writing:false}));
  const drivers=actors.slice(0,16),passengers=actors.slice(16);
  const live=new Map(),successReceipts=new Map();
  let seq=0,driverIndex=0,passengerIndex=0,readIndex=0,probeSeq=0,snapshots=0,peakLocks=0;
  const actorHash=a=>crypto.createHash('sha256').update('campus-user:'+a.id).digest('hex');
  const delayUntil=async when=>{const ms=when-performance.now();if(ms>0)await sleep(ms);};
  function snapshotProbe(){
    return new Promise((resolve,reject)=>{
      const id=++probeSeq;
      const done=()=>{clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);};
      const onMessage=m=>{if(m?.type==='rushSnapshot'&&m.id===id){done();resolve(m);}};
      const onExit=()=>{done();reject(Error('Rush process exited'));};
      const timer=setTimeout(()=>{done();reject(Error('Rush probe timed out'));},4000);
      child.on('message',onMessage);child.once('exit',onExit);
      child.send({type:'rushSnapshot',id},err=>{if(err){done();reject(err);}});
    });
  }
  async function request(actor,route,{body,key,source}={}){
    const payload=body===undefined?null:JSON.stringify(body);
    const headers={Authorization:basic,Cookie:'cp_session='+tokens[actor.i]};
    if(payload!==null)Object.assign(headers,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),
      'X-CSRF-Token':actor.csrf,'Idempotency-Key':key});
    const started=performance.now();
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:route,method:payload===null?'GET':'POST',
        localAddress:source||'127.0.0.'+(actor.i+10),agent,headers,signal:AbortSignal.timeout(12000)},res=>{
        const chunks=[];
        res.on('data',buf=>chunks.push(buf));
        res.on('error',reject);
        res.on('end',()=>{
          try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString('utf8')),
            retryAfter:res.headers['retry-after'],ms:performance.now()-started,bytes:chunks.reduce((n,b)=>n+b.length,0)});}
          catch(err){reject(err);}
        });
      });
      req.on('error',reject);req.end(payload||undefined);
    });
  }
  const rideInput={vehicle:'Car',vehicleModel:'CI Rush Vehicle',pickup:'CI Campus Gate',destination:'CI Station',
    departureTime:'2027-02-01T17:00:00',seatsTotal:4,uberBenchmark:100,studentFare:30,driverPayout:26,note:'Synthetic rush hour'};
  function recordReceipt(a,route,key,res){
    assert.ok(!successReceipts.has(key));successReceipts.set(key,{actor_hash:actorHash(a),route:'POST '+route,response_status:res.status});
  }
  function addRide(a,id){a.offers.push(id);live.set(id,a);}
  function removeRide(a,id){a.offers=a.offers.filter(x=>x!==id);live.delete(id);}
  async function invariant(){
    const {rows}=await pool.query(`WITH rides AS (
      SELECT r.id,r.status,r.seats_total,r.seats_left,
        count(b.booking_id) FILTER(WHERE b.status='active') AS active,
        count(DISTINCT b.passenger_user_id) FILTER(WHERE b.status='active') AS distinct_active,
        count(b.booking_id) FILTER(WHERE (b.status='active' AND b.cancelled_at IS NOT NULL)
          OR (b.status='cancelled' AND b.cancelled_at IS NULL)) AS bad_cancel
      FROM public.campus_rides r LEFT JOIN public.campus_bookings b ON b.ride_id=r.id
      WHERE r.driver_user_id=ANY($1::uuid[]) GROUP BY r.id
    ), multi AS (
      SELECT passenger_user_id FROM public.campus_bookings WHERE passenger_user_id=ANY($1::uuid[])
        AND status='active' AND payment_status='Pending' GROUP BY passenger_user_id HAVING count(*)>1
    )
    SELECT count(*)::int AS rides,coalesce(sum(active),0)::int AS bookings,
      count(*) FILTER(WHERE seats_left+active<>seats_total OR seats_left<0 OR seats_left>seats_total
        OR active<>distinct_active OR bad_cancel<>0 OR (status='cancelled' AND active<>0))::int AS violations,
      (SELECT count(*)::int FROM multi) AS multi_unpaid FROM rides`,[ids]);
    const row=rows[0];snapshots++;
    assert.equal(row.violations,0,'Seat conservation/uniqueness/cancellation invariant');
    assert.equal(row.multi_unpaid,0,'Actor-level unpaid booking invariant');
    return row;
  }
  function selectOperation(){
    const kind=seq++%10;
    if(kind===0){
      const a=drivers[driverIndex++%drivers.length];
      if(!a.writing){
        const id=a.offers[0];
        return id&&((driverIndex%3)!==0||a.offers.length>=4)
          ? {a,route:'/api/rides/cancel',body:{rideId:id}}
          : {a,route:'/api/rides',body:rideInput};
      }
    }else if(kind<=3){
      const a=passengers[passengerIndex++%passengers.length];
      if(!a.writing){
        if(a.booking)return {a,route:'/api/bookings/cancel',body:{bookingId:a.booking}};
        const available=[...live.keys()];
        if(available.length){
          const id=available[(seq%3===0?seq%Math.min(3,available.length):seq*17%available.length)];
          return {a,route:'/api/bookings',body:{rideId:id}};
        }
      }
    }
    const a=actors[readIndex++%actors.length];
    return {a,route:kind===8?'/api/bookings':kind===9?'/api/user/settlement-status':'/api/rides'};
  }
  const expected={
    '/api/rides':new Set(['403:COMMISSION_SETTLEMENT_REQUIRED']),
    '/api/bookings':new Set(['403:SETTLEMENT_REQUIRED','404:RIDE_NOT_FOUND','409:RIDE_FULL','409:ALREADY_BOOKED']),
    '/api/bookings/cancel':new Set(['404:BOOKING_NOT_FOUND']),
    '/api/rides/cancel':new Set(['404:RIDE_NOT_FOUND'])
  };
  const reports=[];
  async function phase(name,seconds,rate){
    await snapshotProbe(); // reset phase counters after setup/drain
    const began=performance.now(),inFlight=new Set(),latencies=[],acceptedLatencies=[],generatorLag=[];
    const results={},routes={};let launched=0,dropped=0,peakInFlight=0,bytes=0,unexpected=0,sampleFailure=null;
    let sampling=false,activeSample=null;
    async function sample(){
      if(sampling)return;sampling=true;
      try{
        await invariant();
        const {rows}=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[appName]);
        peakLocks=Math.max(peakLocks,rows[0].n);
      }catch(err){sampleFailure=err;}finally{sampling=false;}
    }
    // A separate observer issues a consistent snapshot once per second.
    const timer=setInterval(()=>{if(!sampling)activeSample=sample();},1000);
    const bins=seconds*4,batch=rate/4;
    assert.equal(Number.isInteger(batch),true);
    function launch(){
      if(inFlight.size>=128){dropped++;return;}
      const op=selectOperation(),{a,route,body}=op;
      const write=body!==undefined,key=write?crypto.randomUUID():undefined;
      if(write)a.writing=true;
      launched++;
      const routeLabel=(write?'POST ':'GET ')+route;
      routes[routeLabel]=(routes[routeLabel]||0)+1;
      const work=(async()=>{
        try{
          const res=await request(a,route,{body,key});
          latencies.push(res.ms);bytes+=res.bytes;
          const label=res.status+':'+(res.data?.error||'OK');
          results[label]=(results[label]||0)+1;
          if(res.status===429){
            assert.ok(Number(res.retryAfter)>0);
            return;
          }
          if(res.status===503){
            assert.equal(res.data.error,'DB_POOL_BUSY');
            assert.ok(['2','3','4'].includes(res.retryAfter));
            return;
          }
          if(res.status>=200&&res.status<300){
            acceptedLatencies.push(res.ms);assert.equal(res.data.success,true);
            if(write){
              assert.equal(res.status,route==='/api/rides'||route==='/api/bookings'?201:200);
              recordReceipt(a,route,key,res);
              if(route==='/api/rides')addRide(a,res.data.ride.id);
              if(route==='/api/rides/cancel')removeRide(a,body.rideId);
              if(route==='/api/bookings')a.booking=res.data.booking.bookingId;
              if(route==='/api/bookings/cancel')a.booking=null;
            }else assert.equal(res.status,200);
          }else{
            assert.ok(write&&expected[route].has(label),'Unexpected HTTP '+label+' on '+routeLabel);
            if(route==='/api/bookings/cancel'&&res.status===404)a.booking=null;
            if(route==='/api/rides/cancel'&&res.status===404)removeRide(a,body.rideId);
            if(route==='/api/bookings'&&res.data.error==='RIDE_NOT_FOUND')live.delete(body.rideId);
          }
        }catch(err){unexpected++;if(unexpected<=3)t.diagnostic('RUSH_UNEXPECTED '+routeLabel+' '+(err.code||err.message));}
        finally{if(write)a.writing=false;}
      })();
      inFlight.add(work);peakInFlight=Math.max(peakInFlight,inFlight.size);
      void work.finally(()=>inFlight.delete(work));
    }
    try{
      for(let tick=0;tick<bins;tick++){
        const when=began+tick*250;
        await delayUntil(when);
        const late=performance.now()-when;generatorLag.push(late);
        // Missed arrivals are counted, never compressed into a catch-up burst.
        if(late>=250){dropped+=batch;continue;}
        for(let j=0;j<batch;j++)launch();
      }
      await delayUntil(began+seconds*1000);
      await Promise.all([...inFlight]);
    }finally{clearInterval(timer);if(activeSample)await activeSample;}
    if(sampleFailure)throw sampleFailure;
    const state=await invariant(),probe=await snapshotProbe();
    const elapsed=(performance.now()-began)/1000;
    const report={name,seconds,targetRps:rate,planned:bins*batch,launched,dropped,elapsedSec:Number(elapsed.toFixed(2)),
      completed:latencies.length,observedRps:Number((latencies.length/elapsed).toFixed(2)),results,routes,
      p50Ms:percentile(latencies,.5),p95Ms:percentile(latencies,.95),p99Ms:percentile(latencies,.99),
      acceptedP95Ms:percentile(acceptedLatencies,.95),peakInFlight,dispatchLagP95Ms:percentile(generatorLag,.95),
      responseMiB:Number((bytes/1048576).toFixed(2)),unexpected,activeState:state,
      pool:{acquisitions:probe.acquisitions,errors:probe.acquisitionErrors,p95AcquireMs:probe.acquireP95Ms,
        p99AcquireMs:probe.acquireP99Ms,peakQueue:probe.peakQueue,peakConnections:probe.peakConnections},
      cpuCorePercent:probe.cpuCorePercent,rssMiB:probe.rssMiB,eventLoopP99Ms:probe.eventLoopP99Ms};
    reports.push(report);t.diagnostic('CAMPUS_RUSH_PHASE '+JSON.stringify(report));
    assert.equal(unexpected,0);
    assert.equal(launched+dropped,bins*batch);
    assert.ok(dropped<=Math.ceil(bins*batch*.01),'Generator failed to deliver >99% of requested arrivals');
    assert.ok(probe.acquisitions>0);
    assert.ok(Object.keys(routes).some(r=>r.startsWith('POST')));
  }
  try{
    assert.equal(process.platform,'linux','Real alternate loopback source addresses require Linux CI');
    assert.equal((await request(actors[0],'/healthz')).status,200);
    // Keep sequential setup outside timed phases. Distinct verified actors and
    // stable TCP source per actor, not forged X-Forwarded-For or relaxed limits.
    for(const a of actors){
      const res=await request(a,'/api/auth/me');
      assert.equal(res.status,200);assert.equal(res.data.user.id,a.id);a.csrf=res.data.csrfToken;
    }
    for(const a of drivers){
      for(let i=0;i<2;i++){
        const key=crypto.randomUUID(),res=await request(a,'/api/rides',{body:rideInput,key});
        assert.equal(res.status,201);recordReceipt(a,'/api/rides',key,res);addRide(a,res.data.ride.id);
      }
    }
    await invariant();
    await phase('warmup',10,8);
    await phase('lecture-dismissal',15,40);
    await phase('rush-hour',20,160);
    // Same real source address for a different 130-read scenario (like campus
    // NAT), separate result: expect the unmodified 120/min bucket to reject 10.
    const nat={accepted:0,throttled:0,unexpected:0};
    for(let i=0;i<130;i++){
      const r=await request(actors[i%actors.length],'/api/rides',{source:'127.0.0.250'});
      if(r.status===200)nat.accepted++;
      else if(r.status===429){assert.ok(Number(r.retryAfter)>0);nat.throttled++;}
      else nat.unexpected++;
      await sleep(5);
    }
    assert.equal(nat.accepted,120);assert.equal(nat.throttled,10);assert.equal(nat.unexpected,0);
    const recovery=await Promise.all(actors.slice(0,8).map(a=>request(a,'/api/auth/me',{source:'127.0.0.251'})));
    assert.ok(recovery.every(r=>r.status===200));
    const {rows}=await pool.query('SELECT actor_hash,route,request_key,response_status FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',[actors.map(actorHash)]);
    assert.equal(rows.length,successReceipts.size,'Exactly one committed receipt per successful write; no rejected receipts');
    for(const row of rows){
      const exp=successReceipts.get(row.request_key);
      assert.ok(exp);assert.equal(row.actor_hash,exp.actor_hash);assert.equal(row.route,exp.route);assert.equal(Number(row.response_status),exp.response_status);
    }
    const final=await invariant();
    t.diagnostic('CAMPUS_RUSH_RESULT '+JSON.stringify({actors:actors.length,drivers:drivers.length,seedRides:32,
      phases:reports.length,planned:reports.reduce((n,p)=>n+p.planned,0),launched:reports.reduce((n,p)=>n+p.launched,0),
      completed:reports.reduce((n,p)=>n+p.completed,0),dropped:reports.reduce((n,p)=>n+p.dropped,0),
      unexpected:reports.reduce((n,p)=>n+p.unexpected,0),snapshots,peakSampledDbLockWaiters:peakLocks,
      receiptsVerified:rows.length,nat,recovery:recovery.length,final,cpuCount:os.availableParallelism(),node:process.version}));
  }finally{agent.destroy();}
}
module.exports={installPoolProbe,runRushHour};
