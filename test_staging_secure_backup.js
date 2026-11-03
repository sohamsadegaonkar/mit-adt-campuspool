'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {STAGING_REF,extractRef,validatePlan}=require('./scripts/staging-backup-guard');
const goodUri='postgresql://postgres.'+STAGING_REF+':TEST_ONLY@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
const age='age1'+'a'.repeat(58);
function withDirs(fn){
  const p=fs.mkdtempSync(path.join(os.tmpdir(),'cp-backup-test-'));
  const work=path.join(p,'encrypted-work'),offsite=path.join(p,'remote-mount');
  fs.mkdirSync(work);fs.mkdirSync(offsite);
  try{return fn({p,work,offsite});}finally{fs.rmSync(p,{force:true,recursive:true});}
}
function env(work,offsite){return {STAGING_DB_URL:goodUri,STAGING_ENCRYPTED_WORKDIR:work,
  OFFSITE_DIR:offsite,STAGING_WORKDIR_ENCRYPTED:'YES',OFFSITE_MOUNT_VERIFIED:'YES',AGE_RECIPIENT:age};}

test('the guard accepts only an exact staging project and TLS',()=>{
  const direct='postgresql://postgres:TEST_ONLY@db.'+STAGING_REF+'.supabase.co/postgres';
  assert.equal(extractRef(goodUri),STAGING_REF);
  assert.equal(extractRef(direct),STAGING_REF);
  for(const invalid of [
    'postgresql://postgres:TEST_ONLY@localhost:5432/postgres',
    'postgresql://postgres:TEST_ONLY@db.example.com/postgres',
    'https://db.'+STAGING_REF+'.supabase.co/postgres',
    direct+'?sslmode=disable',
    'postgresql://postgres:TEST_ONLY@db.'+STAGING_REF+'.supabase.co/other',
    'postgresql://postgres.notthestageproject:TEST_ONLY@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:TEST_ONLY@evil.pooler.supabase.com.attacker.example/postgres'
  ])assert.throws(()=>extractRef(invalid));
});

test('backup must be operator-attested, encrypted, external to repository and outside workdir',()=>withDirs(({work,offsite})=>{
  const good=env(work,offsite), result=validatePlan(good);
  assert.equal(result.projectRef,STAGING_REF);assert.equal(result.remoteProof,false);
  for(const key of ['STAGING_WORKDIR_ENCRYPTED','OFFSITE_MOUNT_VERIFIED','AGE_RECIPIENT','STAGING_DB_URL']){
    assert.throws(()=>validatePlan({...good,[key]:''}));
  }
  assert.throws(()=>validatePlan({...good,OFFSITE_DIR:work}));
  assert.throws(()=>validatePlan({...good,OFFSITE_DIR:path.join(__dirname,'scripts')}));
  assert.throws(()=>validatePlan({...good,STAGING_DB_URL:good.STAGING_DB_URL.replace(STAGING_REF,'aaaaaaaaaaaaaaaaaaaa')}));
}));

test('command fails closed without credentials and does not print provided URL',()=>{
  const cmd=spawnSync(process.execPath,['scripts/staging-backup-guard.js'],{
    cwd:__dirname,encoding:'utf8',env:{...process.env,STAGING_DB_URL:'postgresql://postgres:TOP_SECRET@evil.example.com/postgres'}
  });
  assert.notEqual(cmd.status,0);
  assert.doesNotMatch(cmd.stdout+cmd.stderr,/TOP_SECRET|evil\.example\.com/);
  assert.match(cmd.stderr,/BLOCKED/);
});

test('operator script syntax passes and mode remains explicit',()=>{
  const cmd=spawnSync('bash',['-n',path.join(__dirname,'scripts/staging-secure-backup.sh')],{
    encoding:'utf8'
  });
  assert.equal(cmd.status,0,cmd.stderr);
  const script=fs.readFileSync(path.join(__dirname,'scripts/staging-secure-backup.sh'),'utf8');
  assert.match(script,/--preflight/);
  assert.match(script,/--execute/);
  assert.match(script,/scripts\/staging-backup-guard\.js/);
  assert.match(script,/--role-only/);
  assert.match(script,/--data-only/);
  assert.match(script,/age --encrypt/);
  assert.doesNotMatch(script,/curl .*STAGING_DB_URL|npm publish|git add/);
});
