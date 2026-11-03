'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {
  STAGING_REF,APP_ROLE,TABLES,RECEIPT_TABLE,
  validateTarget,checkSnapshot,readSnapshot
}=require('./scripts/staging-migration-preflight');

function fixture(installed=false){
  const tableNames=installed?[...TABLES,RECEIPT_TABLE]:TABLES;
  return {
    roles:[
      {rolname:APP_ROLE,rolcanlogin:true,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false},
      {rolname:'anon'}, {rolname:'authenticated'}
    ],
    schemas:['public','extensions'].map(schema_name=>({
      schema_name,backend_usage:true,backend_create:false
    })),
    tables:tableNames.map(table_name=>({
      table_name,rls:true,
      anon_read:false,anon_write:false,auth_read:false,auth_write:false,
      backend_read:true,backend_insert:true,backend_update:true,backend_delete:true
    })),
    policies:tableNames.map(tablename=>({
      tablename,policyname:'campuspool_backend_access',roles:[APP_ROLE],
      cmd:'ALL',qual:'true',with_check:'true'
    })),
    indexes:installed?['campus_idempotency_expiry_idx']:[]
  };
}

test('connection validator rejects arbitrary or production connection targets',()=>{
  const direct='postgresql://campuspool_staging_app:dummy@db.'+STAGING_REF+'.supabase.co/postgres';
  const pooler='postgresql://campuspool_staging_app.'+STAGING_REF+':dummy@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
  assert.equal(validateTarget(direct).kind,'staging-direct');
  assert.equal(validateTarget(pooler).kind,'staging-pooler');
  for(const unsafe of [
    '', 'not-a-url', 'https://db.'+STAGING_REF+'.supabase.co',
    'postgresql://postgres:dummy@127.0.0.1:5432/postgres',
    'postgresql://postgres:dummy@db.differentproject.supabase.co/postgres',
    'postgresql://postgres.not_the_project:dummy@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    'postgresql://campuspool_staging_app:dummy@db.'+STAGING_REF+'.supabase.co/postgres?sslmode=disable',
    'postgresql://campuspool_staging_app:dummy@db.'+STAGING_REF+'.supabase.co/other'
  ])assert.throws(()=>validateTarget(unsafe));
});

test('staging preflight supports before and after schema states without release authorization',()=>{
  const before=checkSnapshot(fixture(), 'before');
  assert.equal(before.schemaReady,true);
  assert.equal(before.receiptInstalled,false);
  assert.equal(before.releaseReady,false);
  const after=checkSnapshot(fixture(true),'after');
  assert.equal(after.schemaReady,true);
  assert.equal(after.receiptInstalled,true);
  assert.equal(after.releaseReady,false);
  assert.ok(checkSnapshot(fixture(true),'before').failures.some(x=>x.includes('already')));
  assert.ok(checkSnapshot(fixture(),'after').failures.some(x=>x.includes('absent')));
});

test('preflight fails closed on client grants, RLS policies or privileged DB role',()=>{
  const exposed=fixture(true);
  exposed.tables[0].auth_write=true;
  exposed.tables[1].rls=false;
  exposed.roles[0].rolbypassrls=true;
  exposed.policies[2].roles=['anon'];
  exposed.indexes=[];
  const failures=checkSnapshot(exposed,'after').failures.join(' / ');
  assert.match(failures,/exposed/);
  assert.match(failures,/RLS not enabled/);
  assert.match(failures,/privileged/);
  assert.match(failures,/policy/);
  assert.match(failures,/index absent/);
  const noClients=fixture();
  noClients.roles=noClients.roles.filter(r=>r.rolname===APP_ROLE);
  assert.equal(checkSnapshot(noClients,'before').schemaReady,false);
});

test("preflight SQL transaction is read only and always commits",async()=>{
  const f=fixture(true),seen=[];
  const responses=[f.roles,f.schemas,f.tables,f.policies,
    f.indexes.map(indexname=>({indexname}))];
  let idx=0;
  const fake={query:async sql=>{
    seen.push(sql);
    if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')||sql==='COMMIT')
      return {rows:[]};
    return {rows:responses[idx++]};
  }};
  const result=await readSnapshot(fake);
  assert.equal(checkSnapshot(result,'after').schemaReady,true);
  assert.ok(seen[0].includes('READ ONLY'));
  assert.equal(seen.at(-1),'COMMIT');
  assert.equal(idx,5);
});

test('read-only SQL transaction rolls back on error',async()=>{
  const seen=[];
  const fake={query:async sql=>{
    seen.push(sql);
    if(sql.startsWith('SELECT'))throw Error('test database read failure');
    return {rows:[]};
  }};
  await assert.rejects(readSnapshot(fake),/test database read failure/);
  assert.equal(seen.at(-1),'ROLLBACK');
});

test('isolated PostgreSQL verifies real post-008 schema and policies',
 {skip:!process.env.OTP_DATABASE_URL?'requires disposable local PostgreSQL':false},
 async()=>{
  const url=new URL(process.env.OTP_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),
    'Integration tests never connect to live Supabase');
  const c=new Client({connectionString:process.env.OTP_DATABASE_URL,ssl:false});
  try{
    await c.connect();
    const result=checkSnapshot(await readSnapshot(c),'after');
    assert.equal(result.schemaReady,true,result.failures.join('; '));
  }finally{await c.end().catch(()=>{});}
 });
