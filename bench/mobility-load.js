'use strict';
/*
 * Disposable DB-layer PostGIS benchmark, not an HTTP benchmark or production SLA.
 * Synthetic inputs only. Never connect this script to Supabase/Render.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {Pool}=require('pg');
const {PgMobilityStore}=require('../stage1-otp/mobility-store');
const {PgOtpStore}=require('../stage1-otp/pg-store');
const {cell,bucket}=require('../stage1-otp/mobility-geo');

const CANDIDATE_FIELDS=new Set([
  'rideId','vehicle','seatsLeft','studentFare','departureAt',
  'pickupDistanceMeters','dropoffDistanceMeters','matchScore',
  'candidateOnly','roadRouteVerificationRequired'
]);

function assertDisposableTarget(env=process.env){
  if(env.BENCH_DISPOSABLE_DB!=='YES')throw Error('DISPOSABLE_BENCH_FLAG_REQUIRED');
  let parsed;
  try{parsed=new URL(env.OTP_DATABASE_URL||'');}
  catch(_){throw Error('INVALID_BENCH_DATABASE_URL');}
  if(!['postgresql:','postgres:'].includes(parsed.protocol) ||
     !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) ||
     !['','5432'].includes(parsed.port) ||
     parsed.pathname!=='/campuspool_mobility_bench' ||
     parsed.username!=='postgres' || parsed.search || parsed.hash)
    throw Error('REFUSE_NON_DISPOSABLE_DATABASE');
  return parsed;
}
function privateServerAddress(addr){
  // GitHub's Docker port forwarding makes the PostgreSQL server's own
  // listening address a container bridge IP, even for a loopback-only client.
  if(typeof addr!=='string')return false;
  if(addr==='::1'||addr==='127.0.0.1')return true;
  const ipv4=addr.startsWith('::ffff:')?addr.slice(7):addr;
  const parts=ipv4.split('.').map(Number);
  if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  return parts[0]===10 || (parts[0]===172&&parts[1]>=16&&parts[1]<=31) ||
    (parts[0]===192&&parts[1]===168) || parts[0]===127;
}
function size(value,fallback,min,max){
  const n=value===undefined?fallback:Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('INVALID_BENCHMARK_SIZE');
  return n;
}
function percentile(values,p){
  if(!Array.isArray(values)||values.length===0||!Number.isFinite(p)||p<0||p>100)
    throw Error('INVALID_PERCENTILE');
  const sorted=values.slice().sort((a,b)=>a-b);
  if(!sorted.every(n=>Number.isFinite(n)&&n>=0))throw Error('INVALID_LATENCY');
  // Nearest rank, explicitly documented (not interpolated).
  return Math.round(sorted[Math.max(0,Math.ceil(p/100*sorted.length)-1)]*100)/100;
}
function validateCandidate(response){
  if(!response || response.matchingMode!=='geometric_candidates' ||
     response.routeVerificationRequired!==true ||
     !Array.isArray(response.candidates)||response.candidates.length>10)
    throw Error('INVALID_PRIVATE_MATCH_RESPONSE');
  for(const candidate of response.candidates){
    if(!candidate || candidate.candidateOnly!==true ||
       candidate.roadRouteVerificationRequired!==true ||
       !/^ride_[0-9a-f-]{36}$/i.test(candidate.rideId||'') ||
       Object.keys(candidate).some(key=>!CANDIDATE_FIELDS.has(key)))
      throw Error('PRIVATE_MATCH_RESPONSE_FIELD_VIOLATION');
  }
}
function random(seed){
  let s=seed>>>0;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
const point=(lat,lon)=>({lat,lon});
const locate=(base,delta)=>point(
  Math.round((base.lat+delta.lat)*1e6)/1e6,
  Math.round((base.lon+delta.lon)*1e6)/1e6
);
const ID=()=>crypto.randomUUID();
const rideId=()=> 'ride_'+ID();
const formatNum=n=>Math.round(n*100)/100;
const nowIso=(base,milliseconds)=>new Date(base+milliseconds).toISOString();

async function ensureEmpty(pool){
  const p=await pool.query(
    'SELECT current_database() AS db,current_user AS usr,inet_server_addr()::text AS addr'
  );
  const x=p.rows[0]||{};
  if(x.db!=='campuspool_mobility_bench'||x.usr!=='postgres'||
     !privateServerAddress(x.addr))
    throw Error('UNEXPECTED_DATABASE_IDENTITY');
  const c=await pool.query([
    'SELECT',
    '(SELECT count(*)::int FROM public.campus_users) AS users,',
    '(SELECT count(*)::int FROM public.campus_rides) AS rides,',
    '(SELECT count(*)::int FROM public.campus_trip_intents) AS intents,',
    '(SELECT count(*)::int FROM public.campus_ride_geo) AS routes'
  ].join(' '));
  if(Object.values(c.rows[0]).some(value=>value!==0))
    throw Error('BENCH_DATABASE_MUST_START_EMPTY');
  const idx=await pool.query([
    'SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename=$2',
    'AND indexname=ANY($3::text[]) ORDER BY indexname'
  ].join(' '),['public','campus_ride_geo',[
    'campus_ride_geo_pickup_gist_idx','campus_ride_geo_dropoff_gist_idx'
  ]]);
  if(idx.rowCount!==2)throw Error('POSTGIS_INDEXES_NOT_READY');
}

async function seed(pool,students,rides,onFixture){
  const nonce=crypto.randomBytes(5).toString('hex');
  const rand=random(4096);
  const driverCount=24;
  const users=Array.from({length:students+driverCount},()=>ID());
  const drivers=users.slice(0,driverCount);
  const passengers=users.slice(driverCount);
  const allRideIds=Array.from({length:rides},rideId);
  const intentIds=Array.from({length:students},ID);
  const base=Date.now();
  const dep=nowIso(base,24*3600000);
  const earliest=nowIso(base,23*3600000);
  const latest=nowIso(base,25*3600000);
  const origin=point(18.5103,73.9232),dest=point(18.4652,74.0181);
  const fixtures={users,allRideIds,intentIds,passengers};
  // Publish owned IDs before any INSERT so failures can still clean up.
  onFixture(fixtures);
  // No truncate, schema writes or real identity reuse. All IDs belong to this run.
  for(let i=0;i<users.length;i++){
    await pool.query([
      'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified)',
      'VALUES($1,$2,$3,$4,$5,true)'
    ].join(' '),[users[i],'Benchmark Synthetic '+(i+1),
      'benchmark-'+nonce+'-'+i+'@students.mituniversity.edu.in',
      '9'+String(100000000+i),'Synthetic QA']);
  }
  for(let i=0;i<rides;i++){
    const d=drivers[i%driverCount],id=allRideIds[i];
    const nearby=i%5!==0; // 20% deliberately distant, 80% concentrated.
    const wiggle=nearby?0.008:0.04;
    const a=locate(origin,{lat:(rand()-.5)*2*wiggle,lon:(rand()-.5)*2*wiggle});
    const b=locate(dest,{lat:(rand()-.5)*2*wiggle,lon:(rand()-.5)*2*wiggle});
    const drv=i%driverCount;
    await pool.query([
      'INSERT INTO public.campus_rides',
      '(id,driver_user_id,driver_name,driver_email,driver_phone,',
      'vehicle,vehicle_model,pickup,destination,departure_time,seats_total,',
      'seats_left,uber_benchmark,student_fare,driver_payout,note)',
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)'
    ].join(' '),[id,d,'Synthetic Driver',
      'benchmark-'+nonce+'-'+drv+'@students.mituniversity.edu.in',
      '9'+String(100000000+drv),'Car','CI Car','Synthetic Gate','Synthetic Station',
      dep,2,2,100,40,35,'Synthetic only']);
    await pool.query([
      'INSERT INTO public.campus_ride_geo',
      '(ride_id,pickup_geo,dropoff_geo,departure_at,pickup_cell,dropoff_cell,departure_bucket)',
      'VALUES ($1,',
      'extensions.ST_SetSRID(extensions.ST_MakePoint($2,$3),4326)::extensions.geography,',
      'extensions.ST_SetSRID(extensions.ST_MakePoint($4,$5),4326)::extensions.geography,',
      '$6,$7,$8,$9)'
    ].join(' '),[id,a.lon,a.lat,b.lon,b.lat,dep,cell(a),cell(b),bucket(dep)]);
  }
  for(let i=0;i<students;i++){
    const a=locate(origin,{lat:(rand()-.5)*0.006,lon:(rand()-.5)*0.006});
    const b=locate(dest,{lat:(rand()-.5)*0.006,lon:(rand()-.5)*0.006});
    await pool.query([
      'INSERT INTO public.campus_trip_intents',
      '(id,student_user_id,pickup_geo,dropoff_geo,pickup_cell,dropoff_cell,',
      'first_bucket,earliest_departure,latest_departure)',
      'VALUES ($1,$2,',
      'extensions.ST_SetSRID(extensions.ST_MakePoint($3,$4),4326)::extensions.geography,',
      'extensions.ST_SetSRID(extensions.ST_MakePoint($5,$6),4326)::extensions.geography,',
      '$7,$8,$9,$10)'
    ].join(' '),[intentIds[i],passengers[i],a.lon,a.lat,b.lon,b.lat,
      cell(a),cell(b),bucket(earliest),earliest,latest]);
  }
  await pool.query('ANALYZE public.campus_rides');
  await pool.query('ANALYZE public.campus_ride_geo');
  await pool.query('ANALYZE public.campus_trip_intents');
  return fixtures;
}
async function cleanup(pool,fixtures,bucketKey){
  // Guard is repeated before cleanup. Delete only synthetic IDs recorded locally.
  await ensureIdentity(pool);
  if(fixtures){
    const {users,allRideIds,intentIds}=fixtures;
    await pool.query('DELETE FROM public.campus_trip_intents WHERE id=ANY($1::uuid[])',[intentIds]);
    await pool.query('DELETE FROM public.campus_ride_geo WHERE ride_id=ANY($1::text[])',[allRideIds]);
    await pool.query('DELETE FROM public.campus_rides WHERE id=ANY($1::text[])',[allRideIds]);
    await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[users]);
  }
  if(bucketKey)await pool.query('DELETE FROM public.otp_rate_buckets WHERE bucket_key=$1',[bucketKey]);
}
async function ensureIdentity(pool){
  const r=await pool.query('SELECT current_database() AS db,inet_server_addr()::text AS addr');
  if(r.rows[0].db!=='campuspool_mobility_bench'||
    !privateServerAddress(r.rows[0].addr))throw Error('UNSAFE_CLEANUP_TARGET');
}
async function sampleDb(pool){
  const r=await pool.query([
    'SELECT xact_commit, xact_rollback, blks_read, blks_hit, temp_bytes, deadlocks',
    'FROM pg_stat_database WHERE datname=current_database()'
  ].join(' '));
  return r.rows[0]||{};
}
function deltaStats(after,before){
  return Object.fromEntries(Object.keys(before).map(key=>[
    key,Math.max(0,Number(after[key]||0)-Number(before[key]||0))
  ]));
}
async function planSummary(pool,studentId,intentId){
  const sql=[
    'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)',
    'SELECT g.ride_id FROM public.campus_trip_intents i',
    'JOIN public.campus_ride_geo g ON',
    'extensions.ST_DWithin(g.pickup_geo,i.pickup_geo,1500)',
    'AND extensions.ST_DWithin(g.dropoff_geo,i.dropoff_geo,1500)',
    'JOIN public.campus_rides r ON r.id=g.ride_id',
    "WHERE i.id=$1::uuid AND i.student_user_id=$2::uuid AND i.status='active'",
    "AND r.status='active' AND r.seats_left>0 AND r.driver_user_id<>$2::uuid",
    'AND g.departure_at>=i.earliest_departure AND g.departure_at<=i.latest_departure',
    "AND g.departure_at>=now()-interval '10 minutes'",
    'ORDER BY (extensions.ST_Distance(g.pickup_geo,i.pickup_geo)+',
    'extensions.ST_Distance(g.dropoff_geo,i.dropoff_geo)) ASC,g.departure_at ASC LIMIT 10'
  ].join(' ');
  const r=await pool.query(sql,[intentId,studentId]);
  const top=r.rows[0]?.['QUERY PLAN']?.[0]||{};
  const nodes=[];
  function walk(plan){
    if(!plan)return;
    nodes.push({
      type:plan['Node Type'],
      relation:plan['Relation Name']||undefined,
      index:plan['Index Name']||undefined,
      actualRows:plan['Actual Rows']||0,
      sharedHitBlocks:plan['Shared Hit Blocks']||0
    });
    for(const child of plan.Plans||[])walk(child);
  }
  walk(top.Plan);
  return {executionMs:formatNum(Number(top['Execution Time']||0)),
    planningMs:formatNum(Number(top['Planning Time']||0)),nodes};
}
async function exerciseRateLimit(pool,studentId){
  const hmac='ci-only-postgis-benchmark-hmac-not-a-live-secret';
  const otp=new PgOtpStore({pool,hmacKey:hmac});
  const label='mobility-match-search';
  const bucketKey=otp.digest('rate:'+label,studentId);
  const begun=performance.now();
  // 35 simultaneous calls for one account: the backend's 30/hour policy
  // must hold under row-level contention across multiple pool connections.
  const results=await Promise.allSettled(
    Array.from({length:35},()=>otp.tx(client=>otp.rate(client,label,studentId,30,3600)))
  );
  const allowed=results.filter(item=>item.status==='fulfilled').length;
  const denied=results.filter(item=>item.status==='rejected'&&
    item.reason?.code==='RATE_LIMITED'&&item.reason?.status===429).length;
  if(allowed!==30||denied!==5)throw Error('RATE_BUCKET_CONTENTION_INVARIANT_FAILED');
  const row=await pool.query('SELECT attempts FROM public.otp_rate_buckets WHERE bucket_key=$1',[bucketKey]);
  if(row.rowCount!==1||Number(row.rows[0].attempts)!==30)
    throw Error('RATE_BUCKET_DURABILITY_FAILED');
  return {bucketKey,metric:{attempted:35,allowed,denied,elapsedMs:formatNum(performance.now()-begun)}};
}
async function run(env=process.env){
  assertDisposableTarget(env);
  const students=size(env.BENCH_STUDENTS,128,100,256);
  const rides=size(env.BENCH_RIDES,512,256,2048);
  const poolMax=size(env.BENCH_POOL_MAX,24,4,48);
  const pool=new Pool({connectionString:env.OTP_DATABASE_URL,ssl:false,max:poolMax,
    connectionTimeoutMillis:8000,idleTimeoutMillis:10000});
  const monitor=new Pool({connectionString:env.OTP_DATABASE_URL,ssl:false,max:2,
    connectionTimeoutMillis:8000});
  let fixtures=null,bucketKey=null,timer=null,monitoring=false;
  try{
    await ensureEmpty(pool);
    fixtures=await seed(pool,students,rides,owned=>{fixtures=owned;});
    const startCpu=process.cpuUsage();
    const statsBefore=await sampleDb(monitor);
    const mobility=new PgMobilityStore({pool});
    let maxWaiting=0,maxPoolTotal=0,maxLockWaiters=0,maxPgActive=0,samples=0;
    timer=setInterval(async()=>{
      maxWaiting=Math.max(maxWaiting,pool.waitingCount);
      maxPoolTotal=Math.max(maxPoolTotal,pool.totalCount);
      if(monitoring)return;
      monitoring=true;
      try{
        const result=await monitor.query([
          "SELECT count(*) FILTER (WHERE state='active')::int AS active,",
          "count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waiters",
          'FROM pg_stat_activity WHERE datname=current_database()'
        ].join(' '));
        samples++;
        maxPgActive=Math.max(maxPgActive,Number(result.rows[0].active));
        maxLockWaiters=Math.max(maxLockWaiters,Number(result.rows[0].lock_waiters));
      }catch(_){/* diagnostic sampling best effort, never a security bypass */}
      finally{monitoring=false;}
    },25);
    timer.unref?.();
    const begun=performance.now();
    const outcomes=await Promise.allSettled(fixtures.passengers.map(async(studentUserId,i)=>{
      const before=performance.now();
      const result=await mobility.findCandidates({studentUserId,intentId:fixtures.intentIds[i]});
      validateCandidate(result);
      return {ms:performance.now()-before,hits:result.candidates.length};
    }));
    const elapsed=performance.now()-begun;
    clearInterval(timer);timer=null;
    const errors=outcomes.filter(x=>x.status==='rejected');
    if(errors.length)throw Error('MATCH_QUERIES_FAILED_'+errors.length);
    const data=outcomes.map(x=>x.value),values=data.map(x=>x.ms);
    const matched=data.filter(x=>x.hits>0).length;
    if(matched===0)throw Error('SYNTHETIC_WORKLOAD_NO_MATCHES');
    const plan=await planSummary(pool,fixtures.passengers[0],fixtures.intentIds[0]);
    // Know the exact synthetic bucket even when the contention assertion fails.
    bucketKey=new PgOtpStore({pool,hmacKey:'ci-only-postgis-benchmark-hmac-not-a-live-secret'})
      .digest('rate:mobility-match-search',fixtures.passengers[0]);
    const rate=await exerciseRateLimit(pool,fixtures.passengers[0]);
    const statsAfter=await sampleDb(monitor);
    const cpu=process.cpuUsage(startCpu);
    const report={
      label:'synthetic-disposable-postgis-store-baseline',
      caveat:'DB-layer burst only; NOT HTTP latency, a Render capacity SLA, or proof for Redis/H3 adoption',
      recordedAt:new Date().toISOString(),
      system:{node:process.version,platform:process.platform,
        cpus:require('node:os').availableParallelism?.()||require('node:os').cpus().length},
      scenario:{students,geocodedRides:rides,simultaneousMatchingCalls:students,
        applicationPoolMax:poolMax,randomSeed:4096,
        geography:'synthetic Pune-area points',targetDatabase:'campuspool_mobility_bench'},
      matching:{
        succeeded:data.length,failed:0,studentsWithCandidates:matched,
        totalCandidateCards:data.reduce((a,b)=>a+b.hits,0),
        p50Ms:percentile(values,50),p95Ms:percentile(values,95),
        p99Ms:percentile(values,99),maxMs:formatNum(Math.max(...values)),
        totalElapsedMs:formatNum(elapsed),throughputPerSecond:formatNum(students*1000/elapsed)
      },
      diagnostics:{maximumPoolQueue:maxWaiting,maximumPoolConnections:maxPoolTotal,
        activeSamples:samples,maxActivePgSessions:maxPgActive,
        maxPgLockWaiters:maxLockWaiters,
        nodeCpuUserMs:formatNum(cpu.user/1000),nodeCpuSystemMs:formatNum(cpu.system/1000),
        nodeRssMb:formatNum(process.memoryUsage().rss/1048576),
        pgStatsDeltasApproximate:deltaStats(statsAfter,statsBefore)},
      representativeQueryPlan:plan,
      sharedPostgresThrottle:rate.metric,
      privacy:'only anonymous aggregate metrics; no user UUIDs, contact fields, credentials, or raw coordinates',
      releaseDecision:'No change: additional infrastructure deferred; independently review against real traffic and staging hardware'
    };
    fs.mkdirSync(path.join(process.cwd(),'bench-results'),{recursive:true});
    fs.writeFileSync(path.join(process.cwd(),'bench-results','mobility.json'),
      JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({
      students,rides,successful:students,p95Ms:report.matching.p95Ms,
      throughputPerSecond:report.matching.throughputPerSecond,
      poolQueuePeak:maxWaiting,rateAllowed:rate.metric.allowed,rateDenied:rate.metric.denied,
      report:'bench-results/mobility.json'
    })+'\n');
    return report;
  }finally{
    if(timer)clearInterval(timer);
    try{await cleanup(pool,fixtures,bucketKey);}
    finally{await Promise.allSettled([pool.end(),monitor.end()]);}
  }
}
if(require.main===module)run().catch(error=>{
  // Never print a connection string, UUID, student record, SQL or credentials.
  // Print only predetermined uppercase error identifiers; never DB URLs,
  // SQL fragments, user IDs, hostnames or raw PostgreSQL exception text.
  const category=String(error?.code||error?.message||'UNCLASSIFIED_FAILURE');
  const safe=/^[A-Z][A-Z0-9_]{2,79}$/.test(category)?category:'UNCLASSIFIED_FAILURE';
  process.stderr.write('MOBILITY_BENCH_FAILED: '+safe+'\n');
  process.exitCode=1;
});
module.exports={assertDisposableTarget,privateServerAddress,size,percentile,validateCandidate,random,run};
