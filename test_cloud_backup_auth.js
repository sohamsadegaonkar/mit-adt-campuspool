'use strict';
// Cloud managed identity tests use only synthetic data and fake SDK clients.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PassThrough,Readable}=require('node:stream');
const {EventEmitter}=require('node:events');
const {validate,preflight,run}=require('./scripts/azure-blob-backup');
const tmp=fs.mkdtempSync('/dev/shm/campuspool-cloud-worker-tests-');
fs.chmodSync(tmp,0o700);
const ca=tmp+'/fake-ca.crt';
fs.writeFileSync(ca,'SYNTHETIC_TEST_CA_ONLY\n',{mode:0o600});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const env={
 PGUSER:'postgres.tnitksrlntrdxbvznxzf',
 PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
 PGDATABASE:'postgres',PGPORT:'5432',PGSSLMODE:'verify-full',
 PGSSLROOTCERT:ca,PGPASSWORD:'NOT_A_REAL_PASSWORD',
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
  {AZURE_AUTH_MODE:'not-supported'},
  {AZURE_CLIENT_ID:'invalid'}
 ]){
  assert.equal(validate({...env,...bad}).ok,false,JSON.stringify(bad));
 }
 assert.equal(validate({...env,AZURE_CLIENT_ID:'00000000-0000-4000-8000-000000000001'}).ok,true);
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
 function spawnImpl(program,args){
  const c=new EventEmitter();
  c.stdout=new PassThrough();c.stdin=new PassThrough();
  c.kill=()=>true;
  if(program==='pg_dump'){
   process.nextTick(()=>{c.stdout.end(Buffer.from('PGDMP'+'.'.repeat(180)));c.emit('close',0);});
  }else if(program==='age'){
   const buffers=[];
   c.stdin.on('data',b=>buffers.push(b));
   c.stdin.on('end',()=>{c.stdout.end(Buffer.concat([Buffer.from('CIPHERTEXT'),...buffers]));c.emit('close',0);});
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
 assert.equal(m.getMode(),'managed-identity');
 assert.equal(result.bytes>100,true);
 const id=mock();
 await run({...env,AZURE_CLIENT_ID:'00000000-0000-4000-8000-000000000001'},
   {spawnImpl:id.spawnImpl,loadSdkImpl:id.loadSdkImpl});
 assert.deepEqual(id.getOpts(),{clientId:'00000000-0000-4000-8000-000000000001'});
});
