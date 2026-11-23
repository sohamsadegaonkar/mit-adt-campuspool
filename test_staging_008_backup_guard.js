'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {TABLES}=require('./scripts/staging-migration-preflight');
const {parseBackupTarget,parsePinnedCa,checkCountRows,countReadOnly,guard}=
  require('./scripts/staging-008-backup-guard');
const PROJECT='tnitksrlntrdxbvznxzf';
const POOL='postgresql://campuspool_staging_app.'+PROJECT+
 ':synthetic-only@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const DIRECT='postgresql://campuspool_staging_app:synthetic-only@db.'+PROJECT+
 '.supabase.co/postgres?sslmode=verify-full';

test('allow only exact staging project, nonprivileged app role and pinned TLS mode',()=>{
  assert.equal(parseBackupTarget(POOL).user,'campuspool_staging_app.'+PROJECT);
  assert.equal(parseBackupTarget(DIRECT).hostname,'db.'+PROJECT+'.supabase.co');
  const admin=POOL.replace('campuspool_staging_app.','postgres.');
  assert.throws(()=>parseBackupTarget(admin),/ROLE_NOT_APPROVED/);
  assert.equal(parseBackupTarget(admin,{allowAdmin:true}).user,'postgres.'+PROJECT);
  for(const bad of [
    POOL.replace('sslmode=verify-full','sslmode=disable'),
    POOL.replace('sslmode=verify-full','sslmode=require'),
    POOL.replace('sslmode=verify-full','sslmode=verify-full&application_name=x'),
    POOL.replace('campuspool_staging_app.','postgres.'),
    POOL.replace(PROJECT,'differentproject'),
    POOL.replace(':5432/',':6543/'),
    POOL.replace('/postgres?','/template1?'),
    POOL.replace('pooler.supabase.com','pooler.evil.com'),
    DIRECT.replace('campuspool_staging_app:','postgres:'),
    DIRECT+'#fragment'
  ])assert.throws(()=>parseBackupTarget(bad));
});
test('CA guard refuses empty, altered and mismatched certificates',()=>{
  for(const value of ['',Buffer.from('not-a-ca').toString('base64'),
    Buffer.from('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----').toString('base64')])
    assert.throws(()=>parsePinnedCa(value));
});
function fixture(count=0,history=7){
  return [...TABLES.map(table_name=>({table_name,n:count})),
    {table_name:'supabase_migrations.schema_migrations',n:history}];
}
test('preimage pass only for zero CampusPool app rows and migration ledger 007',()=>{
  assert.deepEqual(checkCountRows(fixture()),{
    checkedApplicationTables:9,totalApplicationRows:0,migrationHistoryCount:7
  });
  assert.throws(()=>checkCountRows(fixture(1)),/NOT_EMPTY/);
  assert.throws(()=>checkCountRows(fixture(0,8)),/DRIFT/);
  assert.throws(()=>checkCountRows(fixture().slice(1)),/INCOMPLETE/);
  assert.throws(()=>checkCountRows([...fixture().slice(0,-1),fixture()[0]]),/MALFORMED/);
});
test('every catalog count is in a read-only transaction, never an export',async()=>{
  const q=[];
  let i=0;
  const fake={query:async sql=>{
    q.push(sql);
    if(sql.startsWith('SELECT count'))return {rows:[{n:i++===TABLES.length?7:0}]};
    return {rows:[]};
  }};
  const out=await countReadOnly(fake);
  assert.equal(out.migrationHistoryCount,7);
  assert.match(q[0],/READ ONLY/);
  assert.equal(q.at(-1),'COMMIT');
  assert.equal(q.filter(s=>s.startsWith('SELECT count')).length,TABLES.length+1);
  assert.ok(!q.some(s=>/CREATE TABLE|DROP TABLE|ALTER TABLE|pg_dump/i.test(s)));
});
test('refuse any unapproved staging backup before even opening a DB connection',async()=>{
  await assert.rejects(guard({}),/EXPLICIT_GUARDS_MISSING/);
  await assert.rejects(guard({APP_ENV:'production',OTP_DB_SSL:'true',
    STAGING_008_BACKUP_ACK:'STAGING_008_PREIMAGE_ONLY'}),/EXPLICIT_GUARDS_MISSING/);
});
test('never add staging live credentials, DDL or prod deploy to repo workflow',()=>{
  const workflow=fs.readFileSync('.github/workflows/staging-008-recovery-proof.yml','utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/write_freeze_confirmation:/);
  assert.match(workflow,/inputs\.write_freeze_confirmation == 'STAGING_008_WRITE_FREEZE_CONFIRMED'/);
  // The scope is a manual, protected source-only proposal, not proof of an actual write freeze.
  assert.equal((workflow.match(/STAGING_008_WRITE_FREEZE_CONFIRMED/g)||[]).length,2);
  assert.doesNotMatch(workflow,/uses: actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d/);
  for(const action of ['checkout','setup-node','upload-artifact','download-artifact']){
    assert.match(workflow,new RegExp('uses: actions/'+action+'@[a-f0-9]{40}'));
  }
  assert.match(workflow,/--no-acl/);
  // A PostgreSQL has_table_privilege() comma-separated privilege list is ANY,
  // not ALL. One granted privilege must never pass the four-CRUD gate.
  const backend=workflow.match(/has_table_privilege\('campuspool_staging_app',c\.oid,'(?:SELECT|INSERT|UPDATE|DELETE)'\)/g)||[];
  assert.equal(backend.length,4);
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
    assert.ok(backend.some(x=>x.includes("'"+privilege+"'")),privilege);
  assert.doesNotMatch(workflow,/has_table_privilege\('campuspool_staging_app',c\.oid,'SELECT,INSERT,UPDATE,DELETE'\)/);
  for(const table of ['campus_rides','campus_bookings','campus_ride_geo','campus_trip_intents'])
    assert.match(workflow,new RegExp('public\\.'+table+'\\b'));
  assert.match(workflow,/GRANT USAGE ON SCHEMA extensions TO campuspool_staging_app;/);
  assert.match(workflow,/environment: staging-008-backup/);
  assert.match(workflow,/environment: staging-008-restore/);
  assert.doesNotMatch(workflow,/^\s*push:/m);
  assert.doesNotMatch(workflow,/^\s*pull_request:/m);
  assert.doesNotMatch(workflow,/^\s*packages:\s*write/m);
  assert.doesNotMatch(workflow,/az containerapp|supabase db push|apply_migration|render deploy|trigger_deploy/i);
  assert.match(workflow,/NO_DATABASE_MIGRATION=YES/);
  assert.equal((workflow.match(/INDEPENDENT_ENCRYPTED_STAGING_APPLICATION_RESTORE_VERIFIED=YES/g)||[]).length,1);
  assert.equal((workflow.match(/Report stage-only recovery with production release held/g)||[]).length,1);
  assert.ok(workflow.includes('test "$(grep -c '+String.fromCharCode(39)+'^t$'+String.fromCharCode(39)+' "$TMP/assertions")" -eq 8'));
  assert.match(workflow,/recordedMigrationsBefore:7/);
  assert.match(workflow,/campuspool_007_spatiotemporal_matching/);
  assert.match(workflow,/PRODUCTION_PROMOTION_AUTHORIZED=NO/);
});
