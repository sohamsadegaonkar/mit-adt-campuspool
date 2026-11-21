'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg');
const {spawnSync}=require('node:child_process');
const {
 STAGES,manifest,expectedObjects,checkCatalog,detectStage,readCatalog
}=require('./scripts/migration-008-014-preflight');
const {validateTarget}=require('./scripts/reviewer-onboarding-preflight');
function fixture(version){
 const roles=[{name:'campuspool_staging_app',superuser:false,bypassrls:false,createRole:false,createDb:false}];
 const tables=['campus_users','campus_sessions','campus_rides','campus_bookings']
   .map(name=>({name,rls:true}));
 const columns=[],constraints=[],indexes=[],policies=[];
 for(const stage of STAGES.filter(s=>s.version<=version)){
   for(const [name,access] of Object.entries(stage.tables)){
     tables.push({name,rls:true,app:{select:true,insert:access!=='read',
       update:access==='rw',delete:access==='rw'},
       publicRead:false,publicWrite:false,anonRead:false,anonWrite:false,
       authRead:false,authWrite:false});
     const required=access==='rw'?['campuspool_backend_access']:
       access==='read'?['campuspool_backend_review_select']:
       stage.version===12?['campuspool_backend_case_read','campuspool_backend_case_write']:
       stage.version===13?['campuspool_backend_response_read','campuspool_backend_response_write']:
       ['campuspool_backend_review_select','campuspool_backend_review_insert'];
     required.forEach(name=>policies.push({name,table:name==='campuspool_backend_access'?stage.version===8?'campus_idempotency_keys':Object.keys(stage.tables)[0]:''}));
     policies.splice(policies.length-required.length,required.length,
       ...Object.keys(stage.tables).filter(t=>t===name).flatMap(t=>
         required.map(p=>({table:t,name:p,roles:['campuspool_staging_app']}))));
   }
   columns.push(...stage.columns);
   constraints.push(...stage.constraints.map(name=>({name,validated:true})));
   indexes.push(...stage.indexes);
 }
 return {roles,tables,columns,constraints,indexes,policies,migrationHashes:manifest()};
}
// Cleaner exact fixture: replace policies with each table's entitlement.
function catalog(stage){
 const f=fixture(stage);
 f.policies=[];
 for(const s of STAGES.filter(s=>s.version<=stage)){
   for(const [table,access] of Object.entries(s.tables)){
     const policies=access==='rw'?['campuspool_backend_access']:
       access==='read'?['campuspool_backend_review_select']:
       s.version===12?['campuspool_backend_case_read','campuspool_backend_case_write']:
       s.version===13?['campuspool_backend_response_read','campuspool_backend_response_write']:
       ['campuspool_backend_review_select','campuspool_backend_review_insert'];
     for(const name of policies)f.policies.push({table,name,roles:['campuspool_staging_app']});
   }
 }
 return f;
}
test('all migrations 008-014 present and manifest hashes form exactly one ordered chain',()=>{
 const entries=manifest();
 assert.deepEqual(entries.map(x=>x.version),[8,9,10,11,12,13,14]);
 for(const row of entries){assert.match(row.sha256,/^[a-f0-9]{64}$/);
   assert.match(row.filename,new RegExp('^0'+row.version+'_'));}
 assert.deepEqual([...expectedObjects(14).tables.keys()].sort(),
   ['campus_idempotency_keys','campus_booking_cases','campus_booking_case_events',
    'campus_booking_case_responses','campus_case_reviewer_grants',
    'campus_case_review_decisions','campus_case_appeals','campus_case_appeal_reviews'].sort());
});
test('seven staged snapshots plus pre-008 baseline pass; all are explicitly NO-GO',()=>{
 for(let version=7;version<=14;version++){
   const f=catalog(version),out=checkCatalog(f,version);
   assert.deepEqual(out.failures,[],String(version));
   assert.equal(detectStage(f),version);
   assert.equal(out.releaseReady,false);
   assert.equal(out.rollbackVerified,false);
   assert.equal(out.offsiteBackupVerified,false);
   assert.equal(out.migrationLedgerVerified,false);
 }
});
test('future objects in pre-migration DB and missing intermediate objects fail closed',()=>{
 let f=catalog(12);
 assert.ok(checkCatalog(f,11).failures.some(x=>x.startsWith('FUTURE_TABLE_PRESENT')));
 f=catalog(13);
 f.tables=f.tables.filter(x=>x.name!=='campus_booking_case_responses');
 assert.ok(checkCatalog(f,13).failures.includes('MISSING_TABLE:campus_booking_case_responses'));
 f=catalog(14);f.columns=f.columns.filter(x=>x!=='campus_bookings.boarding_pin_nonce');
 assert.ok(checkCatalog(f,14).failures.includes('MISSING_COLUMN:campus_bookings.boarding_pin_nonce'));
 f=catalog(14);f.indexes=f.indexes.filter(x=>x!=='campus_case_appeals_case_idx');
 assert.ok(checkCatalog(f,14).failures.includes('MISSING_INDEX:campus_case_appeals_case_idx'));
});
test('unvalidated constraints, permission escalation, public exposure and RLS loss block',()=>{
 const f=catalog(14);
 f.constraints.find(x=>x.name==='campus_booking_payment_mode_check').validated=false;
 f.tables.find(x=>x.name==='campus_case_reviewer_grants').app.insert=true;
 f.tables.find(x=>x.name==='campus_booking_cases').rls=false;
 f.tables.find(x=>x.name==='campus_case_appeals').anonRead=true;
 f.policies.find(x=>x.table==='campus_case_review_decisions').roles=['PUBLIC'];
 const failures=checkCatalog(f,14).failures.join(' ');
 for(const code of ['MISSING_OR_INVALID_CONSTRAINT','WRONG_APP_PRIVILEGES',
   'RLS_OFF','EXPOSED_TABLE','EXPOSED_POLICY'])assert.match(failures,new RegExp(code));
});
test('invalid version or corrupt manifest never grants release approval',()=>{
 const f=catalog(14);
 assert.throws(()=>checkCatalog(f,15));
 assert.throws(()=>checkCatalog(f,6));
 f.migrationHashes.pop();
 assert.ok(checkCatalog(f,14).failures.includes('MIGRATION_SOURCE_HASHES_MISSING'));
 f.migrationHashes=manifest();
 f.roles[0].bypassrls=true;
 assert.ok(checkCatalog(f,14).failures.includes('BACKEND_ROLE_NOT_LEAST_PRIVILEGE'));
});
test('validation does not recognize production or arbitrary cloud database targets',()=>{
 assert.equal(validateTarget('postgresql://postgres:synthetic@127.0.0.1:5432/campuspool_stage1_ci').kind,'disposable');
 for(const url of ['postgresql://postgres:synthetic@127.0.0.1:5432/postgres',
   'postgresql://postgres:synthetic@192.168.1.10:5432/campuspool_stage1_ci',
   'postgresql://postgres:synthetic@db.production.supabase.co/postgres',
   'postgresql://postgres:synthetic@db.tnitksrlntrdxbvznxzf.supabase.co/postgres?sslmode=disable'])
     assert.throws(()=>validateTarget(url));
});
test('preflight never has migration or restore write operations in its DB catalog read',()=>{
 const fs=require('node:fs');
 const script=fs.readFileSync('scripts/migration-008-014-preflight.js','utf8');
 const start=script.indexOf('async function readCatalog('),end=script.indexOf('async function main(',start);
 const section=script.slice(start,end);
 assert.match(section,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(section,/ROLLBACK/);
 assert.doesNotMatch(section,/client\.query\(['"](?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)/);
 assert.match(script,/offsiteBackupVerified:false/);
 assert.match(script,/releaseReady:false/);
});
test('real read-only PostgreSQL catalog detects 014 after synthetic migrations',{
 skip:process.env.SCHEMA_RECOVERY_SCHEMA_READY!=='YES'?'requires explicit migrated disposable PostgreSQL schema':false
},async()=>{
 const url=new URL(process.env.OTP_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.equal(url.pathname,'/campuspool_stage1_ci');
 const db=new Client({connectionString:process.env.OTP_DATABASE_URL,ssl:false});
 await db.connect();
 try{
   const data=await readCatalog(db);
   const out=checkCatalog(data,14);
   assert.equal(out.catalogMatches,true,JSON.stringify(out.failures));
   assert.equal(out.detectedStage,14);
   assert.equal(out.releaseReady,false);
   assert.equal(out.offsiteBackupVerified,false);
 }finally{await db.end();}
});
