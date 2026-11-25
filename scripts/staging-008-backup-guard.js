'use strict';
// Read-only pre-image guard for an OWNER-APPROVED, manual staging-only backup.
// Never applies migrations, stores database data or outputs credentials.
const {Client}=require('pg');
const crypto=require('node:crypto');
const {validateTarget,readSnapshot,TABLES}=require('./staging-migration-preflight');
const {checkFrozenSnapshot,readAppRoleConnections,readWritableSequences}=require('./staging-008-freeze-verify');
const PROJECT='tnitksrlntrdxbvznxzf';
const CA_PIN='807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';
const REQUIRED_STAGING_ROLE='campuspool_staging_app';

function parseBackupTarget(value,{allowAdmin=false}={}){
  validateTarget(value);
  const url=new URL(value);
  if(url.searchParams.size!==1||url.searchParams.get('sslmode')!=='verify-full')
    throw Error('STAGING_TLS_VERIFY_FULL_REQUIRED');
  const isDirect=url.hostname==='db.'+PROJECT+'.supabase.co';
  const user=decodeURIComponent(url.username);
  const appRole=REQUIRED_STAGING_ROLE+(isDirect?'':'.'+PROJECT);
  const adminRole='postgres'+(isDirect?'':'.'+PROJECT);
  if(user!==appRole&&!(allowAdmin&&user===adminRole))
    throw Error('STAGING_BACKUP_ROLE_NOT_APPROVED');
  if(!url.password)throw Error('STAGING_BACKUP_CREDENTIAL_REQUIRED');
  if(!isDirect && url.port!=='5432')
    throw Error('STAGING_SESSION_POOLER_PORT_REQUIRED');
  if(url.hash)throw Error('STAGING_TARGET_FRAGMENT_REJECTED');
  return {hostname:url.hostname,port:Number(url.port)||5432,
    user,password:decodeURIComponent(url.password),database:'postgres'};
}
// libpq does not expand a URI supplied only as its PGDATABASE default.
// Keep credentials in the short-lived process environment, not argv or logs.
function dumpConnectionEnv(env){
  if(env.APP_ENV!=='staging'||env.OTP_DB_SSL!=='true'||
     env.STAGING_008_BACKUP_ACK!=='STAGING_008_PREIMAGE_ONLY')
    throw Error('STAGING_BACKUP_EXPLICIT_GUARDS_MISSING');
  const allowAdmin=env.STAGING_008_BACKUP_ADMIN_ACK===
    'OWNER_APPROVED_STAGING_BACKUP_ADMIN_READ_ONLY_EXPORT';
  const target=parseBackupTarget(env.STAGING_BACKUP_DATABASE_URL,{allowAdmin});
  if(target.port!==5432)throw Error('STAGING_SESSION_POOLER_PORT_REQUIRED');
  return {PGHOST:target.hostname,PGPORT:String(target.port),PGUSER:target.user,
    PGPASSWORD:target.password,PGDATABASE:target.database,
    PGSSLMODE:'verify-full',PGSSLROOTCERT:'/run/pinned-ca.pem'};
}
function parsePinnedCa(encoded){
  if(typeof encoded!=='string'||encoded.length<500||encoded.length>15000)
    throw Error('STAGING_CA_MISSING');
  const pem=Buffer.from(encoded,'base64').toString('utf8');
  const match=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if(!match||match.length!==1||
     pem.replace(match[0],'').trim()!=='')throw Error('STAGING_CA_UNEXPECTED_CERTIFICATE_CHAIN');
  let cert;
  try{cert=new crypto.X509Certificate(match[0]);}
  catch{throw Error('STAGING_CA_INVALID_X509');}
  if(crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase()!==CA_PIN)
    throw Error('STAGING_CA_FINGERPRINT_MISMATCH');
  if(Date.parse(cert.validTo)<=Date.now()||Date.parse(cert.validFrom)>Date.now())
    throw Error('STAGING_CA_EXPIRED_OR_NOT_YET_VALID');
  return pem;
}
function checkCountRows(rows,expectedHistory=7){
  if(!Array.isArray(rows)||rows.length!==TABLES.length+1)
    throw Error('STAGING_COUNT_SNAPSHOT_INCOMPLETE');
  const counts=new Map();
  for(const row of rows){
    if(![...TABLES,'supabase_migrations.schema_migrations'].includes(row.table_name)||
       counts.has(row.table_name)||!Number.isSafeInteger(Number(row.n))||Number(row.n)<0)
      throw Error('STAGING_COUNT_SNAPSHOT_MALFORMED');
    counts.set(row.table_name,Number(row.n));
  }
  if(TABLES.some(name=>!counts.has(name))||
     counts.get('supabase_migrations.schema_migrations')!==expectedHistory)
    throw Error('STAGING_MIGRATION_HISTORY_OR_TABLE_DRIFT');
  if(TABLES.some(name=>counts.get(name)!==0))
    throw Error('STAGING_APP_TABLES_NOT_EMPTY_FOR_008_SNAPSHOT');
  return {checkedApplicationTables:TABLES.length,totalApplicationRows:0,
    migrationHistoryCount:expectedHistory};
}
async function countReadOnly(client){
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout=5000');
    const rows=[];
    for(const name of TABLES){
      // Name chosen only from the compiled constant allowlist, never user input.
      const {rows:r}=await client.query('SELECT count(*)::int AS n FROM public.'+name);
      rows.push({table_name:name,n:r[0]?.n});
    }
    const {rows:r}=await client.query(
      'SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations');
    rows.push({table_name:'supabase_migrations.schema_migrations',n:r[0]?.n});
    await client.query('COMMIT');
    return checkCountRows(rows);
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }
}
async function guard(env=process.env){
  if(env.APP_ENV!=='staging'||env.OTP_DB_SSL!=='true'||
     env.STAGING_008_BACKUP_ACK!=='STAGING_008_PREIMAGE_ONLY')
    throw Error('STAGING_BACKUP_EXPLICIT_GUARDS_MISSING');
  // Supabase migration ledger is outside the app role's readable schemas.
  // A scope-limited dump of public+supabase_migrations may therefore need
  // the separately approved admin backup credential; never widen DB grants.
  const allowAdmin=env.STAGING_008_BACKUP_ADMIN_ACK===
    'OWNER_APPROVED_STAGING_BACKUP_ADMIN_READ_ONLY_EXPORT';
  const target=parseBackupTarget(env.STAGING_BACKUP_DATABASE_URL,{allowAdmin});
  const ca=parsePinnedCa(env.STAGING_BACKUP_CA_PEM_B64);
  const client=new Client({host:target.hostname,port:target.port,
    user:target.user,password:target.password,database:target.database,
    ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,
    application_name:'campuspool_staging_008_readonly_backup_gate'});
  try{
    await client.connect();
    const snapshot=await readSnapshot(client);
    const sessions=await readAppRoleConnections(client);
    const writableSequences=await readWritableSequences(client);
    const freeze=checkFrozenSnapshot(snapshot,sessions,writableSequences);
    if(!freeze.appRoleWriteFreezeVerified)
      throw Error('STAGING_APPLICATION_WRITE_FREEZE_NOT_ESTABLISHED');
    const counts=await countReadOnly(client);
    return {status:'STAGING_008_FROZEN_APPLICATION_PREIMAGE_PREFLIGHT',
      project:PROJECT,mode:'before',applicationWriteFreezeVerified:true,
      databaseWideWriteFreezeVerified:false,...counts,
      actualBackupCreated:false,restoreVerified:false,
      migrationAuthorizedByThisRun:false,releaseReady:false};
  }finally{await client.end().catch(()=>{});}
}
if(require.main===module){
  guard().then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
    .catch(()=>{process.stderr.write('STAGING_008_READ_ONLY_PREIMAGE_BLOCKED\n');process.exitCode=1;});
}
module.exports={parseBackupTarget,dumpConnectionEnv,parsePinnedCa,checkCountRows,countReadOnly,guard,CA_PIN};
