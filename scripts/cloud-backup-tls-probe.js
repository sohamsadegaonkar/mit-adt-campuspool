'use strict';
// Explicitly authorized, staging-only TLS handshake. No student rows or dumps.
// Validate with libpq verify-full; never reveal server/SDK errors or credentials.
const {spawn}=require('node:child_process');
const {validate,limitedEnv}=require('./azure-blob-backup');

const SQL="SELECT CASE WHEN ssl AND version IN ('TLSv1.2','TLSv1.3') THEN 'TLS_VERIFIED' ELSE 'TLS_REJECTED' END FROM pg_stat_ssl WHERE pid = pg_backend_pid()";
const TIMEOUT_MS=15000;
async function stagingTlsProbe(env,{spawnImpl=spawn}={}){
 if(!validate(env).ok)throw Error('STAGING_TLS_CONFIGURATION_BLOCKED');
 if(env.AZURE_AUTH_MODE!=='managed-identity'||!env.PGPASSFILE)
   throw Error('STAGING_TLS_CONFIGURATION_BLOCKED');
 const childEnv=limitedEnv(env,'pg');
 childEnv.PGCONNECT_TIMEOUT='10';
 childEnv.PGAPPNAME='campuspool-staging-tls-check';
 // Force libpq to connect to the exact vetted host with TLS verification.
 return new Promise((resolve,reject)=>{
   let child,finished=false,text='',size=0;
   const done=(error,value)=>{
     if(finished)return;
     finished=true;
     clearTimeout(timer);
     if(error)reject(Error('STAGING_TLS_HANDSHAKE_BLOCKED'));
     else resolve(value);
   };
   try{
     child=spawnImpl('psql',[
       '--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1',
       '--tuples-only','--no-align','--command',SQL
     ],{env:childEnv,stdio:['ignore','pipe','ignore']});
   }catch{return reject(Error('STAGING_TLS_HANDSHAKE_BLOCKED'));}
   const timer=setTimeout(()=>{
     child.kill('SIGKILL');
     done(true);
   },TIMEOUT_MS);
   child.stdout?.on('data',part=>{
     size+=part.length;
     if(size>512){child.kill('SIGKILL');done(true);return;}
     text+=part.toString('utf8');
   });
   child.once('error',()=>done(true));
   child.once('close',code=>{
     if(code!==0||text.trim()!=='TLS_VERIFIED')return done(true);
     done(false,{status:'STAGING_TLS_VERIFY_FULL_PASS',dataRead:false,backupCreated:false});
   });
 });
}
module.exports={SQL,stagingTlsProbe};
