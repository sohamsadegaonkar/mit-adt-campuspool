'use strict';
// Credential diagnostics only. No application-row reads, exports, role changes,
// migration, write freeze, or deployment. Never log raw connection errors.
const {Client}=require('pg');
const {parseBackupTarget,parsePinnedCa}=require('./staging-008-backup-guard');
const {TABLES,APP_ROLE}=require('./staging-migration-preflight');
const ADMIN_ACK='OWNER_APPROVED_STAGING_BACKUP_ADMIN_READ_ONLY_EXPORT';
const SQL=String.raw`SELECT
  current_user AS connected_role,
  current_database() = 'postgres' AS database_ok,
  current_setting('transaction_read_only') = 'on' AS read_only,
  current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AS pg17,
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations'
    AND has_schema_privilege(current_user,oid,'USAGE')) AS ledger_schema_access,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
    AND has_table_privilege(current_user,c.oid,'SELECT')) AS ledger_read,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])) AS app_tables,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','supabase_migrations') AND c.relkind IN ('r','p','m')
    AND (NOT has_schema_privilege(current_user,n.oid,'USAGE')
         OR NOT has_table_privilege(current_user,c.oid,'SELECT')
         OR row_security_active(c.oid))) AS tables_dump_readable,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','supabase_migrations') AND c.relkind='S'
    AND (NOT has_schema_privilege(current_user,n.oid,'USAGE')
         OR NOT has_sequence_privilege(current_user,c.oid,'SELECT'))) AS sequences_dump_readable,
  to_regclass('public.campus_idempotency_keys') IS NULL AS pre008`;
function config(env){
  if(env.APP_ENV!=='staging'||env.STAGING_CREDENTIAL_VALIDATION_ACK!=='STAGING_CREDENTIALS_READ_ONLY')
    throw Error('SCOPE');
  const adminAllowed=env.STAGING_VALIDATE_ADMIN==='true'&&env.STAGING_008_BACKUP_ADMIN_ACK===ADMIN_ACK;
  const target=parseBackupTarget(env.STAGING_BACKUP_DATABASE_URL,{allowAdmin:adminAllowed});
  if(target.port!==5432)throw Error('PORT');
  const role=target.user.split('.')[0];
  if(role!==APP_ROLE&&role!=='postgres')throw Error('ROLE');
  return {target,role,adminAllowed};
}
// Diagnostic labels are a fixed allowlist; never print URL components, raw errors,
// or secret values. The existing config() guard remains the sole authority.
function explainConfig(env){
  const checks={
    DIAG_STAGING_SCOPE:env.APP_ENV==='staging'&&env.STAGING_CREDENTIAL_VALIDATION_ACK==='STAGING_CREDENTIALS_READ_ONLY',
    DIAG_URL_PRESENT:typeof env.STAGING_BACKUP_DATABASE_URL==='string'&&env.STAGING_BACKUP_DATABASE_URL.length>0
  };
  let u;
  try{u=new URL(env.STAGING_BACKUP_DATABASE_URL);}catch{return {...checks,DIAG_URL_PARSE:false};}
  checks.DIAG_URL_PARSE=true;
  const project='tnitksrlntrdxbvznxzf';
  const direct=u.hostname==='db.'+project+'.supabase.co';
  const pooler=u.hostname.endsWith('.pooler.supabase.com');
  let user='',passwordValid=false;
  try{user=decodeURIComponent(u.username);}catch{}
  try{passwordValid=Boolean(decodeURIComponent(u.password));}catch{}
  const suffix=direct?'':'.'+project;
  const admin=user==='postgres'+suffix;
  const restricted=user===APP_ROLE+suffix;
  return {...checks,
    DIAG_PROTOCOL:['postgres:','postgresql:'].includes(u.protocol),
    DIAG_STAGING_PROJECT:direct||(pooler&&user.endsWith('.'+project)),
    DIAG_ROLE_NAME:admin||restricted,
    DIAG_PORT:direct?(!u.port||u.port==='5432'):u.port==='5432',
    DIAG_DATABASE_NAME:u.pathname==='/postgres',
    DIAG_PASSWORD_PRESENT:Boolean(u.password),
    DIAG_PASSWORD_ENCODING:passwordValid,
    DIAG_SSL_MODE:u.searchParams.get('sslmode')==='verify-full',
    DIAG_QUERY_PARAMETER_COUNT:u.searchParams.size===1,
    DIAG_NO_FRAGMENT:!u.hash,
    DIAG_ADMIN_INPUT:restricted||(admin&&env.STAGING_VALIDATE_ADMIN==='true'),
    DIAG_ADMIN_ACK:restricted||(admin&&env.STAGING_008_BACKUP_ADMIN_ACK===ADMIN_ACK)
  };
}
async function inspect(client){
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout = 5000');
    const r=await client.query(SQL,[TABLES]);
    if(r.rows.length!==1)throw Error('CATALOG');
    return r.rows[0];
  }finally{await client.query('ROLLBACK');}
}
function assess(row,role){
  return {
    DATABASE_IDENTITY:row.connected_role===role&&row.database_ok===true,
    READ_ONLY_TRANSACTION:row.read_only===true,
    POSTGRES_17:row.pg17===true,
    MIGRATION_LEDGER_ACCESS:row.ledger_schema_access===true&&row.ledger_read===true,
    PRE_008_APP_SCHEMA:row.app_tables===TABLES.length&&row.pre008===true,
    EXPORT_TABLE_READABILITY:row.tables_dump_readable===true,
    EXPORT_SEQUENCE_READABILITY:row.sequences_dump_readable===true
  };
}
async function validate(env=process.env,{ClientImpl=Client,emit=console.log,parseCa=parsePinnedCa}={}){
  const results={};
  const check=(name,ok)=>{results[name]=ok===true;emit(name+'='+(results[name]?'PASS':'FAIL'));};
  let c,target,role,ca;
  try{
    const opts=config(env);target=opts.target;role=opts.role;
    check('STAGING_TARGET_AND_ROLE',true);
    check('ADMIN_ACK_OR_RESTRICTED_ROLE',role===APP_ROLE||opts.adminAllowed);
  }catch{
    check('STAGING_TARGET_AND_ROLE',false);
    for(const [name,ok] of Object.entries(explainConfig(env)))check(name,ok);
  }
  try{ca=parseCa(env.STAGING_BACKUP_CA_PEM_B64);check('PINNED_CA_AND_VALIDITY',true);}
  catch{check('PINNED_CA_AND_VALIDITY',false);}
  if(!target||!ca)return {ok:false,results};
  try{
    c=new ClientImpl({host:target.hostname,port:target.port,user:target.user,password:target.password,
      database:target.database,ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,
      query_timeout:10000,application_name:'campuspool_staging_credential_diagnostic'});
    await c.connect();
    check('DATABASE_AUTHENTICATION',true);
    const stream=c.connection?.stream;
    const tls=stream?.encrypted===true&&stream?.authorized===true;
    check('TLS_VERIFY_FULL',tls);
    if(!tls)return {ok:false,results};
    let row;
    try{row=await inspect(c);}
    catch{check('READ_ONLY_CATALOG',false);return {ok:false,results};}
    check('READ_ONLY_CATALOG',true);
    for(const [name,ok] of Object.entries(assess(row,role)))check(name,ok);
  }catch{check('DATABASE_CONNECTION_OR_TLS',false);}
  finally{if(c)await c.end().catch(()=>{});}
  return {ok:Object.values(results).every(Boolean),results};
}
if(require.main===module)validate().then(r=>{
  console.log('DATABASE_WRITES=NO');
  console.log('REAL_DATABASE_EXPORT=NO');
  console.log('MIGRATION_EXECUTED=NO');
  console.log('PRODUCTION_TOUCHED=NO');
  console.log('CREDENTIAL_DIAGNOSTIC='+(r.ok?'PASS':'FAIL'));
  if(!r.ok)process.exitCode=1;
}).catch(()=>{console.error('CREDENTIAL_DIAGNOSTIC=FAIL');process.exitCode=1;});
module.exports={config,explainConfig,inspect,assess,validate,ADMIN_ACK,SQL};
