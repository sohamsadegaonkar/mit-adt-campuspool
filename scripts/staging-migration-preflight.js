'use strict';
/**
 * Read-only, fail-closed preflight for the *dedicated* CampusPool Supabase
 * staging project. Does not apply SQL, take a backup or authorize deployment.
 */
const {Client}=require('pg');

const STAGING_REF='tnitksrlntrdxbvznxzf';
const APP_ROLE='campuspool_staging_app';
const TABLES=[
  'otp_challenges','otp_rate_buckets','campus_users','campus_sessions',
  'campus_identity_audit','campus_rides','campus_bookings',
  'campus_ride_geo','campus_trip_intents'
];
const RECEIPT_TABLE='campus_idempotency_keys';

function validateTarget(value){
  if(!value || typeof value!=='string')throw Error('Missing OTP_DATABASE_URL');
  let url;
  try{url=new URL(value);}catch{throw Error('Malformed PostgreSQL URL');}
  const validProtocol=['postgres:','postgresql:'].includes(url.protocol);
  const host=url.hostname.toLowerCase();
  const user=decodeURIComponent(url.username);
  const direct=host==='db.'+STAGING_REF+'.supabase.co';
  const pooler=host.endsWith('.pooler.supabase.com') && user.endsWith('.'+STAGING_REF);
  if(!validProtocol || !user || !url.password || !url.port && !direct ||
     !(direct||pooler) || url.pathname!=='/postgres' ||
     url.searchParams.get('sslmode')==='disable'){
    throw Error('Refusing database target: must match the dedicated staging Supabase project');
  }
  return {kind:direct?'staging-direct':'staging-pooler'};
}

function checkSnapshot(snapshot, mode='before'){
  if(mode!=='before'&&mode!=='after')throw Error('Unsupported mode');
  const failures=[],notes=[];
  const roles=new Map(snapshot.roles.map(r=>[r.rolname,r]));
  const role=roles.get(APP_ROLE);
  if(!role)failures.push('Staging backend role absent');
  else{
    if(!role.rolcanlogin)failures.push('Staging backend role cannot login');
    if(role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb)
      failures.push('Staging backend role is privileged');
  }
  for(const client of ['anon','authenticated']){
    if(!roles.has(client))failures.push(client+' API role absent; cannot prove isolation');
  }
  const schemas=new Map(snapshot.schemas.map(r=>[r.schema_name,r]));
  for(const schema of ['public','extensions']){
    const item=schemas.get(schema);
    if(!item||!item.backend_usage || item.backend_create)
      failures.push(schema+' schema permissions violate least privilege');
  }
  const tables=new Map(snapshot.tables.map(r=>[r.table_name,r]));
  const policyMap=new Map(snapshot.policies.map(r=>[r.tablename,r]));
  const installed=tables.has(RECEIPT_TABLE);
  const expected=mode==='after'?[...TABLES,RECEIPT_TABLE]:TABLES;
  for(const name of expected){
    const row=tables.get(name);
    if(!row){failures.push(name+' table absent');continue;}
    if(!row.rls)failures.push(name+' RLS not enabled');
    if(row.anon_read || row.anon_write || row.auth_read || row.auth_write)
      failures.push(name+' exposed to Supabase client role');
    if(!row.backend_read || !row.backend_insert || !row.backend_update ||
       !row.backend_delete) failures.push(name+' backend CRUD grants incomplete');
    const policies=snapshot.policies.filter(p=>p.tablename===name);
    const valid=policies.some(p=>{
      const roleList=Array.isArray(p.roles)?p.roles:String(p.roles).replace(/[{}]/g,'').split(',');
      return p.policyname==='campuspool_backend_access' &&
        roleList.includes(APP_ROLE) && p.cmd==='ALL' &&
        p.qual==='true' && p.with_check==='true';
    });
    if(!valid)failures.push(name+' backend RLS policy incomplete');
    if(policies.some(p=>{
      const roleList=Array.isArray(p.roles)?p.roles:String(p.roles).replace(/[{}]/g,'').split(',');
      return roleList.some(roleName=>['anon','authenticated','public'].includes(roleName.toLowerCase()));
    }))failures.push(name+' has client-accessible RLS policy');
  }
  if(mode==='before' && installed)failures.push('Migration 008 already appears installed; do not reapply blindly');
  if(mode==='after'){
    if(!installed)failures.push('Migration 008 receipt table absent');
    if(!snapshot.indexes.includes('campus_idempotency_expiry_idx'))
      failures.push('Migration 008 expiry index absent');
  }
  notes.push('Database metadata review only: no backup or independent restore is verified');
  notes.push('Render staging release and exact rollback SHA remain separate gates');
  return {
    target:'campuspool-staging-db',
    mode,receiptInstalled:installed,schemaReady:failures.length===0,
    releaseReady:false,failures,notes
  };
}

async function readSnapshot(client){
  // BEGIN READ ONLY blocks DML/DDL even if a future edit adds an accidental write.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout = 5000');
    const roles=(await client.query(
      "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname IN ('campuspool_staging_app','anon','authenticated')"
    )).rows;
    const schemas=(await client.query([
      "SELECT n.nspname AS schema_name,",
      "has_schema_privilege('campuspool_staging_app',n.oid,'USAGE') AS backend_usage,",
      "has_schema_privilege('campuspool_staging_app',n.oid,'CREATE') AS backend_create",
      "FROM pg_namespace n WHERE n.nspname IN ('public','extensions')"
    ].join(' '))).rows;
    const tables=(await client.query([
      "SELECT c.relname AS table_name,c.relrowsecurity AS rls,",
      "has_table_privilege('anon',c.oid,'SELECT') AS anon_read,",
      "has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') AS anon_write,",
      "has_table_privilege('authenticated',c.oid,'SELECT') AS auth_read,",
      "has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') AS auth_write,",
      "has_table_privilege('campuspool_staging_app',c.oid,'SELECT') AS backend_read,",
      "has_table_privilege('campuspool_staging_app',c.oid,'INSERT') AS backend_insert,",
      "has_table_privilege('campuspool_staging_app',c.oid,'UPDATE') AS backend_update,",
      "has_table_privilege('campuspool_staging_app',c.oid,'DELETE') AS backend_delete",
      "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
      "WHERE n.nspname='public' AND c.relkind IN ('r','p')",
      "AND c.relname = ANY($1::text[])"
    ].join(' '),[[...TABLES,RECEIPT_TABLE]])).rows;
    const policies=(await client.query([
      "SELECT tablename,policyname,roles,cmd,qual,with_check",
      "FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1::text[])"
    ].join(' '),[[...TABLES,RECEIPT_TABLE]])).rows;
    const indexes=(await client.query([
      "SELECT indexname FROM pg_indexes WHERE schemaname='public'",
      "AND tablename='campus_idempotency_keys'"
    ].join(' '))).rows.map(r=>r.indexname);
    await client.query('COMMIT');
    return {roles,schemas,tables,policies,indexes};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }
}

async function main({connectionString=process.env.OTP_DATABASE_URL,
  ssl=process.env.OTP_DB_SSL==='true',argv=process.argv.slice(2)}={}){
  if(argv.length!==1 || !['--mode=before','--mode=after'].includes(argv[0]))
    throw Error('Usage: --mode=before|--mode=after (read-only; no migration)');
  if(process.env.APP_ENV!=='staging')throw Error('APP_ENV must be staging');
  if(!ssl)throw Error('OTP_DB_SSL=true is required for staging preflight');
  validateTarget(connectionString);
  const client=new Client({connectionString,ssl:{rejectUnauthorized:true},
    connectionTimeoutMillis:5000,application_name:'campuspool_staging_readonly_preflight'});
  try{
    await client.connect();
    const snapshot=await readSnapshot(client);
    const result=checkSnapshot(snapshot,argv[0].slice('--mode='.length));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(!result.schemaReady)process.exitCode=1;
    return result;
  }finally{
    await client.end().catch(()=>{});
  }
}
if(require.main===module)main().catch(err=>{
  // Never log connection strings, URLs, SQL errors or credentials.
  console.error('[STAGING PREFLIGHT] Blocked:',err.code||'PRECONDITION_FAILED');
  process.exitCode=1;
});
module.exports={STAGING_REF,APP_ROLE,TABLES,RECEIPT_TABLE,validateTarget,checkSnapshot,readSnapshot,main};
