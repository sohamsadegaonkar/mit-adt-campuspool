'use strict';
// Reuse the real HTTP test child and disposable fixtures. No proxy spoofing,
// rate-counter manipulation, real student credentials or external destinations.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
async function runFairness({t,pool,ids,tokens,basic,port}){
  assert.equal(process.env.RIDES_HTTP_FAIRNESS_DISPOSABLE_DB,'YES');
  const u=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));
  assert.equal(u.pathname,'/campuspool_stage1_ci');
  assert.equal(u.search+u.hash,'');
  assert.equal(process.platform,'linux');
  const agent=new http.Agent({keepAlive:true,maxSockets:8,maxTotalSockets:32});
  const actorHash=id=>crypto.createHash('sha256').update('campus-user:'+id).digest('hex');
  const csrf=[];
  const extraToken=crypto.randomBytes(32).toString('base64url');
  const revoked=crypto.randomBytes(32).toString('base64url');
  const expired=crypto.randomBytes(32).toString('base64url');
  const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
  async function request(route,{user=0,source='127.0.0.110',token=tokens[user],body,key,proof=csrf[user],forwarded}={}){
    const headers={Authorization:basic};
    if(token)headers.Cookie='cp_session='+token;
    if(forwarded)headers['X-Forwarded-For']=forwarded;
    const payload=body===undefined?null:JSON.stringify(body);
    if(payload!==null){
      headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(payload);
      if(proof)headers['X-CSRF-Token']=proof;
      if(key)headers['Idempotency-Key']=key;
    }
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:route,localAddress:source,agent,headers,
        method:payload===null?'GET':'POST',signal:AbortSignal.timeout(12000)},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);
        res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks)),
          tier:res.headers['x-ratelimit-tier'],limit:Number(res.headers['ratelimit-limit']),
          retryAfter:Number(res.headers['retry-after']),replayed:res.headers['idempotency-replayed']});}catch(e){reject(e);}});
      });req.on('error',reject);req.end(payload||undefined);
    });
  }
  const limited=(r,tier,limit)=>{
    assert.equal(r.status,429);assert.equal(r.tier,tier);assert.equal(r.limit,limit);
    assert.equal(r.data.error,'RATE_LIMIT_EXCEEDED');assert.ok(r.retryAfter>0);
  };
  try{
    for(let i=0;i<ids.length;i++){
      const r=await request('/api/auth/me',{user:i});
      assert.equal(r.status,200);assert.equal(r.data.user.id,ids[i]);csrf[i]=r.data.csrfToken;
      assert.equal(r.tier,'API_READ','Auth remains on original IP policy');
    }
    await pool.query("INSERT INTO public.campus_sessions(session_hash,user_id,expires_at,revoked_at) VALUES($1,$2,now()+interval '1 hour',NULL),($3,$2,now()+interval '1 hour',now()),($4,$2,now()-interval '1 hour',NULL)",[sha(extraToken),ids[0],sha(revoked),sha(expired)]);
    let shared=0;
    for(let i=0;i<130;i++){
      const r=await request('/api/rides',{user:i%ids.length,source:'127.0.0.110'});
      assert.equal(r.status,200);assert.equal(r.tier,'CAMPUS_USER_API_READ');assert.equal(r.limit,120);shared++;
    }
    // Actor zero made 17 of the 130 reads. Spread the rest across source
    // addresses and two valid sessions: all must count against the same UUID.
    for(let i=0;i<103;i++){
      const r=await request('/api/rides',{source:i%2?'127.0.0.111':'127.0.0.112',token:i%2?extraToken:tokens[0]});
      assert.equal(r.status,200);
    }
    limited(await request('/api/rides',{source:'127.0.0.113',token:extraToken,forwarded:'198.51.100.15'}),'CAMPUS_USER_API_READ',120);
    assert.equal((await request('/api/rides',{user:1,source:'127.0.0.113'})).status,200);
    // Invalid tokens remain IP-limited; verified identity is not inferred
    // from the request body, supplied header, malformed cookie or token.
    const badTokens=[null,'not-a-session',revoked,expired,crypto.randomBytes(32).toString('base64url')];
    for(let i=0;i<120;i++){
      const r=await request('/api/rides',{source:'127.0.0.114',token:badTokens[i%5]});
      assert.equal(r.status,401);assert.equal(r.tier,'API_READ');
    }
    limited(await request('/api/rides',{source:'127.0.0.114',token:badTokens[4]}),'API_READ',120);
    // Exhaust the same IP's remaining aggregate allowance using missing
    // session requests (cheap; no DB lookup). Hard ceiling also blocks a
    // verified actor before auth, independent of their remaining budget.
    for(let i=121;i<600;i++)limited(await request('/api/rides',{source:'127.0.0.114',token:null}),'API_READ',120);
    limited(await request('/api/rides',{user:2,source:'127.0.0.114',forwarded:'198.51.100.16'}),'CAMPUS_IP_API_READ',600);
    assert.equal((await request('/api/rides',{user:2,source:'127.0.0.115'})).status,200);
    const rideInput={vehicle:'Car',vehicleModel:'CI Fairness Vehicle',pickup:'CI Gate',destination:'CI Station',
      departureTime:'2027-02-01T17:00:00',seatsTotal:2,uberBenchmark:100,studentFare:30,driverPayout:26,note:'CI only'};
    const key=crypto.randomUUID();
    const created=await request('/api/rides',{user:3,source:'127.0.0.116',body:rideInput,key});
    assert.equal(created.status,201);const rideId=created.data.ride.id;
    const denied=await request('/api/bookings',{user:4,source:'127.0.0.116',body:{rideId},key:crypto.randomUUID(),proof:csrf[3]});
    assert.equal(denied.status,403);assert.equal(denied.data.error,'CSRF_REQUIRED');
    for(let i=0;i<59;i++){
      const r=await request('/api/bookings/cancel',{user:3,source:'127.0.0.116',body:{bookingId:'BKG-'+crypto.randomUUID()},key:crypto.randomUUID()});
      assert.equal(r.status,404);assert.equal(r.data.error,'BOOKING_NOT_FOUND');
    }
    const replay=await request('/api/rides',{user:3,source:'127.0.0.116',body:rideInput,key});
    assert.equal(replay.status,201);assert.equal(replay.replayed,'true');assert.equal(replay.data.ride.id,rideId);
    const mismatch=await request('/api/rides',{user:3,source:'127.0.0.116',body:{...rideInput,note:'different'},key});
    assert.equal(mismatch.status,409);assert.equal(mismatch.data.error,'IDEMPOTENCY_KEY_REUSED');
    limited(await request('/api/rides',{user:3,source:'127.0.0.117',body:rideInput,key:crypto.randomUUID()}),'CAMPUS_USER_MUTATION',60);
    // Another verified user on same Wi-Fi can reserve a seat; the original
    // driver's receipt key cannot be read across actor/route scope.
    const booked=await request('/api/bookings',{user:4,source:'127.0.0.116',body:{rideId},key});
    assert.equal(booked.status,201);assert.equal(booked.replayed,undefined);assert.equal(booked.data.booking.rideId,rideId);
    for(let i=0;i<10;i++){
      const r=await request('/api/rides',{user:3,source:'127.0.0.116',body:rideInput,key});
      assert.equal(r.status,201);assert.equal(r.replayed,'true');
    }
    limited(await request('/api/rides',{user:3,source:'127.0.0.116',body:rideInput,key}),'CAMPUS_USER_MUTATION',60);
    // Shared aggregate write ceiling: fill with anonymous keyed requests.
    // No replay allowance at the hard ceiling, even for valid receipt.
    for(let i=0;i<300;i++){
      const r=await request('/api/rides',{source:'127.0.0.118',token:null,body:rideInput,key});
      if(i<60)assert.equal(r.status,401);else limited(r,'MUTATION',60);
    }
    limited(await request('/api/rides',{user:3,source:'127.0.0.118',body:rideInput,key}),'CAMPUS_IP_MUTATION',300);
    const actual=(await pool.query('SELECT seats_left::int AS available,seats_total::int AS total,(SELECT count(*)::int FROM public.campus_bookings WHERE ride_id=$1 AND status=\'active\') AS active FROM public.campus_rides WHERE id=$1',[rideId])).rows[0];
    assert.deepEqual(actual,{available:1,total:2,active:1});
    const receipts=(await pool.query('SELECT actor_hash,route,request_key FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',[ids.map(actorHash)])).rows;
    assert.equal(receipts.length,2);
    assert.ok(receipts.some(r=>r.actor_hash===actorHash(ids[3])&&r.route==='POST /api/rides'&&r.request_key===key));
    assert.ok(receipts.some(r=>r.actor_hash===actorHash(ids[4])&&r.route==='POST /api/bookings'&&r.request_key===key));
    t.diagnostic('CAMPUS_WIFI_RESULT '+JSON.stringify({sharedAccepted:shared,actorReadCap:120,crossSessionAndIp:true,
      invalidTokenCases:badTokens.length,anonymousIpCap:120,aggregateReadCap:600,actorWriteCap:60,
      aggregateWriteCap:300,completedReplays:11,replayBudgetEnforced:true,csrfDenied:true,otherActorBooked:true,
      receipts:receipts.length,seatInvariant:true}));
  }finally{agent.destroy();}
}
module.exports={runFairness};
