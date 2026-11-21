'use strict';

// Public endpoints only. No credentials, cookies, OTPs, POSTs or migrations.
// Operator-supplied Render SHA is a manual attestation, not remote proof.
const HOSTS={
  production:'mit-adt-campuspool.onrender.com',
  staging:'mit-adt-campuspool-staging.onrender.com'
};
const SHA=/^[a-f0-9]{40}$/i;

function validate({target,url,expectedSha,deployedSha}){
  const errors=[];
  if(!['production','staging','local'].includes(target)) errors.push('INVALID_TARGET');
  if(!SHA.test(expectedSha||'')) errors.push('EXPECTED_SHA_REQUIRED');
  if(!SHA.test(deployedSha||'')) errors.push('DEPLOYED_SHA_REQUIRED');
  if(SHA.test(expectedSha||'')&&SHA.test(deployedSha||'')&&
     expectedSha.toLowerCase()!==deployedSha.toLowerCase()) errors.push('SOURCE_DEPLOY_SHA_MISMATCH');
  let origin;
  try {
    const parsed=new URL(url);
    if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/' ||
       !['http:','https:'].includes(parsed.protocol)) throw Error('URL_NOT_ORIGIN');
    if(target==='local'){
      if(parsed.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))
        throw Error('LOCAL_MUST_BE_LOOPBACK_HTTP');
    }else if(parsed.protocol!=='https:'||parsed.hostname!==HOSTS[target]||parsed.port){
      throw Error('RENDER_HOST_MISMATCH');
    }
    origin=parsed.origin;
  } catch(_){errors.push('UNSAFE_OR_INVALID_ORIGIN');}
  return {ok:errors.length===0,errors,origin};
}

async function smoke({target,url,expectedSha,deployedSha,fetchImpl=globalThis.fetch}={}){
  const checks=[];
  const validation=validate({target,url,expectedSha,deployedSha});
  if(!validation.ok){
    return {verdict:'BLOCKED_PREFLIGHT',target:target||null,checks,
      failures:validation.errors,requestsMade:0,
      note:'No network attempted. Render SHA must be read from deployment metadata.'};
  }
  checks.push({id:'DECLARED_SHA_PARITY',result:'PASS'});
  const expectedStatus={'/healthz':200,'/':target==='staging'?401:200,'/api/auth/me':401};
  let requestsMade=0;
  for(const path of Object.keys(expectedStatus)){
    let response;
    try{
      requestsMade++;
      response=await fetchImpl(validation.origin+path,{
        method:'GET',redirect:'manual',credentials:'omit',
        headers:{Accept:path==='/healthz'?'application/json':'text/html,application/json'},
        signal:AbortSignal.timeout(10000)
      });
      if(response.status!==expectedStatus[path]){
        checks.push({id:path,result:'FAIL',status:response.status,expectedStatus:expectedStatus[path]});
        continue;
      }
      if(path==='/healthz'){
        const payload=await response.json();
        if(!payload||payload.status!=='healthy'){
          checks.push({id:path,result:'FAIL',status:response.status,reason:'UNHEALTHY_RESPONSE'});
          continue;
        }
      }else if(path==='/'&&target!=='staging'){
        const html=await response.text();
        if(!/CampusPool/i.test(html)){
          checks.push({id:path,result:'FAIL',status:response.status,reason:'UNRECOGNIZED_HOME_PAGE'});
          continue;
        }
      }
      checks.push({id:path,result:'PASS',status:response.status});
    }catch(_){
      checks.push({id:path,result:'FAIL',reason:'TIMEOUT_OR_REQUEST_ERROR'});
    }
  }
  const failures=checks.filter(x=>x.result==='FAIL').map(x=>x.id);
  return {verdict:failures.length?'BLOCKED_SMOKE_FAILURE':'PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL',
    target,sourceSha:expectedSha.toLowerCase(),operatorReportedDeployedSha:deployedSha.toLowerCase(),
    shaEvidence:'OPERATOR_SUPPLIED_NOT_ATTESTED_BY_SCRIPT',origin:validation.origin,
    checks,failures,requestsMade,methodsUsed:['GET'],
    releaseGatesStillRequired:['REAL_EMAIL_AND_SMS_DELIVERY','DURABLE_DATA_AND_RESTORE','SECURITY_AND_ROLLBACK_APPROVAL']};
}

function parse(argv){
  const opts={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--help'&&argv.length===1)return {help:true};
    if(!['--target','--url','--expected-sha','--deployed-sha'].includes(key)||
       !argv[i+1]||argv[i+1].startsWith('--')||opts[key])throw Error('INVALID_ARGUMENTS');
    opts[key]=argv[++i];
  }
  return {target:opts['--target'],url:opts['--url'],
    expectedSha:opts['--expected-sha'],deployedSha:opts['--deployed-sha']};
}

async function main(argv=process.argv.slice(2),write=line=>process.stdout.write(line+'\n')){
  try{
    const opts=parse(argv);
    if(opts.help){
      write('Usage: node scripts/deployment-smoke.js --target local|staging|production --url ORIGIN --expected-sha COMMIT40 --deployed-sha RENDER_COMMIT40');
      return 0;
    }
    const result=await smoke(opts);
    write(JSON.stringify(result,null,2));
    return result.verdict==='PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL'?0:1;
  }catch(_){write('DEPLOYMENT_SMOKE_ARGUMENTS_INVALID');return 2;}
}
if(require.main===module){main().then(code=>{process.exitCode=code;}).catch(()=>{
  process.stderr.write('DEPLOYMENT_SMOKE_FAILED_REDACTED\n');process.exitCode=1;
});}
module.exports={validate,smoke,parse,main};
