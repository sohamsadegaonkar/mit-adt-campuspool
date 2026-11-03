'use strict';
/** Operator-only, read-only verification of an independently restored staging DB. */
const {extractRef,STAGING_REF}=require('./staging-backup-guard');
const CORE=['campus_users','campus_sessions','campus_rides','campus_bookings','campus_trip_intents'];
const NAME=/^campus_[a-z0-9_]+$/;

function validatePlan(env){
  if(env.APP_ENV!=='staging' || env.RESTORE_TARGET_CONFIRMED!=='YES')
    throw Error('Staging and independent restore attestation required');
  const source=extractRef(env.STAGING_DB_URL);
  const target=extractRef(env.RESTORE_DB_URL);
  if(source!==STAGING_REF || target===source ||
     !/^[a-z0-9]{20}$/.test(env.RESTORE_PROJECT_REF||'') ||
     target!==env.RESTORE_PROJECT_REF)
    throw Error('Refusing unknown, same-project or non-staging recovery target');
  for(const raw of [env.STAGING_DB_URL,env.RESTORE_DB_URL]){
    const modes=new URL(raw).searchParams.getAll('sslmode');
    if(modes.length!==1 || !['require','verify-full'].includes(modes[0]))
      throw Error('Explicit SSL requirement missing');
  }
  return {sourceProject:source,restoreProject:target,readOnly:true,releaseReady:false};
}

function connectionConfig(raw){
  const u=new URL(raw);
  return {host:u.hostname,port:u.port?Number(u.port):5432,database:'postgres',
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    ssl:{rejectUnauthorized:true},connectionTimeoutMillis:8000,
    application_name:'campuspool_restore_compare'};
}

const QUERIES={
  tables:"SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'campus_%'",
  columns:"SELECT t.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expr,a.attidentity AS identity,a.attgenerated AS generated FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND t.relkind IN ('r','p') AND t.relname LIKE 'campus_%' AND a.attnum>0 AND NOT a.attisdropped",
  indexes:"SELECT t.relname AS table_name,i.relname AS name,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname LIKE 'campus_%'",
  constraints:"SELECT t.relname AS table_name,c.conname AS name,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname LIKE 'campus_%'",
  policies:"SELECT tablename AS table_name,policyname AS name,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'campus_%'",
  grants:"SELECT t.relname AS table_name,r.rolname AS name,has_table_privilege(r.oid,t.oid,'SELECT') AS can_select,has_table_privilege(r.oid,t.oid,'INSERT') AS can_insert,has_table_privilege(r.oid,t.oid,'UPDATE') AS can_update,has_table_privilege(r.oid,t.oid,'DELETE') AS can_delete FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND t.relkind IN ('r','p') AND t.relname LIKE 'campus_%' AND r.rolname IN ('anon','authenticated','campuspool_staging_app')",
  roles:"SELECT rolname AS name,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname IN ('anon','authenticated','campuspool_staging_app')",
  extensions:"SELECT extname AS name,extversion AS version FROM pg_extension WHERE extname IN ('postgis','pgcrypto','uuid-ossp')"
};
function sorted(rows){return rows.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function tableNamed(row){return NAME.test(row.table_name||row.name||'');}

// For a deliberately bounded, operator-controlled staging snapshot only.
// A larger table requires an independently reviewed streaming recovery verifier.
const MAX_DIGEST_ROWS=25000;
function digestSql(name){
  if(!NAME.test(name))throw Error('Unexpected table name');
  // Multiset SHA-256: equal row counts with different content cannot silently pass.
  // Hashes are computed inside PostgreSQL, never returned as records or printed.
  // to_jsonb provides normalized column-key order; hash sorting ignores row order
  // while retaining duplicates. Requires PostgreSQL >= 14 (tested on PG16 CI).
  return "SELECT encode(sha256(convert_to("+
    "COALESCE(string_agg(rowhash, '' ORDER BY rowhash COLLATE \"C\"), ''),'UTF8')),'hex') AS digest "+
    "FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS rowhash "+
    'FROM public."'+name+'" t) hashes';
}

async function snapshot(client){
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout = 15000');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    const result={};
    for(const [name,sql] of Object.entries(QUERIES)){
      const rows=(await client.query(sql)).rows;
      result[name]=sorted(['roles','extensions'].includes(name)?rows:rows.filter(tableNamed));
    }
    const names=result.tables.map(t=>t.name);
    if(!CORE.every(n=>names.includes(n)))throw Error('Core application tables missing');
    if(!result.roles.some(r=>r.name==='campuspool_staging_app'))
      throw Error('Backend role missing');
    result.counts=[];
    result.rowDigests=[];
    for(const name of names){
      if(!NAME.test(name))throw Error('Unexpected table name');
      const q='SELECT count(*)::text AS count FROM public."'+name+'"';
      const row=(await client.query(q)).rows[0];
      if(!row || !/^\d+$/.test(row.count))throw Error('Invalid table count');
      // Fail closed rather than loading potentially huge or sensitive table data.
      if(BigInt(row.count)>BigInt(MAX_DIGEST_ROWS))
        throw Error('Recovery fingerprint row limit exceeded; manual plan required');
      result.counts.push({name,count:row.count});
      const fingerprint=(await client.query(digestSql(name))).rows[0]?.digest;
      if(typeof fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(fingerprint))
        throw Error('Invalid recovery fingerprint');
      result.rowDigests.push({name,digest:fingerprint});
    }
    result.counts=sorted(result.counts);
    result.rowDigests=sorted(result.rowDigests);
    const marker=await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present");
    result.migrationHistoryPresent=marker.rows[0].present;
    if(result.migrationHistoryPresent){
      const history=await client.query('SELECT version::text AS version FROM supabase_migrations.schema_migrations ORDER BY version');
      result.migrationVersions=history.rows.map(r=>r.version);
    }else result.migrationVersions=[];
    await client.query('COMMIT');
    return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
function compare(source,target){
  const sections=[...Object.keys(QUERIES),'counts','rowDigests','migrationHistoryPresent','migrationVersions'];
  const mismatches=sections.filter(k=>JSON.stringify(source[k])!==JSON.stringify(target[k]));
  return {matches:mismatches.length===0,releaseReady:false,
    compared:sections,mismatches,
    notes:['SHA-256 row-content fingerprints are compared internally but never printed. This is bounded, point-in-time, logical-data verification, not proof of backup provenance or complete recovery.',
      'Private role credentials, provider-managed objects, remote ciphertext integrity and restore provenance remain unverified.',
      'A successful comparison does not authorize migration 008, staging deployment or production release.']};
}
async function main(env=process.env,argv=process.argv.slice(2)){
  if(argv.length!==1 || !['--preflight','--compare'].includes(argv[0]))
    throw Error('Usage: --preflight|--compare');
  const plan=validatePlan(env);
  if(argv[0]==='--preflight'){
    process.stdout.write(JSON.stringify({...plan,comparisonPerformed:false})+'\n');return;
  }
  const {Client}=require('pg');
  const src=new Client(connectionConfig(env.STAGING_DB_URL));
  const dst=new Client(connectionConfig(env.RESTORE_DB_URL));
  try{
    await src.connect();await dst.connect();
    const original=await snapshot(src);
    const restored=await snapshot(dst);
    const verdict=compare(original,restored);
    process.stdout.write(JSON.stringify({...plan,...verdict},null,2)+'\n');
    if(!verdict.matches)process.exitCode=1;
  }finally{
    await Promise.allSettled([src.end(),dst.end()]);
  }
}
if(require.main===module)main().catch(()=>{
  // Suppress database URL, host, SQL and server diagnostics, which can contain secrets.
  console.error('[RESTORE COMPARE] BLOCKED: precondition, connection or snapshot check failed.');
  process.exitCode=1;
});
module.exports={validatePlan,connectionConfig,snapshot,compare,QUERIES,digestSql,MAX_DIGEST_ROWS};
