'use strict';
// TEST-ONLY: no external database access, no production/staging credentials.
// CI uses disposable PostGIS; this never backs up or restores live staging.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {Client}=require('pg');

function clientEnv(uri, dbname){
  const u=new URL(uri);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname),
    'Backup drill refuses external PostgreSQL');
  assert.equal(u.pathname,'/campuspool_stage1_ci',
    'Backup drill requires the exact disposable CI source database');
  return {...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',
    PGUSER:decodeURIComponent(u.username),
    PGPASSWORD:decodeURIComponent(u.password),
    PGDATABASE:dbname,PGSSLMODE:'disable'};
}
function run(cmd,args,env){
  const executable=process.env.PG_BIN_DIR
    ? path.join(process.env.PG_BIN_DIR,cmd):cmd;
  try{return execFileSync(executable,args,{env,stdio:['ignore','pipe','pipe'],timeout:60000});}
  catch{throw Error('Disposable PostgreSQL archive/restore command failed: '+cmd);}
}
async function snapshot(connectionString){
  const c=new Client({connectionString,ssl:false});
  try{
    await c.connect();
    const tables=['otp_challenges','campus_users','campus_sessions',
      'campus_rides','campus_bookings','campus_trip_intents','campus_idempotency_keys'];
    const result={};
    for(const t of tables){
      const rows=await c.query('SELECT count(*)::int AS n FROM public.'+t);
      const rls=await c.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',
        ['public.'+t]);
      result[t]={rows:rows.rows[0].n,rls:rls.rows[0].relrowsecurity};
    }
    const policies=await c.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND policyname='campuspool_backend_access'");
    result.policyCount=policies.rows[0].n;
    const grants=await c.query("SELECT has_table_privilege('anon','public.campus_idempotency_keys','SELECT') AS anon,has_table_privilege('authenticated','public.campus_idempotency_keys','SELECT') AS authenticated,has_table_privilege('campuspool_staging_app','public.campus_idempotency_keys','SELECT') AS backend");
    result.grants=grants.rows[0];
    return result;
  }finally{await c.end().catch(()=>{});}
}

test('synthetic PostgreSQL backup encrypt/decrypt and independent scratch restore',
 {skip:!process.env.OTP_DATABASE_URL?'requires disposable local CI database':false},
 async()=>{
  const source=process.env.OTP_DATABASE_URL;
  const local=clientEnv(source,'campuspool_stage1_ci');
  const scratch='cp_restore_ci_'+crypto.randomBytes(6).toString('hex');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-backup-drill-'));
  const plain=path.join(dir,'synthetic.pgcustom');
  const sealed=path.join(dir,'synthetic.encrypted');
  const restored=path.join(dir,'restored.pgcustom');
  const u=new URL(source);
  const adminUrl=new URL(source);adminUrl.pathname='/postgres';
  const cloneUrl=new URL(source);cloneUrl.pathname='/'+scratch;
  const admin=new Client({connectionString:adminUrl.toString(),ssl:false});
  let created=false;
  try{
    const expected=await snapshot(source);
    const original=run('pg_dump',['--format=custom','--no-owner',
      '--file',plain],local);
    assert.equal(original.length,0,'Dump writes only to the private file');
    const plainBytes=fs.readFileSync(plain);
    assert.ok(plainBytes.length>100);
    const originalHash=crypto.createHash('sha256').update(plainBytes).digest('hex');
    const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const encrypted=Buffer.concat([cipher.update(plainBytes),cipher.final()]);
    fs.writeFileSync(sealed,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});
    fs.unlinkSync(plain);
    assert.equal(fs.existsSync(plain),false,'Synthetic archive plaintext removed');
    const sealedBytes=fs.readFileSync(sealed);
    const decipher=crypto.createDecipheriv('aes-256-gcm',
      key,sealedBytes.subarray(0,12));
    decipher.setAuthTag(sealedBytes.subarray(12,28));
    const recovered=Buffer.concat([
      decipher.update(sealedBytes.subarray(28)),decipher.final()]);
    assert.equal(crypto.createHash('sha256').update(recovered).digest('hex'),originalHash);
    fs.writeFileSync(restored,recovered,{mode:0o600});

    await admin.connect();
    await admin.query('CREATE DATABASE "'+scratch+'" TEMPLATE template0');
    created=true;
    run('pg_restore',['--exit-on-error','--no-owner','--clean','--if-exists',
      '--dbname',scratch,restored],clientEnv(source,scratch));
    const actual=await snapshot(cloneUrl.toString());
    assert.deepEqual(actual,expected,'Scratch DB must match data, RLS, grants and policies');
    console.log('Synthetic backup encryption, checksum and independent logical DB restore passed');
  }finally{
    if(created)await admin.query('DROP DATABASE IF EXISTS "'+scratch+'" WITH (FORCE)')
      .catch(()=>{});
    await admin.end().catch(()=>{});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
