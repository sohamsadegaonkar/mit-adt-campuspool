'use strict';
// Disposable rehearsal only. No staging URL, secrets, deploy, or real data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const {PgOtpStore}=require('./stage1-otp/pg-store');
const {PgIdentity}=require('./stage1-otp/identity');
const {RegistrationDrafts}=require('./stage1-otp/registration-drafts');
const {assess,read}=require('./scripts/staging-registration-release-preflight');
async function catalog(pool,phase){const client=await pool.connect();try{return assess(await read(client),phase);}finally{client.release();}}
const db=new URL(process.env.REGISTRATION_RELEASE_TEST_URL||'http://invalid');
const container=process.env.REGISTRATION_RELEASE_CONTAINER||'';
const name='campuspool_registration_release_test',scratch='campuspool_registration_restore_test';
if(process.env.QA_DISPOSABLE_REGISTRATION_RELEASE!=='YES'||db.hostname!=='127.0.0.1'||
  db.port!=='5432'||db.pathname!=='/'+name||! /^[a-f0-9]{64}$/.test(container))
  throw Error('Disposable release rehearsal only');
const root=path.join(__dirname,'stage1-otp','migrations');
const chain=path.join(__dirname,'.release-chain','stage1-otp','migrations');
const baseline=path.join(__dirname,'.release-baseline');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const docker=(args,input)=>execFileSync('docker',['exec','-i',container,...args],{
  input,maxBuffer:32*1024*1024,timeout:30000,stdio:['pipe','pipe','pipe']});
async function snapshot(pool){
  const {rows:tables}=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result={};
  for(const {tablename:t} of tables){
    if(!/^(campus_|otp_)[a-z0-9_]+$/.test(t))continue;
    const r=await pool.query('SELECT to_jsonb(x)::text AS row FROM public."'+t+'" x ORDER BY to_jsonb(x)::text');
    result[t]={count:r.rows.length,digest:sha(JSON.stringify(r.rows))};
  }
  const grants=(await pool.query("SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND grantee IN ('campuspool_staging_app','anon','authenticated','PUBLIC') ORDER BY 1,2,3")).rows;
  const policies=(await pool.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2")).rows;
  return {tables:result,grants,policies};
}
test('ordered 001–014 candidate chain, 015 additive upgrade, legacy compatibility, isolated preimage restore',async()=>{
  const pool=new Pool({connectionString:db.href,connectionTimeoutMillis:5000});
  const scratchUrl=new URL(db.href);scratchUrl.pathname='/'+scratch;
  let restored,oldStore,newStore;
  try{
    await pool.query('DROP EXTENSION IF EXISTS postgis CASCADE; CREATE SCHEMA IF NOT EXISTS extensions; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
    const files=fs.readdirSync(chain).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
    assert.deepEqual(files.map(x=>Number(x.slice(0,3))),Array.from({length:14},(_,i)=>i+1));
    for(const file of files){
      const sql=fs.readFileSync(path.join(chain,file),'utf8');
      if(Number(file.slice(0,3))<=8){
        assert.equal(sql,fs.readFileSync(path.join(root,file),'utf8'),'baseline migration changed: '+file);
      }
      await pool.query(sql);
    }
    // Synthetic ledger matches the recorded sequential versions; this is not a Supabase-managed ledger rehearsal.
    await pool.query('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)');
    for(let i=1;i<=14;i++)await pool.query('INSERT INTO supabase_migrations.schema_migrations(version) VALUES($1)',[String(i).padStart(3,'0')]);
    // Seed a real legacy login/session using synthetic-only identities.
    const email='release-fixture@students.mituniversity.edu.in',phone='9123456780';
    await pool.query("INSERT INTO campus_users(id,name,email,phone,dept,is_verified,verified_at) VALUES($1,'Release Fixture',$2,$3,'Computing',true,now())",[crypto.randomUUID(),email,phone]);
    const runtimePassword=crypto.randomBytes(32).toString('hex');
    await pool.query("ALTER ROLE campuspool_staging_app LOGIN PASSWORD '"+runtimePassword+"'");
    const runtime=new URL(db.href);runtime.username='campuspool_staging_app';runtime.password=runtimePassword;
    const key=crypto.randomBytes(32).toString('hex');
    const {PgOtpStore:LegacyStore}=require(path.join(baseline,'stage1-otp','pg-store.js'));
    const {PgIdentity:LegacyIdentity}=require(path.join(baseline,'stage1-otp','identity.js'));
    oldStore=new LegacyStore({connectionString:runtime.href,hmacKey:key,ssl:false});
    const oldIdentity=new LegacyIdentity(oldStore);
    await oldStore.ready();
    const oldSession=await oldIdentity.sessionForEmail(email);
    assert.ok(oldSession);
    const before=await snapshot(pool);
    assert.deepEqual((await catalog(pool,'before')).errors,[]);
    assert.equal((await catalog(pool,'after')).catalogAndLedgerMatch,false);
    // Real PGDMP. In-memory AES-GCM is a synthetic transport check, NOT
    // evidence of actual AGE key custody, Azure backup or staging recovery.
    const archive=docker(['pg_dump','-U','postgres','-Fc','-d',name]);
    assert.equal(archive.subarray(0,5).toString(),'PGDMP');
    const encKey=crypto.randomBytes(32),iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',encKey,iv);
    const encrypted=Buffer.concat([cipher.update(archive),cipher.final()]);
    const tag=cipher.getAuthTag();
    const decrypt=payload=>{
      const d=crypto.createDecipheriv('aes-256-gcm',encKey,iv);d.setAuthTag(tag);
      return Buffer.concat([d.update(payload),d.final()]);
    };
    const tampered=Buffer.from(encrypted);tampered[0]^=1;
    assert.throws(()=>decrypt(tampered));
    const migration=fs.readFileSync(path.join(root,'015_pending_registration.sql'),'utf8');
    await pool.query(migration);
    await pool.query("INSERT INTO supabase_migrations.schema_migrations(version) VALUES('015')");
    assert.deepEqual((await catalog(pool,'after')).errors,[]);
    const after=await snapshot(pool);
    for(const [t,info] of Object.entries(before.tables))assert.deepEqual(after.tables[t],info,t);
    assert.equal(after.tables.campus_pending_registrations.count,0);
    const acl=(await pool.query("SELECT c.relrowsecurity, has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_access, has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_access, has_table_privilege('campuspool_staging_app',c.oid,'SELECT') AS app_read FROM pg_class c WHERE c.oid='public.campus_pending_registrations'::regclass")).rows[0];
    assert.deepEqual(acl,{relrowsecurity:true,anon_access:false,authenticated_access:false,app_read:true});
    assert.deepEqual(after.grants.filter(x=>x.table_name!=='campus_pending_registrations'),before.grants);
    assert.deepEqual(after.policies.filter(x=>x.tablename!=='campus_pending_registrations'),before.policies);
    newStore=new PgOtpStore({connectionString:runtime.href,hmacKey:key,ssl:false});
    const identity=new PgIdentity(newStore);
    const drafts=new RegistrationDrafts(newStore,identity,{ttlSeconds:3600});
    const pending=await drafts.start({email:'pending-fixture@students.mituniversity.edu.in',phone:'9123456781'});
    let code;
    await newStore.issue({purpose:'signup_draft_email',channel:'email',target:pending.state.email,ip:'192.0.2.10',registration:{drafts,resumeToken:pending.resumeToken},deliver:async o=>{code=o.code;return {accepted:true};}});
    const verified=await newStore.verify({purpose:'signup_draft_email',channel:'email',target:pending.state.email,ip:'192.0.2.10',code,registration:{drafts,resumeToken:pending.resumeToken}});
    assert.equal(verified.registration.emailVerified,true);
    assert.equal(await oldIdentity.getSessionUser(pending.resumeToken),null);
    assert.equal(await oldIdentity.getProfileByEmail(pending.state.email),null);
    assert.equal((await oldIdentity.getSessionUser(oldSession)).email,email);
    // Old runtime still accepts genuine legacy login on expanded schema.
    let loginCode;
    await oldStore.issue({purpose:'login',channel:'email',target:email,ip:'192.0.2.11',deliver:async o=>{loginCode=o.code;return {accepted:true};}});
    assert.equal((await oldStore.verify({purpose:'login',channel:'email',target:email,code:loginCode,ip:'192.0.2.11'})).ok,true);
    await assert.rejects(oldStore.verify({purpose:'signup_draft_email',channel:'email',target:pending.state.email,code,ip:'192.0.2.11'}),{code:'INVALID_PURPOSE'});
    // Rollback uses untouched previous runtime with expanded schema, not a DOWN.
    assert.equal((await drafts.status(pending.resumeToken)).emailVerified,true);
    // Independent scratch database within the disposable cluster, never overwrite source.
    await pool.query('CREATE DATABASE '+scratch);
    docker(['pg_restore','-U','postgres','--exit-on-error','-d',scratch],decrypt(encrypted));
    restored=new Pool({connectionString:scratchUrl.href,connectionTimeoutMillis:5000});
    assert.deepEqual(await snapshot(restored),before);
    assert.deepEqual((await catalog(restored,'before')).errors,[]);
    assert.equal((await restored.query("SELECT to_regclass('public.campus_pending_registrations') AS t")).rows[0].t,null);
    console.log('SYNTHETIC_ORDERED_CHAIN_001_015=PASS; LEGACY_RUNTIME_COMPATIBILITY=PASS; ISOLATED_PREIMAGE_RESTORE=PASS; LIVE_RELEASE_AUTHORIZED=NO');
  }finally{
    if(oldStore)await oldStore.close();
    if(newStore)await newStore.close();
    if(restored)await restored.end();
    await pool.end();
  }
});
