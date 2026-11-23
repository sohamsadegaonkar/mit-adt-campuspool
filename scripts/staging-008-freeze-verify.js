'use strict';

// Read-only evidence that the STAGING APPLICATION ROLE cannot mutate selected
// CampusPool tables. It is not an independent guarantee that the Supabase
// postgres/admin roles or other external writers have been frozen.
const {TABLES,APP_ROLE,RECEIPT_TABLE}=require('./staging-migration-preflight');

function checkFrozenSnapshot(snapshot,appRoleConnections){
  const failures=[];
  const fail=(ok,reason)=>{if(!ok)failures.push(reason);};
  if(!snapshot||!Array.isArray(snapshot.roles)||!Array.isArray(snapshot.tables)||
     !Array.isArray(snapshot.policies)||!Array.isArray(snapshot.schemas)){
    return {appRoleWriteFreezeVerified:false,databaseWideWriteFreezeVerified:false,
      failures:['SNAPSHOT_MISSING_OR_MALFORMED'],releaseReady:false};
  }
  const roles=new Map(snapshot.roles.map(r=>[r.rolname,r]));
  const app=roles.get(APP_ROLE);
  fail(!!app,'APP_ROLE_MISSING');
  if(app){
    fail(app.rolcanlogin===false,'APP_ROLE_STILL_ACCEPTS_NEW_LOGINS');
    fail(!app.rolsuper&&!app.rolbypassrls&&!app.rolcreatedb&&!app.rolcreaterole,
      'APP_ROLE_PRIVILEGED');
  }
  for(const api of ['anon','authenticated'])fail(roles.has(api),'API_ROLE_MISSING_'+api);
  const schemas=new Map(snapshot.schemas.map(r=>[r.schema_name,r]));
  for(const name of ['public','extensions']){
    const sc=schemas.get(name);
    fail(!!sc&&sc.backend_usage===true&&sc.backend_create===false,
      'SCHEMA_ACCESS_MISMATCH_'+name);
  }
  const tables=new Map(snapshot.tables.map(t=>[t.table_name,t]));
  fail(!tables.has(RECEIPT_TABLE),'MIGRATION_008_ALREADY_PRESENT');
  for(const name of TABLES){
    const t=tables.get(name);
    if(!t){fail(false,'TABLE_MISSING_'+name);continue;}
    fail(t.rls===true,'RLS_NOT_ENABLED_'+name);
    fail(t.backend_read===true,'READ_PERMISSION_MISSING_'+name);
    fail(t.backend_insert===false&&t.backend_update===false&&t.backend_delete===false,
      'BACKEND_DML_STILL_GRANTED_'+name);
    fail(t.anon_read===false&&t.anon_write===false&&
      t.auth_read===false&&t.auth_write===false,'CLIENT_ACCESS_GRANTED_'+name);
    const policies=snapshot.policies.filter(p=>p.tablename===name);
    fail(policies.length===1&&policies[0].policyname==='campuspool_backend_access'&&
       policies[0].cmd==='ALL'&&policies[0].qual==='true'&&
       policies[0].with_check==='true'&&
       (Array.isArray(policies[0].roles)?
         policies[0].roles.includes(APP_ROLE):
         String(policies[0].roles).replace(/[{}]/g,'').split(',').includes(APP_ROLE)),
      'POLICY_MISMATCH_'+name);
  }
  fail(Number.isSafeInteger(appRoleConnections)&&appRoleConnections===0,
    'ACTIVE_APP_ROLE_CONNECTIONS_NOT_DRAINED');
  return {
    appRoleWriteFreezeVerified:failures.length===0,
    databaseWideWriteFreezeVerified:false,
    releaseReady:false,failures,
    scope:'campuspool_staging_app DML on 9 tables only; privileged/other writers not proven frozen',
    note:'Application role permission/connection readback is not a global database write freeze.'
  };
}
async function readAppRoleConnections(client){
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout=5000');
    const r=await client.query(
      "SELECT count(*)::integer AS active_connections FROM pg_stat_activity "+
      "WHERE datname=current_database() AND usename=$1",[APP_ROLE]);
    await client.query('COMMIT');
    const v=r.rows[0]?.active_connections;
    if(!Number.isSafeInteger(Number(v))||Number(v)<0)
      throw Error('APP_SESSION_COUNT_INVALID');
    return Number(v);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
}
module.exports={checkFrozenSnapshot,readAppRoleConnections};
