'use strict';
// Operator-only, local AGE encryption before private Azure Blob upload.
// An uploaded blob DOES NOT prove independent database recovery.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {Transform,Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {STAGING_REF}=require('./staging-backup-guard');
const ACCOUNT='011campuspoolbackup';
const CONTAINER='campuspool-staging-backups';
function validate(env){
  const errors=[],check=(ok,why)=>{if(!ok)errors.push(why)};
  check(env.PGUSER==='postgres.'+STAGING_REF,'STAGING_PGUSER');
  check(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(env.PGHOST||''),'STAGING_PGHOST');
  check(env.PGPORT==='5432' && env.PGDATABASE==='postgres','STAGING_PG_DATABASE');
  check(env.PGSSLMODE==='verify-full','VERIFIED_TLS_REQUIRED');
  check(!!env.PGPASSWORD,'PGPASSWORD_REQUIRED');
  check(env.AZURE_STORAGE_ACCOUNT===ACCOUNT,'AZURE_ACCOUNT_ALLOWLIST');
  check(env.AZURE_BACKUP_CONTAINER===CONTAINER,'PRIVATE_CONTAINER_ALLOWLIST');
  check(env.AZURE_PRIVATE_CONTAINER_CONFIRMED==='YES','PRIVATE_CONTAINER_NOT_VERIFIED');
  check(/^age1[0-9a-z]{45,90}$/.test(env.AGE_RECIPIENT||''),'AGE_PUBLIC_RECIPIENT');
  // azure login tokens must be cached in temporary Linux RAM, never unencrypted C:/D:.
  let ram=false;
  try{
    const real=fs.realpathSync(env.AZURE_CONFIG_DIR||'');
    const type=fs.statfsSync(real).type;
    const mode=fs.statSync(real).mode & 0o777;
    ram=real.startsWith('/dev/shm/') && type===0x01021994 && mode===0o700;
  }catch(_){}
  check(ram,'AZURE_CLI_AUTH_CACHE_MUST_BE_PRIVATE_TMPFS');
  return {ok:errors.length===0,errors};
}
function limitedEnv(env,kind){
  if(!['pg','age'].includes(kind))throw Error('INVALID_CHILD');
  const result={};
  for(const k of ['PATH','HOME','LANG','SSL_CERT_FILE','SSL_CERT_DIR'])
    if(typeof env[k]==='string')result[k]=env[k];
  if(kind==='pg')for(const k of ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD',
    'PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT'])
    if(typeof env[k]==='string')result[k]=env[k];
  return result;
}
function keyAt(now=new Date(),nonce=crypto.randomBytes(16)){
  return 'staging/'+now.toISOString().replace(/[:.]/g,'-')+'-'+nonce.toString('hex')+'.pgdump.age';
}
function versionOk(bin,regex){
  try{
    const v=spawnSync(bin,['--version'],{encoding:'utf8',timeout:5000});
    return v.status===0 && regex.test((v.stdout||'')+(v.stderr||''));
  }catch(_){return false;}
}
function preflight(env=process.env,overrides={}){
  const v=validate(env);
  const commands=overrides.versionOk||versionOk;
  if(!commands('pg_dump',/\b17\.\d+\b/))v.errors.push('POSTGRES_17_PG_DUMP_REQUIRED');
  if(!commands('age',/\b(?:age\s+)?v?\d+\.\d+\.\d+\b/i))v.errors.push('AGE_CLI_REQUIRED');
  if(!commands('az',/azure-cli/i))v.errors.push('AZURE_CLI_REQUIRED');
  try{
    (overrides.loadSdk||loadSdk)();
  }catch(_){v.errors.push('AZURE_NODE_SDK_REQUIRED');}
  v.ok=v.errors.length===0;
  return v;
}
function loadSdk(){
  return {
    BlobServiceClient:require('@azure/storage-blob').BlobServiceClient,
    AzureCliCredential:require('@azure/identity').AzureCliCredential
  };
}
function exit(child){
  return new Promise((resolve,reject)=>{
    child.once('error',()=>reject(Error('BACKUP_CHILD_LAUNCH_FAILED')));
    child.once('close',(code)=>resolve(code));
  });
}
function spawnChild(bin,args,env,spawnImpl=spawn){
  return spawnImpl(bin,args,{env,stdio:['pipe','pipe','ignore']});
}
async function run(env,{spawnImpl=spawn,loadSdkImpl=loadSdk,now=new Date(),
  nonce=crypto.randomBytes(16)}={}){
  if(!validate(env).ok)throw Error('BACKUP_CONFIGURATION_BLOCKED');
  if(env.AZURE_EXPORT_APPROVED!=='YES')throw Error('EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
  const {BlobServiceClient,AzureCliCredential}=loadSdkImpl();
  const credential=new AzureCliCredential();
  const client=new BlobServiceClient('https://'+ACCOUNT+'.blob.core.windows.net',credential);
  const container=client.getContainerClient(CONTAINER);
  const key=keyAt(now,nonce);
  const blob=container.getBlockBlobClient(key);
  const dump=spawnChild('pg_dump',['--format=custom','--schema=public',
    '--schema=supabase_migrations','--no-password','--file=-'],
    limitedEnv(env,'pg'),spawnImpl);
  const age=spawnChild('age',['--encrypt','--recipient',env.AGE_RECIPIENT],
    limitedEnv(env,'age'),spawnImpl);
  const hash=crypto.createHash('sha256');
  let bytes=0;
  const encrypted=new Transform({transform(chunk,_enc,cb){
    bytes+=chunk.length;hash.update(chunk);cb(null,chunk);
  }});
  const pDump=exit(dump),pAge=exit(age);
  const pPipe=pipeline(dump.stdout,age.stdin);
  const pEncrypt=pipeline(age.stdout,encrypted);
  const upload=blob.uploadStream(encrypted,4*1024*1024,2,{
    conditions:{ifNoneMatch:'*'},
    blobHTTPHeaders:{blobContentType:'application/octet-stream'}
  });
  const outcomes=await Promise.allSettled([pDump,pAge,pPipe,pEncrypt,upload]);
  // Prefer an upload error when a failed remote upload causes an upstream EPIPE.
  // Never print driver exceptions: they can contain URLs, account IDs or tokens.
  const stages=['POSTGRES_DUMP_FAILED','AGE_ENCRYPTION_FAILED',
    'POSTGRES_STREAM_FAILED','AGE_STREAM_FAILED','AZURE_UPLOAD_FAILED'];
  const failed=outcomes.some((r,i)=>r.status==='rejected'||(i<2&&r.value!==0));
  if(failed||bytes<50){
    dump.kill();age.kill();
    if(outcomes[4].status==='rejected')throw Error(stages[4]);
    const index=outcomes.findIndex((r,i)=>r.status==='rejected'||(i<2&&r.value!==0));
    if(index>=0)throw Error(stages[index]);
    throw Error('ENCRYPTED_STREAM_TOO_SMALL');
  }
  const digest=hash.digest('hex');
  let downloaded;
  try{downloaded=await blob.download();}
  catch(_){throw Error('AZURE_READBACK_FAILED');}
  if(!downloaded.readableStreamBody)throw Error('AZURE_READBACK_FAILED');
  let received=0;
  const verify=crypto.createHash('sha256');
  try{
    for await(const chunk of downloaded.readableStreamBody){
      received+=chunk.length;verify.update(chunk);
    }
  }catch(_){throw Error('AZURE_READBACK_FAILED');}
  if(received!==bytes||verify.digest('hex')!==digest)
    throw Error('AZURE_CIPHERTEXT_SHA256_MISMATCH');
  return {status:'AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED',
    objectKey:key,bytes,ciphertextSHA256:digest};
}
async function main(argv=process.argv.slice(2),env=process.env){
  if(argv.length!==1||!['--preflight','--execute'].includes(argv[0])){
    process.stderr.write('Usage: node scripts/azure-blob-backup.js --preflight|--execute\n');return 2;
  }
  const p=preflight(env);
  if(!p.ok){
    for(const e of p.errors)process.stderr.write('BLOCK '+e+'\n');
    return 1;
  }
  if(argv[0]==='--preflight'){
    process.stdout.write('AZURE_PREFLIGHT_PASS; no database or blob contacted\n');return 0;
  }
  try{
    const result=await run(env);
    process.stdout.write(JSON.stringify(result)+'\n');return 0;
  }catch(error){
    // Stable error categories only. Never echo raw driver errors or secret values.
    const allowed=new Set(['BACKUP_CONFIGURATION_BLOCKED','EXPLICIT_OPERATOR_APPROVAL_REQUIRED',
      'BACKUP_CHILD_LAUNCH_FAILED','POSTGRES_DUMP_FAILED','AGE_ENCRYPTION_FAILED',
      'POSTGRES_STREAM_FAILED','AGE_STREAM_FAILED','AZURE_UPLOAD_FAILED',
      'ENCRYPTED_STREAM_TOO_SMALL','AZURE_READBACK_FAILED',
      'AZURE_CIPHERTEXT_SHA256_MISMATCH']);
    const code=allowed.has(error?.message)?error.message:'UNCLASSIFIED_FAILURE';
    process.stderr.write('AZURE_BACKUP_BLOCKED '+code+'; no verified backup/restore\n');
    return 1;
  }
}
if(require.main===module)main().then(code=>{process.exitCode=code;});
module.exports={ACCOUNT,CONTAINER,validate,limitedEnv,preflight,keyAt,run,main};
