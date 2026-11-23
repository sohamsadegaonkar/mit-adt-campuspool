'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TABLES,APP_ROLE,RECEIPT_TABLE}=require('./scripts/staging-migration-preflight');
const {checkFrozenSnapshot,readAppRoleConnections,readWritableSequences}=
  require('./scripts/staging-008-freeze-verify');

function snapshot(frozen=true){
  return {
    roles:[{rolname:APP_ROLE,rolcanlogin:!frozen,rolsuper:false,
      rolbypassrls:false,rolcreatedb:false,rolcreaterole:false},
      {rolname:'anon'},{rolname:'authenticated'}],
    schemas:['public','extensions'].map(schema_name=>
      ({schema_name,backend_usage:true,backend_create:false})),
    tables:TABLES.map(table_name=>({
      table_name,rls:true,backend_read:true,
      backend_insert:!frozen,backend_update:!frozen,backend_delete:!frozen,
      anon_read:false,anon_write:false,auth_read:false,auth_write:false
    })),
    policies:TABLES.map(tablename=>({tablename,
      policyname:'campuspool_backend_access',roles:[APP_ROLE],
      cmd:'ALL',qual:'true',with_check:'true'})),
    indexes:[]
  };
}
test('current staging role with LOGIN and write CRUD is NOT considered frozen',()=>{
  const result=checkFrozenSnapshot(snapshot(false),0,[]);
  assert.equal(result.appRoleWriteFreezeVerified,false);
  assert.ok(result.failures.includes('APP_ROLE_STILL_ACCEPTS_NEW_LOGINS'));
  assert.ok(result.failures.includes('BACKEND_DML_STILL_GRANTED_campus_bookings'));
  assert.equal(result.databaseWideWriteFreezeVerified,false);
  assert.equal(result.releaseReady,false);
});
test('verified NOLOGIN+no DML+zero app sessions proves app-role scope only',()=>{
  const result=checkFrozenSnapshot(snapshot(),0,[]);
  assert.equal(result.appRoleWriteFreezeVerified,true);
  assert.equal(result.databaseWideWriteFreezeVerified,false);
  assert.equal(result.releaseReady,false);
  assert.deepEqual(result.failures,[]);
  assert.match(result.scope,/privileged\/other writers/);
});
test('remaining old app connection is not a completed application freeze',()=>{
  const r=checkFrozenSnapshot(snapshot(),1,[]);
  assert.equal(r.appRoleWriteFreezeVerified,false);
  assert.ok(r.failures.includes('ACTIVE_APP_ROLE_CONNECTIONS_NOT_DRAINED'));
  assert.equal(checkFrozenSnapshot(snapshot(),undefined,[]).appRoleWriteFreezeVerified,false);
});
test('fail on missing policies/RLS/client exposure/extra table/revoked read privilege',()=>{
  for(const mutation of [
    f=>f.tables[0].rls=false,
    f=>f.tables[0].backend_read=false,
    f=>f.tables[1].auth_write=true,
    f=>f.policies[0].roles=['anon'],
    f=>f.tables.push({...f.tables[0],table_name:RECEIPT_TABLE}),
    f=>f.tables.pop(),
    f=>f.roles[0].rolbypassrls=true,
    f=>f.schemas[1].backend_create=true
  ]){
    const f=snapshot();mutation(f);
    const r=checkFrozenSnapshot(f,0,[]);
    assert.equal(r.appRoleWriteFreezeVerified,false,JSON.stringify(r));
  }
  assert.equal(checkFrozenSnapshot(null,0,[]).appRoleWriteFreezeVerified,false);
});
test('live connection readback is explicitly read-only with scoped role predicate',async()=>{
  const sql=[];
  const c={query:async (q,params)=>{
    sql.push([q,params]);
    if(q.startsWith('SELECT count'))return {rows:[{active_connections:0}]};
    return {rows:[]};
  }};
  assert.equal(await readAppRoleConnections(c),0);
  assert.match(sql[0][0],/READ ONLY/);
  assert.equal(sql[2][1][0],APP_ROLE);
  assert.equal(sql.at(-1)[0],'COMMIT');
});
test('session count errors rollback, never silently prove an empty pool',async()=>{
  const q=[];
  const c={query:async sql=>{
    q.push(sql);
    if(sql.startsWith('SELECT count'))throw Error('test blocked');
    return {rows:[]};
  }};
  await assert.rejects(readAppRoleConnections(c),/test blocked/);
  assert.equal(q.at(-1),'ROLLBACK');
});

test('writable identity sequence or missing sequence inventory blocks even with DML revoked',()=>{
  const f=snapshot();
  assert.equal(checkFrozenSnapshot(f,0,['campus_identity_audit_id_seq']).appRoleWriteFreezeVerified,false);
  assert.ok(checkFrozenSnapshot(f,0,['campus_identity_audit_id_seq']).failures.includes('APP_ROLE_WRITABLE_SEQUENCES_REMAIN'));
  assert.equal(checkFrozenSnapshot(f,0).appRoleWriteFreezeVerified,false);
});
test('sequence privilege inventory is a read-only query and rejects injected writes',async()=>{
  const seen=[];
  const c={query:async (sql,args)=>{
    seen.push([sql,args]);
    if(sql.startsWith('SELECT c.relname'))return {rows:[{relname:'campus_identity_audit_id_seq'}]};
    return {rows:[]};
  }};
  assert.deepEqual(await readWritableSequences(c),['campus_identity_audit_id_seq']);
  assert.match(seen[0][0],/READ ONLY/);
  assert.equal(seen[2][1][0],APP_ROLE);
  assert.match(seen[2][0],/has_sequence_privilege/);
  assert.equal(seen.at(-1)[0],'COMMIT');
});
