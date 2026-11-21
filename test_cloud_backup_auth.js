'use strict';
// Cloud managed identity tests use only synthetic data and fake SDK clients.
const test=require('node:test');
const AGE_HEADER='age-encryption.org/v1\n-> X25519 '+'A'.repeat(43)+'\n'+'B'.repeat(43)+'\n--- '+'C'.repeat(43)+'\n';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const tls=require('node:tls');
const {X509Certificate}=require('node:crypto');
const {PassThrough,Readable}=require('node:stream');
const {EventEmitter}=require('node:events');
const tmp=fs.mkdtempSync('/dev/shm/campuspool-cloud-worker-tests-');
fs.chmodSync(tmp,0o700);
const ca=tmp+'/fake-ca.crt';
const publicCa=tls.rootCertificates.find(pem=>{
  try{
    const c=new X509Certificate(pem);
    return c.ca && Date.parse(c.validFrom)<Date.now() && Date.parse(c.validTo)>Date.now();
  }catch{return false;}
});
if(!publicCa)throw Error('TEST_PUBLIC_CA_NOT_AVAILABLE');
fs.writeFileSync(ca,publicCa,{mode:0o600});
// Synthetic tests only: replace the imported guard before loading the worker.
// The runtime wrapper has no environment or CLI override for its pinned CA.
const security=require('./scripts/cloud-backup-runtime-security');
const realPinnedGuard=security.validCaFile;
const testFingerprint=new X509Certificate(publicCa).fingerprint256.replace(/:/g,'');
assert.equal(realPinnedGuard(ca),false,'unrelated public CA must fail production pin');
test.mock.method(security,'validCaFile',file=>security.validCaFileAgainstFingerprint(file,testFingerprint));
const {validate,preflight,run}=require('./scripts/azure-blob-backup');
const passfile=tmp+'/pgpass';
fs.writeFileSync(passfile,
  'aws-0-ap-southeast-1.pooler.supabase.com:5432:postgres:postgres.tnitksrlntrdxbvznxzf:NOT_A_REAL_PASSWORD\n',
  {mode:0o600});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const env={
 PGUSER:'postgres.tnitksrlntrdxbvznxzf',
 PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
 PGDATABASE:'postgres',PGPORT:'5432',PGSSLMODE:'verify-full',
 PGSSLROOTCERT:ca,PGPASSFILE:passfile,
 AGE_RECIPIENT:'age1'+'a'.repeat(58),
 AZURE_STORAGE_ACCOUNT:'011campuspoolbackup',
 AZURE_BACKUP_CONTAINER:'campuspool-staging-backups',
 AZURE_PRIVATE_CONTAINER_CONFIRMED:'YES',
 AZURE_AUTH_MODE:'managed-identity',
 CAMPUSPOOL_CLOUD_WORKER:'YES',
 AZURE_EXPORT_APPROVED:'YES'
};
test('cloud mode rejects missing worker guard, TLS CA, invalid Azure identity',()=>{
 assert.equal(validate(env).ok,true);
 for(const bad of [
  {CAMPUSPOOL_CLOUD_WORKER:'NO'},
  {PGSSLROOTCERT:'/definitely/not/a/certificate'},
  {PGPASSWORD:'NO_INLINE_DB_SECRETS_IN_CLOUD'},
  {PGPASSFILE:'/tmp/pgpass-is-not-protected'},
  {AZURE_AUTH_MODE:'not-supported'},
  {AZURE_CLIENT_ID:'invalid'}
 ]){
  assert.equal(validate({...env,...bad}).ok,false,JSON.stringify(bad));
 }
 assert.equal(validate({...env,AZURE_CLIENT_ID:'00000000-0000-4000-8000-000000000001'}).ok,true);
});
test('runtime CA and secret files fail closed on fake PEM, loose permissions and symlinks',()=>{
  const badCa=tmp+'/invalid-ca.crt';
  fs.writeFileSync(badCa,'SYNTHETIC_NOT_A_CERTIFICATE',{mode:0o600});
  assert.ok(validate({...env,PGSSLROOTCERT:badCa}).errors.includes('CLOUD_PG_TLS_CA_REQUIRED'));
  const link=tmp+'/ca-link.crt';fs.symlinkSync(ca,link);
  assert.ok(validate({...env,PGSSLROOTCERT:link}).errors.includes('CLOUD_PG_TLS_CA_REQUIRED'));
  fs.chmodSync(passfile,0o644);
  assert.ok(validate(env).errors.includes('CLOUD_TMPFS_PGPASS_REQUIRED'));
  fs.chmodSync(passfile,0o600);
  const badPass=tmp+'/badpass';
  fs.writeFileSync(badPass,'other.pooler.supabase.com:5432:postgres:postgres.tnitksrlntrdxbvznxzf:PASSWORD\n',
    {mode:0o600});
  assert.ok(validate({...env,PGPASSFILE:badPass}).errors.includes('CLOUD_TMPFS_PGPASS_REQUIRED'));
  assert.equal(validate(env).ok,true);
});
test('child process environment never inherits cloud password or unrelated secrets',()=>{
  const {limitedEnv}=require('./scripts/azure-blob-backup');
  const pg=limitedEnv({...env,INJECTED_CANARY:'NEVER_EXPOSE'},'pg');
  assert.equal(pg.PGPASSFILE,passfile);
  assert.equal(pg.PGSSLMODE,'verify-full');
  assert.equal(pg.PGSSLROOTCERT,ca);
  assert.equal(Object.hasOwn(pg,'PGPASSWORD'),false);
  assert.equal(Object.hasOwn(pg,'INJECTED_CANARY'),false);
  const ageEnv=limitedEnv(env,'age');
  assert.equal(Object.hasOwn(ageEnv,'PGPASSFILE'),false);
  assert.equal(Object.hasOwn(ageEnv,'PGSSLROOTCERT'),false);
});

test('cloud preflight never requires local Azure CLI authentication',()=>{
 const checked=[];
 const status=preflight(env,{
  versionOk:bin=>{checked.push(bin);return true;},
  loadSdk:()=>({ManagedIdentityCredential:class{},BlobServiceClient:class{}})
 });
 assert.equal(status.ok,true);
 assert.ok(!checked.includes('az'));
 assert.ok(checked.includes('pg_dump'));
 assert.ok(checked.includes('age'));
});
function mock(){
 let stored=null,mode=null,opts=null;
 function spawnImpl(program,args,options){
  assert.equal(options.env.PGPASSWORD,undefined,'must not expose cloud password');
  assert.equal(options.env.INJECTED_CANARY,undefined);
  if(program==='pg_dump')assert.equal(options.env.PGPASSFILE,passfile);
  if(program==='age')assert.equal(options.env.PGPASSFILE,undefined);
  const c=new EventEmitter();
  c.stdout=new PassThrough();c.stdin=new PassThrough();
  c.kill=()=>true;
  if(program==='pg_dump'){
   process.nextTick(()=>{c.stdout.end(Buffer.from('PGDMP'+'.'.repeat(180)));c.emit('close',0);});
  }else if(program==='age'){
   const buffers=[];
   c.stdin.on('data',b=>buffers.push(b));
   c.stdin.on('end',()=>{c.stdout.end(Buffer.concat([Buffer.from(AGE_HEADER),...buffers]));c.emit('close',0);});
  }else throw Error('Unexpected synthetic program');
  return c;
 }
 const loadSdkImpl=()=>({
  ManagedIdentityCredential:class {
   constructor(options){mode='managed-identity';opts=options;}
  },
  AzureCliCredential:class {constructor(){throw Error('Azure CLI must not be used in cloud');}},
  BlobServiceClient:class {
   constructor(url,identity){
    assert.equal(url,'https://011campuspoolbackup.blob.core.windows.net');
    assert.ok(identity);
   }
   getContainerClient(name){
    assert.equal(name,'campuspool-staging-backups');
    return {getBlockBlobClient:key=>{
     assert.ok(key.startsWith('staging/'));
     return {
      async uploadStream(stream){
       const parts=[];for await(const b of stream)parts.push(Buffer.from(b));
       stored=Buffer.concat(parts);
      },
      async download(){return {readableStreamBody:Readable.from([stored])};}
     };
    }};
   }
  }
 });
 return {spawnImpl,loadSdkImpl,getMode:()=>mode,getOpts:()=>opts};
}
test('actual run selects managed identity and performs synthetic readback',async()=>{
 const m=mock();
 const result=await run(env,{spawnImpl:m.spawnImpl,loadSdkImpl:m.loadSdkImpl});
 assert.equal(result.status,'AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED');
  assert.equal(result.backupCoverage.globalRolesIncluded,false);
  assert.equal(result.backupCoverage.releaseReady,false);
  assert.equal(result.backupCoverage.scope,'SCOPED_APPLICATION_SCHEMAS_ONLY');
 assert.equal(m.getMode(),'managed-identity');
 assert.equal(result.bytes>100,true);
 const id=mock();
 await run({...env,AZURE_CLIENT_ID:'00000000-0000-4000-8000-000000000001'},
   {spawnImpl:id.spawnImpl,loadSdkImpl:id.loadSdkImpl});
 assert.deepEqual(id.getOpts(),{clientId:'00000000-0000-4000-8000-000000000001'});
});

test('pinned CA guard rejects unrelated public CA, multiple roots and loose permissions',()=>{
  assert.match(security.STAGING_CA_SHA256,/^[A-F0-9]{64}$/);
  assert.equal(realPinnedGuard(ca),false);
  assert.equal(security.validCaFileAgainstFingerprint(ca,testFingerprint),true);
  assert.equal(security.validCaFileAgainstFingerprint(ca,'0'.repeat(64)),false);
  const bundle=tmp+'/multiple-roots.pem';
  fs.writeFileSync(bundle,publicCa+'\n'+publicCa,{mode:0o600});
  assert.equal(security.validCaFileAgainstFingerprint(bundle,testFingerprint),false);
  const loose=tmp+'/loose-ca.pem';
  fs.writeFileSync(loose,publicCa,{mode:0o600});
  fs.chmodSync(loose,0o666);
  assert.equal(security.validCaFileAgainstFingerprint(loose,testFingerprint),false);
});

test('projected CA Secret may resolve inside its exact mount, never outside',()=>{
  const mount=tmp+'/projected-ca';
  const targetDir=mount+'/..2026_11_21';
  fs.mkdirSync(targetDir,{recursive:true,mode:0o700});
  fs.writeFileSync(targetDir+'/ca.pem',publicCa,{mode:0o444});
  fs.symlinkSync('..2026_11_21',mount+'/..data');
  const projected=mount+'/ca.pem';
  fs.symlinkSync('..data/ca.pem',projected);
  const opts={projectedCaMount:mount};
  assert.equal(security.validCaFileAgainstFingerprint(projected,testFingerprint,opts),true);
  assert.equal(security.validCaFileAgainstFingerprint(projected,testFingerprint),false,
    'symlinks never accepted outside the exact projected CA mount opt-in');
  assert.equal(security.validCloudPassFile(projected,env),false,
    'PGPASSFILE must never accept projected symlinks');
  fs.chmodSync(targetDir+'/ca.pem',0o666);
  assert.equal(security.validCaFileAgainstFingerprint(projected,testFingerprint,opts),false);
  fs.chmodSync(targetDir+'/ca.pem',0o444);
  fs.unlinkSync(mount+'/..data');
  fs.symlinkSync('..',mount+'/..data');
  fs.writeFileSync(tmp+'/ca.pem',publicCa,{mode:0o600});
  assert.equal(security.validCaFileAgainstFingerprint(projected,testFingerprint,opts),false,
    'symlink pointing outside its mount must be rejected even with matching fingerprint');
});
