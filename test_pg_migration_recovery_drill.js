'use strict';
// REAL PostgreSQL 16 + PostGIS recovery drill against three ephemeral local CI
// databases ONLY. No staging, Azure, Supabase, production or student data.
// Rollback = restore a PRE-UPGRADE archive into a SEPARATE DB, not DOWN SQL.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {execFileSync}=require('node:child_process');
const {readCatalog,checkCatalog}=require('./scripts/migration-008-014-preflight');

const enabled=process.env.RECOVERY_008_014_DISPOSABLE_DB==='YES';
const url=process.env.OTP_DATABASE_URL;
function verifyIsolation(){
 assert.equal(enabled,true,'Explicit recovery drill consent required');
 assert.ok(url,'Missing disposable CI connection string');
 const u=new URL(url);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));
 assert.equal(u.pathname,'/campuspool_stage1_ci');
 assert.equal(u.search,'');assert.equal(u.hash,'');
 assert.equal(u.port,'5432');
 assert.match(process.env.POSTGIS_CI_CONTAINER_ID||'',/^[a-f0-9]{12,64}$/);
 return u;
}
function uri(base,name){const u=new URL(base);u.pathname='/'+name;return u.toString();}
function safeName(n){assert.match(n,/^cp_(?:fwd|pre|post)_[a-f0-9]{12}$/);return '"'+n+'"';}
async function conn(value){const client=new Client({connectionString:value,ssl:false,
 connectionTimeoutMillis:5000});await client.connect();return client;}
function dockerPg(base,command,db,input){
 const u=new URL(base);
 assert.match(db,/^cp_(?:fwd|pre|post)_[a-f0-9]{12}$/);
 assert.ok(['pg_dump','pg_restore'].includes(command));
 const env=decodeURIComponent(u.password);
 const args=['exec','-i','-e','PGPASSWORD='+env,
   process.env.POSTGIS_CI_CONTAINER_ID,command,
   '-h','127.0.0.1','-p','5432','-U',decodeURIComponent(u.username)];
 if(command==='pg_dump')
   args.push('--format=custom','--no-owner','--dbname',db);
 else args.push('--exit-on-error','--no-owner','--dbname',db);
 try{
   return execFileSync('docker',args,{
     input:input||undefined,timeout:100000,
     stdio:['pipe','pipe','pipe'],maxBuffer:20*1024*1024});
 }catch(error){
   // Do not print connection strings/PGPASSWORD; strictly test-only counts.
   throw Error('Disposable '+command+' failed (redacted)');
 }
}
function seal(bytes){
 assert.equal(bytes.subarray(0,5).toString('ascii'),'PGDMP');
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const result=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const encrypted=Buffer.concat([iv,cipher.getAuthTag(),result]);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));
 decipher.setAuthTag(encrypted.subarray(12,28));
 const raw=Buffer.concat([decipher.update(encrypted.subarray(28)),decipher.final()]);
 assert.equal(raw.subarray(0,5).toString('ascii'),'PGDMP');
 assert.deepEqual(crypto.createHash('sha256').update(raw).digest(),
   crypto.createHash('sha256').update(bytes).digest());
 const corrupt=Buffer.from(encrypted);
 corrupt[corrupt.length-1]^=0x01;
 assert.throws(()=>{
   const dec=crypto.createDecipheriv('aes-256-gcm',key,corrupt.subarray(0,12));
   dec.setAuthTag(corrupt.subarray(12,28));
   Buffer.concat([dec.update(corrupt.subarray(28)),dec.final()]);
 },'a tampered archive must fail authentication');
 key.fill(0);
 return {encrypted,recovered:raw};
}
async function migrate(db,version){
 const filenames=fs.readdirSync(path.join(__dirname,'stage1-otp','migrations'));
 const file=filenames.find(x=>x.startsWith(String(version).padStart(3,'0')+'_')&&x.endsWith('.sql'));
 assert.ok(file,'Missing migration SQL '+version);
 const sql=fs.readFileSync(path.join(__dirname,'stage1-otp','migrations',file),'utf8');
 await db.query(sql);
}
async function countDigest(db,tables){
 const result={};
 for(const name of tables){
   assert.match(name,/^campus_[a-z_]+$/);
   const q=await db.query(
     'SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text,\'|\' ORDER BY to_jsonb(t)::text),\'\')) AS digest FROM public.'+name+' t');
   result[name]=q.rows[0];
 }
 return result;
}
async function legacyDigest(db){
 // Compare original columns only: additive migrations 009-011 add fields
 // with defaults, so whole-row JSON hashes would give false migration drift.
 const tables={
   campus_users:[],
   campus_rides:['payment_mode','journey_stage','departed_at','pickup_at','arrived_at'],
   campus_bookings:['payment_mode','boarded_at','boarding_pin_nonce',
     'boarding_pin_expires_at','boarding_pin_attempts']
 };
 const out={};
 for(const [table,added] of Object.entries(tables)){
   const base=added.length?'to_jsonb(t)-ARRAY['+
     added.map(x=>"'"+x+"'").join(',')+']':'to_jsonb(t)';
   const q=await db.query(
     'SELECT count(*)::int AS n,md5(coalesce(string_agg(('+base+
     ')::text,\'|\' ORDER BY ('+base+')::text),\'\')) AS digest FROM public.'+table+' t');
   out[table]=q.rows[0];
 }
 return out;
}
async function seed007(db){
 const identities=Array.from({length:5},()=>crypto.randomUUID());
 for(let i=0;i<identities.length;i++)
   await db.query([
     'INSERT INTO public.campus_users(id,name,email,phone,dept,is_verified)',
     'VALUES($1,$2,$3,$4,$5,true)'
   ].join(' '),[identities[i],'Synthetic '+i,
      'synthetic'+i+'@students.mituniversity.edu.in',
      '98765432'+String(i).padStart(2,'0'),'CI']);
 const ride='ride_'+crypto.randomUUID(),active='BKG-'+crypto.randomUUID(),
   cancelled='BKG-'+crypto.randomUUID();
 await db.query([
   'INSERT INTO public.campus_rides(',
   'id,driver_user_id,driver_name,driver_email,driver_phone,dept,vehicle,',
   'vehicle_model,pickup,destination,departure_time,seats_total,seats_left,',
   'uber_benchmark,student_fare,driver_payout,note,upi_id,status)',
   "VALUES($1,$2,'Synthetic driver','driver@example.invalid','9999999999',",
   "'CI','Car','Synthetic Car','Synthetic gate','Synthetic hostel',",
   "'2027-01-02T09:00:00',2,1,80,40,36,'CI only','','active')"
 ].join(' '),[ride,identities[0]]);
 for(const [booking,user,status] of [
   [active,identities[1],'active'],[cancelled,identities[2],'cancelled']
 ]){
   await db.query([
     'INSERT INTO public.campus_bookings(',
     'booking_id,ride_id,passenger_user_id,passenger_name,passenger_email,',
     'driver_name,driver_email,driver_phone,dept,vehicle_model,pickup,',
     'destination,departure_time,student_fare,payment_status,upi_id,status,cancelled_at)',
     "VALUES($1,$2,$3,'Synthetic rider','synthetic@example.invalid',",
     "'Synthetic driver','driver@example.invalid','9999999999',",
     "'CI','Synthetic Car','Synthetic gate','Synthetic hostel',",
     "'2027-01-02T09:00:00',40,'Pending','',$4,",
     "CASE WHEN $4='cancelled' THEN clock_timestamp() ELSE NULL END)"
   ].join(' '),[booking,ride,user,status]);
 }
 return {identities,ride,active,cancelled};
}
async function seed014(db,ids){
 const addCase=await db.query(
   'INSERT INTO public.campus_booking_cases(booking_id) VALUES($1) RETURNING id',
   [ids.cancelled]);
 const caseId=addCase.rows[0].id;
 await db.query([
   'INSERT INTO public.campus_booking_case_events',
   '(case_id,actor_user_id,actor_role,reason)',
   "VALUES($1,$2,'passenger','no_response'),($1,$3,'driver','other')"
 ].join(' '),[caseId,ids.identities[2],ids.identities[0]]);
 await db.query([
   'INSERT INTO public.campus_booking_case_responses',
   '(case_id,actor_user_id,actor_role,response_code)',
   "VALUES($1,$2,'passenger','could_not_find_partner'),",
   "($1,$3,'driver','attempted_contact')"
 ].join(' '),[caseId,ids.identities[2],ids.identities[0]]);
 await db.query([
   'INSERT INTO public.campus_case_reviewer_grants',
   '(user_id,reviewer_role,expires_at)',
   "VALUES($1,'case_reviewer',clock_timestamp()+interval '2 days'),",
   "($2,'appeal_reviewer',clock_timestamp()+interval '2 days')"
 ].join(' '),[ids.identities[3],ids.identities[4]]);
 await db.query([
   'INSERT INTO public.campus_case_review_decisions',
   '(case_id,reviewer_user_id,decision_code)',
   "VALUES($1,$2,'insufficient_evidence')"
 ].join(' '),[caseId,ids.identities[3]]);
 const appeal=await db.query([
   'INSERT INTO public.campus_case_appeals',
   '(case_id,actor_user_id,reason_code)',
   "VALUES($1,$2,'technical_issue') RETURNING id"
 ].join(' '),[caseId,ids.identities[2]]);
 await db.query([
   'INSERT INTO public.campus_case_appeal_reviews',
   '(appeal_id,reviewer_user_id,result_code)',
   "VALUES($1,$2,'additional_review_required')"
 ].join(' '),[appeal.rows[0].id,ids.identities[4]]);
}
test('real isolated 007→014 upgrade, authenticated archive and separate rollback+014 restores',{
 skip:!enabled?'explicit synthetic-only CI opt-in required':false,timeout:240000
},async t=>{
 verifyIsolation();
 const suffix=crypto.randomBytes(6).toString('hex');
 const dbs=['cp_fwd_'+suffix,'cp_pre_'+suffix,'cp_post_'+suffix];
 const admin=await conn(uri(url,'postgres'));
 const created=[];
 let forward,pre,post;
 try{
   for(const db of dbs){
     await admin.query('CREATE DATABASE '+safeName(db)+' TEMPLATE template0');
     created.push(db);
   }
   forward=await conn(uri(url,dbs[0]));
   pre=await conn(uri(url,dbs[1]));
   post=await conn(uri(url,dbs[2]));
   for(let version=1;version<=7;version++)await migrate(forward,version);
   const ids=await seed007(forward);
   const baseline=await legacyDigest(forward);
   assert.equal((await readCatalog(forward)).tables.some(x=>x.name==='campus_idempotency_keys'),false);
   const preAudit=checkCatalog(await readCatalog(forward),7);
   assert.equal(preAudit.catalogMatches,true,JSON.stringify(preAudit.failures));
   const archiveBefore=seal(dockerPg(url,'pg_dump',dbs[0]));
   assert.ok(archiveBefore.encrypted.length>100);
   dockerPg(url,'pg_restore',dbs[1],archiveBefore.recovered);
   const beforeRestore=await legacyDigest(pre);
   assert.deepEqual(beforeRestore,baseline,'pre-upgrade restore must preserve full baseline row digests');
   const preRollback=checkCatalog(await readCatalog(pre),7);
   assert.equal(preRollback.catalogMatches,true,JSON.stringify(preRollback.failures));
   assert.equal(preRollback.releaseReady,false);
   const milestones=[];
   for(let version=8;version<=14;version++){
     await migrate(forward,version);
     const verdict=checkCatalog(await readCatalog(forward),version);
     assert.equal(verdict.catalogMatches,true,
       'Stage '+version+' catalog drift: '+JSON.stringify(verdict.failures));
     assert.equal(verdict.detectedStage,version);
     milestones.push(version);
     assert.deepEqual(await legacyDigest(forward),
       baseline,'Stage '+version+' must not rewrite legacy ride/booking rows');
   }
   const status=await forward.query(
     'SELECT payment_mode,payment_status,status FROM public.campus_bookings ORDER BY booking_id');
   assert.equal(status.rows.length,2);
   assert.ok(status.rows.every(x=>x.payment_mode==='legacy'&&x.payment_status==='Pending'));
   assert.ok(status.rows.some(x=>x.status==='cancelled'));
   await seed014(forward,ids);
   const allAuditTables=['campus_users','campus_rides','campus_bookings',
      'campus_idempotency_keys','campus_booking_cases','campus_booking_case_events',
      'campus_booking_case_responses','campus_case_reviewer_grants',
      'campus_case_review_decisions','campus_case_appeals','campus_case_appeal_reviews'];
   const postExpected=await countDigest(forward,allAuditTables);
   const archiveAfter=seal(dockerPg(url,'pg_dump',dbs[0]));
   dockerPg(url,'pg_restore',dbs[2],archiveAfter.recovered);
   const postActual=await countDigest(post,allAuditTables);
   assert.deepEqual(postActual,postExpected,
      'post-014 independent scratch restore must preserve case/appeal/payment row digests');
   const postRestoreAudit=checkCatalog(await readCatalog(post),14);
   assert.equal(postRestoreAudit.catalogMatches,true,
      JSON.stringify(postRestoreAudit.failures));
   assert.equal(postRestoreAudit.releaseReady,false);
   assert.equal(postRestoreAudit.offsiteBackupVerified,false);
   assert.equal((await pre.query("SELECT to_regclass('public.campus_case_appeals') AS t")).rows[0].t,null);
   assert.equal((await post.query("SELECT count(*)::int AS n FROM public.campus_case_appeals")).rows[0].n,1);
   // The rollback target is a separate 007 snapshot; NEVER destructive DOWN
   // SQL in the upgraded DB or a partial rollback that silently loses case data.
   t.diagnostic('CAMPUS_MIGRATION_RECOVERY_RESULT '+JSON.stringify({
     syntheticOnly:true,stages:milestones,fromVersion:7,toVersion:14,
     baselineLegacyRowsPreserved:true,cancelledPendingPreserved:true,
     archiveFormat:'PGDMP',authenticatedEncryption:'AES-256-GCM',
     archiveTamperDetected:true,separatePreUpgradeRestore:true,
     separatePostUpgradeRestore:true,caseAppealRowsRecovered:true,
     rlsAndReviewerGrantsRecovered:true,inPlaceRollback:false,
     stagingTouched:false,azureBackupVerified:false,offsiteRestoreVerified:false,
     releaseReady:false
   }));
 }finally{
   for(const c of [forward,pre,post])if(c)await c.end().catch(()=>{});
   for(const db of created.reverse())await admin.query(
     'DROP DATABASE IF EXISTS '+safeName(db)+' WITH (FORCE)').catch(()=>{});
   await admin.end().catch(()=>{});
 }
});
