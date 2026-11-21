'use strict';
// Explicitly authorized, staging-only TLS handshake. No student rows or dumps.
// Validate with libpq verify-full; never reveal server/SDK errors or credentials.
const {spawn}=require('node:child_process');
const {validate,limitedEnv}=require('./azure-blob-backup');

const SQL="SELECT CASE WHEN ssl AND version IN ('TLSv1.2','TLSv1.3') THEN 'TLS_VERIFIED' ELSE 'TLS_REJECTED' END FROM pg_stat_ssl WHERE pid = pg_backend_pid()";
const TIMEOUT_MS=15000;
// Diagnostic hints only; never emit raw stderr, host, password, SQL text or certificate contents.
function classifyPsqlFailure(stderr){
 if(/password authentication failed|no password supplied|password is required/i.test(stderr))return 'STAGING_TLS_DB_AUTH_BLOCKED';
 if(/certificate verify failed|certificate.*does not match|hostname.*does not match|server certificate.*not trusted|root certificate file.*does not exist/i.test(stderr))return 'STAGING_TLS_CERTIFICATE_BLOCKED';
 if(/timeout expired|connection timed out/i.test(stderr))return 'STAGING_TLS_CONNECT_TIMEOUT';
 if(/could not translate host name|name or service not known|temporary failure in name resolution/i.test(stderr))return 'STAGING_TLS_DNS_BLOCKED';
 if(/connection refused|network is unreachable|no route to host/i.test(stderr))return 'STAGING_TLS_NETWORK_BLOCKED';
 return 'STAGING_TLS_PSQL_FAILED';
}
async function stagingTlsProbe(env,{spawnImpl=spawn}={}){
 if(!validate(env).ok)throw Error('STAGING_TLS_CONFIGURATION_BLOCKED');
 if(env.AZURE_AUTH_MODE!=='managed-identity'||!env.PGPASSFILE)
   throw Error('STAGING_TLS_CONFIGURATION_BLOCKED');
 const childEnv=limitedEnv(env,'pg');
 childEnv.PGCONNECT_TIMEOUT='10';
 childEnv.PGAPPNAME='campuspool-staging-tls-check';
 // Force libpq to connect to the exact vetted host with TLS verification.
 return new Promise((resolve,reject)=>{
   let child,finished=false,text='',size=0,stderr='',stderrSize=0;
   let timer;
   const done=(error,value)=>{
     if(finished)return;
     finished=true;
     clearTimeout(timer);
     if(error)reject(Error(error));
     else resolve(value);
   };
   try{
     child=spawnImpl('psql',[
       '--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1',
       '--tuples-only','--no-align','--command',SQL
     ],{env:childEnv,stdio:['ignore','pipe','pipe']});
   }catch{return reject(Error('STAGING_TLS_CHILD_LAUNCH_BLOCKED'));}
   timer=setTimeout(()=>{
     done('STAGING_TLS_PROBE_TIMEOUT');
     child.kill('SIGKILL');
   },TIMEOUT_MS);
   child.stdout?.on('data',part=>{
     size+=part.length;
     if(size>512){done('STAGING_TLS_OUTPUT_LIMIT');child.kill('SIGKILL');return;}
     text+=part.toString('utf8');
   });
   child.stderr?.on('data',part=>{
     stderrSize+=part.length;
     if(stderrSize>4096){done('STAGING_TLS_OUTPUT_LIMIT');child.kill('SIGKILL');return;}
     stderr+=part.toString('utf8');
   });
   child.once('error',()=>done('STAGING_TLS_CHILD_LAUNCH_BLOCKED'));
   child.once('close',code=>{
     if(code!==0)return done(classifyPsqlFailure(stderr));
     if(text.trim()==='TLS_REJECTED')return done('STAGING_TLS_BACKEND_SESSION_REJECTED');
     if(text.trim()!=='TLS_VERIFIED')return done('STAGING_TLS_BACKEND_METADATA_UNEXPECTED');
     done(false,{status:'STAGING_TLS_VERIFY_FULL_PASS',dataRead:false,backupCreated:false});
   });
 });
}
module.exports={SQL,stagingTlsProbe,classifyPsqlFailure};
