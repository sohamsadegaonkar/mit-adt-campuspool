'use strict';
// Read-only, secret-safe staging smoke. No account creation or OTP requests.
// Called AFTER a separately approved Render staging deploy, not a prod deploy.
const BASE='https://mit-adt-campuspool-staging.onrender.com';
function readConfig(env){
  if(env.STAGING_BASE_URL&&env.STAGING_BASE_URL!==BASE)throw Error('STAGING_URL_NOT_APPROVED');
  if(!/^[a-f0-9]{40}$/.test(env.STAGING_EXPECTED_SHA||''))
    throw Error('EXACT_DEPLOYED_SHA_REQUIRED');
  if(typeof env.STAGING_BASIC_AUTH_PASSWORD!=='string'||
     env.STAGING_BASIC_AUTH_PASSWORD.length<20)
    throw Error('STAGING_BASIC_AUTH_REQUIRED');
  return {expected:env.STAGING_EXPECTED_SHA,pass:env.STAGING_BASIC_AUTH_PASSWORD};
}
async function runSmoke({env=process.env,fetchImpl=globalThis.fetch}={}){
  const {expected,pass}=readConfig(env);
  const basic='Basic '+Buffer.from('staging:'+pass,'utf8').toString('base64');
  async function http(path,authorization){
    const response=await fetchImpl(BASE+path,{
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000),
      headers:authorization?{Authorization:authorization}:{}
    });
    return response;
  }
  let health;
  // Render Free may cold-start. Never print response bodies or credentials.
  for(let attempt=0;attempt<4;attempt++){
    try{
      const r=await http('/healthz');
      if(r.status===200){
        const payload=await r.json();
        if(payload?.status==='healthy'){health=payload;break;}
      }
    }catch(_){/* transient cold-start or network failure */}
  }
  if(!health)throw Error('STAGING_HEALTH_NOT_READY');
  if(health.environment!=='staging')throw Error('NOT_STAGING_ENVIRONMENT');
  if(health.revision!==expected)throw Error('STAGING_COMMIT_MISMATCH');
  for(const path of ['/','/api/auth/me','/api/_staging/qa-otp']){
    const res=await http(path);
    if(res.status!==401)throw Error('STAGING_PUBLIC_ACCESS_NOT_BLOCKED');
  }
  const root=await http('/',basic);
  if(root.status!==200)throw Error('STAGING_BASIC_AUTH_FAILED');
  const me=await http('/api/auth/me',basic);
  if(me.status!==401)throw Error('UNAUTHENTICATED_SESSION_NOT_BLOCKED');
  return {status:'STAGING_READ_ONLY_ACCEPTANCE_PASS',
    exactCommitMatched:true,basicAuthBlockedPublic:true,sessionRequired:true,
    otpFixtureTested:false,productionTouched:false};
}
if(require.main===module){
  runSmoke().then(r=>process.stdout.write(JSON.stringify(r)+'\n'))
    .catch(e=>{const allowed=new Set(['STAGING_URL_NOT_APPROVED','EXACT_DEPLOYED_SHA_REQUIRED','STAGING_BASIC_AUTH_REQUIRED','STAGING_HEALTH_NOT_READY','NOT_STAGING_ENVIRONMENT','STAGING_COMMIT_MISMATCH','STAGING_PUBLIC_ACCESS_NOT_BLOCKED','STAGING_BASIC_AUTH_FAILED','UNAUTHENTICATED_SESSION_NOT_BLOCKED']);process.stderr.write('BLOCK '+(allowed.has(e.message)?e.message:'STAGING_SMOKE_UNCLASSIFIED')+'\n');process.exitCode=1;});
}
module.exports={readConfig,runSmoke,BASE};
