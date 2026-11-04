'use strict';
// Operator-only Cloudflare R2 backup. Does not write decrypted SQL to local disk.
// A verified encrypted upload is NOT evidence of a successful independent restore.
const crypto = require('node:crypto');
const {spawn,spawnSync} = require('node:child_process');
const {Transform} = require('node:stream');
const {STAGING_REF} = require('./staging-backup-guard');

const BUCKET='campuspool-staging-backups';
const REMOTE='campuspoolr2';

function validate(env=process.env){
  const violations=[];
  const want=(ok,code)=>{if(!ok)violations.push(code);};
  // Use libpq's environment variables: a DB password never goes into argv.
  want(env.PGUSER==='postgres.'+STAGING_REF,'STAGING_ROLE_ONLY');
  want(typeof env.PGHOST==='string' &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(env.PGHOST),'STAGING_POOLER_HOST_ONLY');
  want(env.PGPORT==='5432'&&env.PGDATABASE==='postgres','STAGING_DATABASE_ONLY');
  want(env.PGSSLMODE==='verify-full','TLS_CERTIFICATE_VERIFICATION_REQUIRED');
  want(typeof env.PGPASSWORD==='string' && env.PGPASSWORD.length>0,'PRIVATE_DB_PASSWORD_REQUIRED');
  want(env.R2_BACKUP_BUCKET===BUCKET,'DEDICATED_R2_BUCKET_REQUIRED');
  want(env.R2_BACKUP_REMOTE===REMOTE,'DEDICATED_R2_REMOTE_REQUIRED');
  want(typeof env.AGE_RECIPIENT==='string' &&
    /^age1[0-9a-z]{45,90}$/.test(env.AGE_RECIPIENT),'AGE_PUBLIC_RECIPIENT_REQUIRED');

  // Rclone supports RCLONE_CONFIG_<REMOTE>_* environment-only credentials.
  // Never persist a credential-bearing ~/.config/rclone/rclone.conf on unencrypted D:.
  const prefix='RCLONE_CONFIG_CAMPUSPOOLR2_';
  want(env[prefix+'TYPE']==='s3' &&
    String(env[prefix+'PROVIDER']).toLowerCase()==='cloudflare','R2_S3_ENV_CONFIG_REQUIRED');
  want(typeof env[prefix+'ENDPOINT']==='string' &&
    /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(env[prefix+'ENDPOINT']),
    'R2_ACCOUNT_ENDPOINT_REQUIRED');
  want(!!env[prefix+'ACCESS_KEY_ID'] && !!env[prefix+'SECRET_ACCESS_KEY'],
    'BUCKET_SCOPED_R2_KEYS_REQUIRED');
  want(env[prefix+'ACL']===undefined || env[prefix+'ACL']==='private',
    'R2_PRIVATE_ACL_REQUIRED');
  want(env.R2_PRIVATE_BUCKET_CONFIRMED==='YES','PRIVATE_BUCKET_ATTESTATION_REQUIRED');
  return {ready:violations.length===0,violations};
}
function args(argv=process.argv.slice(2)){
  if(argv.length!==1 || !['--preflight','--execute'].includes(argv[0]))throw Error('USAGE');
  return argv[0];
}
function redactChildEnv(env){
  const child={...env};
  delete child.STAGING_DB_URL;
  delete child.RESTORE_DB_URL;
  delete child.AGE_IDENTITY;
  delete child.PGURI;
  return child;
}
function wait(child){
  return new Promise((resolve,reject)=>{
    child.once('error',()=>reject(Error('CHILD_START_FAILED')));
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
}
function commandOk(program,argv){
  try{return spawnSync(program,argv,{stdio:'ignore',timeout:5000}).status===0;}
  catch(_){return false;}
}
function preflight(env=process.env,{checkCommands=commandOk}={}){
  const config=validate(env);
  const binaries=['pg_dump','age','rclone'];
  const missing=binaries.filter(bin=>!checkCommands(bin,
    bin==='rclone'?['version']:['--version']));
  let pg17=false;
  if(!missing.includes('pg_dump')){
    try{
      const x=spawnSync('pg_dump',['--version'],{encoding:'utf8',timeout:5000});
      pg17=x.status===0 && /\b17\.\d+\b/.test(x.stdout||'');
    }catch(_){}
  }
  if(!pg17)config.violations.push('POSTGRES_17_CLIENT_REQUIRED');
  if(missing.length)config.violations.push(...missing.map(x=>'MISSING_'+x.toUpperCase()));
  return {ready:config.violations.length===0,violations:config.violations};
}
function objectKey(now=new Date(),random=crypto.randomBytes(16)){
  return 'staging/'+now.toISOString().replace(/[:.]/g,'-')+
    '-'+random.toString('hex')+'.pgdump.age';
}
function child(program,argv,env,spawnImpl=spawn){
  return spawnImpl(program,argv,{env,stdio:['pipe','pipe','ignore'],
    timeout:20*60*1000});
}
async function backup(env=process.env,
  {spawnImpl=spawn,clock=new Date(),random=crypto.randomBytes(16)}={}){
  const validation=validate(env);
  if(!validation.ready)throw Error('CONFIG_BLOCKED');
  if(env.R2_EXECUTE_CONFIRMED!=='YES')throw Error('EXECUTE_NOT_AUTHORIZED');
  const key=objectKey(clock,random);
  const object=REMOTE+':'+BUCKET+'/'+key;
  const pgEnv=redactChildEnv(env);
  // One pg_dump transaction => consistent snapshot of both schemas; global
  // PostgreSQL roles and Supabase-managed schemas are NOT in this archive.
  const dump=child('pg_dump',['--format=custom','--schema=public',
    '--schema=supabase_migrations','--no-password','--file=-'],pgEnv,spawnImpl);
  const encrypt=child('age',['--encrypt','--recipient',env.AGE_RECIPIENT],pgEnv,spawnImpl);
  const upload=child('rclone',['rcat',object,'--s3-no-check-bucket'],pgEnv,spawnImpl);
  let count=0;
  const hash=crypto.createHash('sha256');
  const tally=new Transform({transform(buf,encoding,done){
    count+=buf.length;hash.update(buf);done(null,buf);
  }});
  // Avoid accidental process crash from EPIPE; exit status still blocks success.
  for(const s of [dump.stdout,encrypt.stdin,encrypt.stdout,upload.stdin,tally])
    s.on('error',()=>{});
  // Set up exit listeners before starting pipes; avoid missing fast child exits.
  const exitsWait=Promise.all([wait(dump),wait(encrypt),wait(upload)]);
  dump.stdout.pipe(encrypt.stdin);
  encrypt.stdout.pipe(tally).pipe(upload.stdin);
  const exits=await exitsWait;
  if(exits.some(x=>x.code!==0)||count<50)throw Error('STREAMING_UPLOAD_FAILED');
  const localDigest=hash.digest('hex');
  // New remote read verifies ciphertext; does NOT decrypt or restore data.
  const download=child('rclone',['cat',object],pgEnv,spawnImpl);
  download.stdin.end();
  const downloadExit=wait(download);
  let checkedBytes=0;
  const verifyHash=crypto.createHash('sha256');
  for await(const buf of download.stdout){
    checkedBytes+=buf.length;
    verifyHash.update(buf);
  }
  const finish=await downloadExit;
  if(finish.code!==0 || checkedBytes!==count || verifyHash.digest('hex')!==localDigest)
    throw Error('R2_READBACK_CHECKSUM_MISMATCH');
  return {status:'CIPHERTEXT_ROUNDTRIP_VERIFIED_RESTORE_NOT_TESTED',
    objectKey:key,bytes:count,ciphertextSHA256:localDigest};
}
async function main(argv=process.argv.slice(2),env=process.env){
  let mode;
  try{mode=args(argv);}
  catch(_){process.stderr.write('R2_BACKUP_ERROR USAGE --preflight|--execute\n');return 2;}
  const check=preflight(env);
  if(!check.ready){
    for(const code of check.violations)process.stderr.write('BLOCK '+code+'\n');
    return 1;
  }
  if(mode==='--preflight'){
    process.stdout.write('R2_BACKUP_PREFLIGHT_PASSED no remote read/write or database query\n');
    return 0;
  }
  try{
    const result=await backup(env);
    process.stdout.write(JSON.stringify(result)+'\n');return 0;
  }catch(_){
    process.stderr.write('R2_BACKUP_BLOCKED export/upload/checksum failure; no recovery approval\n');
    return 1;
  }
}
if(require.main===module)main().then(code=>{process.exitCode=code;});
module.exports={BUCKET,REMOTE,validate,redactChildEnv,preflight,objectKey,backup,args,main};
