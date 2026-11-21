'use strict';
// Read-only schema/privilege drift check. NEVER performs a migration or rollback.
// This catalog inventory is NOT a version ledger or production GO evidence.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {validateTarget}=require('./reviewer-onboarding-preflight');

const APP_ROLE='campuspool_staging_app';
const STAGES=Object.freeze([
 {version:8,filename:'008_transactional_idempotency.sql',
   tables:{campus_idempotency_keys:'rw'},columns:[],constraints:['campus_idempotency_response_pair'],
   indexes:['campus_idempotency_expiry_idx']},
 {version:9,filename:'009_free_rides_pilot.sql',
   tables:{},columns:['campus_rides.payment_mode','campus_bookings.payment_mode'],
   constraints:['campus_ride_payment_mode_check','campus_booking_payment_mode_check','campus_booking_ride_payment_mode_fk'],
   indexes:['campus_rides_payment_mode_uidx']},
 {version:10,filename:'010_driver_reported_journey.sql',
   tables:{},columns:['campus_rides.journey_stage','campus_rides.departed_at',
     'campus_rides.pickup_at','campus_rides.arrived_at'],
   constraints:['campus_ride_journey_stage_check'],indexes:[]},
 {version:11,filename:'011_in_app_boarding_pin.sql',
   tables:{},columns:['campus_bookings.boarded_at','campus_bookings.boarding_pin_nonce',
     'campus_bookings.boarding_pin_expires_at','campus_bookings.boarding_pin_attempts'],
   constraints:['campus_booking_boarding_pin_check'],indexes:[]},
 {version:12,filename:'012_pickup_abort_cases.sql',
   tables:{campus_booking_cases:'append',campus_booking_case_events:'append'},
   columns:[],constraints:[],indexes:['campus_booking_case_events_case_idx','campus_booking_cases_opened_idx']},
 {version:13,filename:'013_private_case_responses.sql',
   tables:{campus_booking_case_responses:'append'},columns:[],constraints:[],
   indexes:['campus_case_responses_created_idx']},
 {version:14,filename:'014_case_review_appeals_foundation.sql',
   tables:{campus_case_reviewer_grants:'read',
     campus_case_review_decisions:'append',campus_case_appeals:'append',
     campus_case_appeal_reviews:'append'},
   columns:[],constraints:[],indexes:['campus_case_reviewer_grants_active_idx','campus_case_appeals_case_idx']}
]);
const BASE_TABLES=['campus_users','campus_sessions','campus_rides','campus_bookings'];
const ALL_TABLES=[...new Set([...BASE_TABLES,...STAGES.flatMap(s=>Object.keys(s.tables))])];
const SHA256=/^[a-f0-9]{64}$/;
function manifest(){
 const dir=path.resolve(__dirname,'../stage1-otp/migrations');
 return STAGES.map(stage=>{
   const filepath=path.join(dir,stage.filename);
   const sql=fs.readFileSync(filepath,'utf8');
   if(!sql.startsWith('-- ')||!/^BEGIN;\s*$/m.test(sql) || !/^COMMIT;\s*$/m.test(sql)
      ||!new RegExp('^-- (?:Additive migration|'+String(stage.version).padStart(3,'0')+':)').test(sql))
     throw Error('Migration file lacks an expected atomic version header');
   return {version:stage.version,filename:stage.filename,
     sha256:crypto.createHash('sha256').update(sql).digest('hex')};
 });
}
function validateStage(stage){
 if(!Number.isInteger(stage)||stage<7||stage>14)
   throw Error('Only exact migration states 007 through 014 are supported');
 return stage;
}
function expectedObjects(upto){
 const tables=new Map(),columns=new Set(),constraints=new Set(),indexes=new Set();
 for(const stage of STAGES){
   if(stage.version>upto)continue;
   for(const [name,access] of Object.entries(stage.tables))tables.set(name,access);
   stage.columns.forEach(x=>columns.add(x));stage.constraints.forEach(x=>constraints.add(x));
   stage.indexes.forEach(x=>indexes.add(x));
 }
 return {tables,columns,constraints,indexes};
}
function parsePolicyRoles(value){
 if(Array.isArray(value))return value.map(x=>String(x));
 if(typeof value==='string' && /^\{[^{}]*\}$/.test(value))
   return value.slice(1,-1).split(',').filter(Boolean).map(x=>x.replace(/^"|"$/g,''));
 return [];
}
function checkCatalog(data,expectedStage){
 validateStage(expectedStage);
 if(!data||typeof data!=='object')throw Error('Missing catalog snapshot');
 const failures=[];
 const expected=expectedObjects(expectedStage);
 const actualTables=new Map((data.tables||[]).map(x=>[x.name,x]));
 const actualColumns=new Set(data.columns||[]);
 const actualConstraints=new Map((data.constraints||[]).map(x=>[x.name,x]));
 const actualIndexes=new Set(data.indexes||[]);
 const roles=new Map((data.roles||[]).map(x=>[x.name,x]));
 const backend=roles.get(APP_ROLE);
 if(!backend || backend.superuser||backend.bypassrls||backend.createRole||backend.createDb)
   failures.push('BACKEND_ROLE_NOT_LEAST_PRIVILEGE');
 for(const table of BASE_TABLES){
   if(!actualTables.has(table)||!actualTables.get(table).rls)
     failures.push('BASE_TABLE_MISSING_OR_RLS_OFF:'+table);
 }
 for(const stage of STAGES){
   const installed=stage.version<=expectedStage;
   for(const [name,access] of Object.entries(stage.tables)){
     const row=actualTables.get(name);
     if(!installed){
       if(row)failures.push('FUTURE_TABLE_PRESENT:'+name);
       continue;
     }
     if(!row){failures.push('MISSING_TABLE:'+name);continue;}
     if(!row.rls)failures.push('RLS_OFF:'+name);
     const priv=row.app||{};
     if(priv.select!==true || priv.insert!==(access!=='read') ||
       priv.update!==(access==='rw') || priv.delete!==(access==='rw'))
       failures.push('WRONG_APP_PRIVILEGES:'+name);
     if(row.publicRead||row.publicWrite||row.anonRead||row.anonWrite||
       row.authRead||row.authWrite)
       failures.push('EXPOSED_TABLE:'+name);
     const policyRows=(data.policies||[]).filter(p=>p.table===name)
       .map(p=>({...p,roles:parsePolicyRoles(p.roles)}));
     const required=access==='rw'?['campuspool_backend_access']:
       access==='read'?['campuspool_backend_review_select']:
       stage.version===12?['campuspool_backend_case_read','campuspool_backend_case_write']:
       stage.version===13?['campuspool_backend_response_read','campuspool_backend_response_write']:
       ['campuspool_backend_review_select','campuspool_backend_review_insert'];
     for(const name of required){
       if(!policyRows.some(p=>p.name===name&&p.roles.includes(APP_ROLE)))
         failures.push('APP_POLICY_MISSING:'+row.name+':'+name);
     }
     if(policyRows.some(p=>p.roles.some(x=>['public','anon','authenticated'].includes(x.toLowerCase()))))
       failures.push('EXPOSED_POLICY:'+row.name);
   }
   for(const col of stage.columns){
     if(installed&&!actualColumns.has(col))failures.push('MISSING_COLUMN:'+col);
     if(!installed&&actualColumns.has(col))failures.push('FUTURE_COLUMN_PRESENT:'+col);
   }
   for(const constraint of stage.constraints){
     const has=actualConstraints.get(constraint);
     if(installed&&(!has||has.validated!==true))failures.push('MISSING_OR_INVALID_CONSTRAINT:'+constraint);
     if(!installed&&has)failures.push('FUTURE_CONSTRAINT_PRESENT:'+constraint);
   }
   for(const index of stage.indexes){
     if(installed&&!actualIndexes.has(index))failures.push('MISSING_INDEX:'+index);
     if(!installed&&actualIndexes.has(index))failures.push('FUTURE_INDEX_PRESENT:'+index);
   }
 }
 const hashes=data.migrationHashes;
 if(!Array.isArray(hashes)||hashes.length!==7||hashes.some(x=>!SHA256.test(x.sha256)))
   failures.push('MIGRATION_SOURCE_HASHES_MISSING');
 // Presence is NOT proof that migration history was recorded. The current
 // repository SQL uses IF NOT EXISTS but has no authoritative 008-014 ledger.
 return {expectedStage,detectedStage:detectStage(data),catalogMatches:failures.length===0,
   releaseReady:false,migrationLedgerVerified:false,
   rollbackVerified:false,offsiteBackupVerified:false,failures,
   notes:['Catalog drift check only; does not apply migration or authorize stage/prod.',
     'DDL object presence cannot replace a signed migration ledger.',
     'Rollback must use an independently restored, verified backup, never DROP TABLE in-place.']};
}
function detectStage(data){
 if(!data)return null;
 const tableNames=new Set((data.tables||[]).map(x=>x.name));
 const cols=new Set(data.columns||[]);
 const constraints=new Set((data.constraints||[]).filter(x=>x.validated).map(x=>x.name));
 const indexes=new Set(data.indexes||[]);
 let found=7;
 for(const stage of STAGES){
   const items=[
     ...Object.keys(stage.tables).map(x=>tableNames.has(x)),
     ...stage.columns.map(x=>cols.has(x)),
     ...stage.constraints.map(x=>constraints.has(x)),
     ...stage.indexes.map(x=>indexes.has(x))
   ];
   if(items.every(Boolean))found=stage.version;else break;
 }
 return found;
}
async function readCatalog(client){
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
   await client.query('SET LOCAL statement_timeout=5000');
   const query=async(sql,params=[])=> (await client.query(sql,params)).rows;
   const roles=await query([
     'SELECT rolname AS name,rolsuper AS superuser,rolbypassrls AS bypassrls,',
     'rolcreaterole AS "createRole",rolcreatedb AS "createDb"',
     'FROM pg_roles WHERE rolname=$1'
   ].join(' '),[APP_ROLE]);
   const tables=await query([
     'SELECT c.relname AS name,c.relrowsecurity AS rls,',
     "has_table_privilege($1,c.oid,'SELECT') AS app_select,",
     "has_table_privilege($1,c.oid,'INSERT') AS app_insert,",
     "has_table_privilege($1,c.oid,'UPDATE') AS app_update,",
     "has_table_privilege($1,c.oid,'DELETE') AS app_delete,",
     "EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0 AND a.privilege_type='SELECT') AS public_read,",
     "EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE')) AS public_write,",
     "CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_table_privilege(to_regrole('anon'),c.oid,'SELECT') END AS anon_read,",
     "CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_table_privilege(to_regrole('anon'),c.oid,'INSERT,UPDATE,DELETE') END AS anon_write,",
     "CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_table_privilege(to_regrole('authenticated'),c.oid,'SELECT') END AS auth_read,",
     "CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_table_privilege(to_regrole('authenticated'),c.oid,'INSERT,UPDATE,DELETE') END AS auth_write",
     'FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace',
     "WHERE n.nspname='public' AND c.relkind IN ('r','p')",
     'AND c.relname=ANY($2::text[])'
   ].join(' '),[APP_ROLE,ALL_TABLES]);
   const columns=await query([
     'SELECT table_name,column_name FROM information_schema.columns',
     "WHERE table_schema='public' AND table_name=ANY($1::text[])"
   ].join(' '),[ALL_TABLES]);
   const constraints=await query([
     'SELECT con.conname AS name,con.convalidated AS validated',
     'FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid',
     'JOIN pg_namespace n ON n.oid=c.relnamespace',
     "WHERE n.nspname='public' AND c.relname=ANY($1::text[])"
   ].join(' '),[ALL_TABLES]);
   const indexes=await query([
     'SELECT indexname AS name FROM pg_indexes',
     "WHERE schemaname='public' AND tablename=ANY($1::text[])"
   ].join(' '),[ALL_TABLES]);
   const policies=await query([
     'SELECT tablename AS "table",policyname AS name,roles',
     'FROM pg_policies WHERE schemaname=\'public\'',
     'AND tablename=ANY($1::text[])'
   ].join(' '),[ALL_TABLES]);
   await client.query('ROLLBACK');
   return {roles,tables:tables.map(x=>({
     name:x.name,rls:x.rls,
     app:{select:x.app_select,insert:x.app_insert,update:x.app_update,delete:x.app_delete},
     publicRead:x.public_read,publicWrite:x.public_write,
     anonRead:x.anon_read,anonWrite:x.anon_write,
     authRead:x.auth_read,authWrite:x.auth_write
   })),columns:columns.map(x=>x.table_name+'.'+x.column_name),
   constraints,indexes:indexes.map(x=>x.name),policies,
   migrationHashes:manifest()};
 }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   throw err;
 }
}
async function main(argv=process.argv.slice(2),env=process.env){
 if(argv.length!==1||!/^--expected-stage=0(?:07|08|09|10|11|12|13|14)$/.test(argv[0]))
   throw Error('Usage: --expected-stage=007..014; read-only');
 const expectedStage=Number(argv[0].slice(-3));
 const value=env.MIGRATION_PREFLIGHT_DB_URL;
 const target=validateTarget(value);
 if(target.kind==='staging'&&(env.MIGRATION_STAGING_READ_APPROVED!=='YES'||env.APP_ENV!=='staging'))
   throw Error('Separate staging read authorization and explicit opt-in required');
 if(target.kind==='disposable'&&env.SCHEMA_RECOVERY_DISPOSABLE_DB!=='YES')
   throw Error('Disposable CI schema read requires exact test-only opt-in');
 const client=new Client({connectionString:value,ssl:target.ssl?{rejectUnauthorized:true}:false,
   connectionTimeoutMillis:5000,query_timeout:5000,application_name:'campuspool-schema-gate-readonly'});
 try{
   await client.connect();
   const result=checkCatalog(await readCatalog(client),expectedStage);
   console.log('[MIGRATION PREFLIGHT] '+JSON.stringify({...result,
     migrationHashes:manifest()}));
   if(!result.catalogMatches)process.exitCode=1;
   return result;
 }finally{await client.end();}
}
if(require.main===module)main().catch(()=>{
 console.error('[MIGRATION PREFLIGHT] BLOCKED: unapproved target or schema drift. No changes made.');
 process.exitCode=1;
});
module.exports={STAGES,ALL_TABLES,manifest,expectedObjects,parsePolicyRoles,checkCatalog,
 detectStage,readCatalog,main};
