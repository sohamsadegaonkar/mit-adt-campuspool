'use strict';
// Browser QA fixtures use only synthetic records and a disposable localhost PostGIS.
const crypto=require('node:crypto');
const {Pool}=require('pg');

const db=process.env.OTP_DATABASE_URL;
if(process.env.QA_DISPOSABLE_POSTGIS!=='YES' || !db ||
   !['127.0.0.1','localhost','[::1]'].includes(new URL(db).hostname))
  throw Error('Refusing browser QA fixtures on non-disposable or remote PostgreSQL');

const pool=new Pool({connectionString:db,ssl:false,max:3,connectionTimeoutMillis:5000});
const BASE='http://127.0.0.1:4188';
const AUTH='Basic '+Buffer.from('staging:ci-only-mobility-browser-qa-no-real-secret').toString('base64');

async function user(label){
  const id=crypto.randomUUID();
  const token=crypto.randomBytes(32).toString('base64url');
  const email='browser-qa-'+crypto.randomBytes(8).toString('hex')+'@students.mituniversity.edu.in';
  const phone='9'+String(crypto.randomInt(100000000,1000000000));
  const name='Browser QA '+label;
  await pool.query(
    'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified) VALUES($1,$2,$3,$4,$5,true)',
    [id,name,email,phone,'Synthetic QA']
  );
  await pool.query(
    "INSERT INTO public.campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '2 hours')",
    [crypto.createHash('sha256').update(token).digest('hex'),id]
  );
  return {id,token,name,email,phone};
}
async function seed(){
  const records=[];
  for(const label of ['Driver','Passenger','Outsider'])records.push(await user(label));
  return {driver:records[0],passenger:records[1],outsider:records[2],users:records};
}
async function clear(fixture){
  if(!fixture?.users?.length)return;
  const ids=fixture.users.map(u=>u.id);
  // FK-safe deletion, synthetic identities only. Never truncate or drop a table.
  await pool.query('DELETE FROM public.campus_bookings WHERE passenger_user_id=ANY($1::uuid[]) OR ride_id IN (SELECT id FROM public.campus_rides WHERE driver_user_id=ANY($1::uuid[]))',[ids]);
  await pool.query('DELETE FROM public.campus_trip_intents WHERE student_user_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM public.campus_ride_geo WHERE ride_id IN (SELECT id FROM public.campus_rides WHERE driver_user_id=ANY($1::uuid[]))',[ids]);
  await pool.query('DELETE FROM public.campus_rides WHERE driver_user_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM public.campus_sessions WHERE user_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM public.campus_users WHERE id=ANY($1::uuid[])',[ids]);
}
async function openAs(page,context,person){
  // Firefox may not preemptively reuse the browser's Basic Auth challenge
  // for parallel fetch() probes. Explicit CI-only header stabilizes staging auth.
  await context.setExtraHTTPHeaders({Authorization:AUTH});
  await context.clearCookies();
  if(person)await context.addCookies([{name:'cp_session',value:person.token,url:BASE,httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(person){
    const session=await page.request.get('/api/auth/me');
    if(session.status()!==200)
      throw Error('Synthetic browser session unavailable; HTTP status '+session.status());
  }
}
async function api(person,path,method='GET',body){
  const headers={Authorization:AUTH,Cookie:'cp_session='+person.token};
  if(body!==undefined){
    const me=await fetch(BASE+'/api/auth/me',{headers});
    if(!me.ok)throw Error('Synthetic QA session not accepted: '+me.status);
    const session=await me.json();
    headers['X-CSRF-Token']=session.csrfToken;
    headers['Content-Type']='application/json';
  }
  const res=await fetch(BASE+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  let response={};
  try{response=await res.json();}catch(_){}
  return {status:res.status,data:response};
}
function future(hours=24){return new Date(Date.now()+hours*3600000);}
function localInput(date){return date.toISOString().slice(0,16);}
async function seedRide(person,{geocoded=true}={}){
  const departure=future();
  const ride={
    vehicle:'Car',vehicleModel:'Browser QA Car',pickup:'CI Campus Gate',
    destination:'CI Pune Station',departureTime:departure.toISOString(),seatsTotal:2,
    studentFare:40,driverPayout:36,uberBenchmark:100,note:'Synthetic QA ride',
    ...(geocoded?{
      pickupCoordinates:{lat:18.5103,lon:73.9232},
      destinationCoordinates:{lat:18.4652,lon:74.0181},
      departureAt:departure.toISOString()
    }:{})
  };
  const result=await api(person,'/api/rides','POST',ride);
  if(result.status!==201)throw Error('Synthetic ride creation failed with status '+result.status+' '+String(result.data?.error||''));
  return result.data.ride.id;
}
module.exports={pool,seed,clear,openAs,api,future,localInput,seedRide};