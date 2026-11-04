'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {PassThrough,Readable}=require('node:stream');
const {EventEmitter}=require('node:events');
const {ACCOUNT,CONTAINER,validate,limitedEnv,preflight,keyAt,run}=
  require('./scripts/azure-blob-backup');

const dir=fs.mkdtempSync('/dev/shm/campuspool-azure-ci-');
fs.chmodSync(dir,0o700);
process.on('exit',()=>{try{fs.rmSync(dir,{recursive:true,force:true});}catch(_){}});
const REF='tnitksrlntrdxbvznxzf';
const env={
 PGUSER:'postgres.'+REF,PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
 PGDATABASE:'postgres',PGPORT:'5432',PGSSLMODE:'verify-full',
 PGPASSWORD:'SYNTHETIC_DB_PASSWORD_DO_NOT_PRINT',
 AZURE_STORAGE_ACCOUNT:ACCOUNT,AZURE_BACKUP_CONTAINER:CONTAINER,
 AZURE_PRIVATE_CONTAINER_CONFIRMED:'YES',
 AGE_RECIPIENT:'age1'+'a'.repeat(58),
 AZURE_CONFIG_DIR:dir,AZURE_EXPORT_APPROVED:'YES'
};
function mock({corrupt=false,uploadError=false}={}){
 let stored,opts;
 const commands=[];
 function spawnImpl(program,args,options){
   commands.push({program,args,env:options.env});
   const c=new EventEmitter();
   c.stdout=new PassThrough();c.stdin=new PassThrough();
   c.kill=()=>true; // Mock Node ChildProcess cancellation contract.
   if(program==='pg_dump'){
     process.nextTick(()=>{
       c.stdout.end(Buffer.from('FAKE_POSTGRES_CUSTOM_ARCHIVE'+'.'.repeat(100)));
       c.emit('close',0);
     });
   }else if(program==='age'){
     const chunks=[];
     c.stdin.on('data',b=>chunks.push(b));
     c.stdin.on('end',()=>{
       c.stdout.end(Buffer.concat([Buffer.from('CIPHERTEXT:'),...chunks]));
       c.emit('close',0);
     });
   }else throw Error('Unexpected synthetic program '+program);
   return c;
 }
 const blob={
   async uploadStream(stream,_size,_parallel,options){
     opts=options;
     const chunks=[];
     for await(const b of stream)chunks.push(b);
     if(uploadError)throw Error('MOCK_CLOUD_FAILURE');
     stored=Buffer.concat(chunks);
   },
   async download(){
     const bytes=corrupt?Buffer.concat([stored,Buffer.from('bad')]):stored;
     return {readableStreamBody:Readable.from([bytes])};
   }
 };
 const loadSdkImpl=()=>({
   AzureCliCredential:class {},
   BlobServiceClient:class {
     constructor(url){assert.equal(url,'https://011campuspoolbackup.blob.core.windows.net');}
     getContainerClient(name){
       assert.equal(name,'campuspool-staging-backups');
       return {getBlockBlobClient:key=>{
         assert.ok(key.startsWith('staging/'));return blob;
       }};
     }
   }
 });
 return {spawnImpl,loadSdkImpl,commands,getStored:()=>stored,getOpts:()=>opts};
}
test('exact source and Azure account/container, verified TLS, private container, age recipient and RAM auth cache',()=>{
 assert.equal(validate(env).ok,true);
 for(const patch of [
   {PGUSER:'postgres.other'},{PGHOST:'db.example.com'},
   {PGSSLMODE:'require'},{PGPORT:'6543'},
   {AZURE_STORAGE_ACCOUNT:'attacker'},
   {AZURE_BACKUP_CONTAINER:'public'},
   {AZURE_PRIVATE_CONTAINER_CONFIRMED:'NO'},
   {PGPASSWORD:''},{AGE_RECIPIENT:'invalid'},
   {AZURE_CONFIG_DIR:'/tmp'},
   {AZURE_CONFIG_DIR:'/'}
 ])assert.equal(validate({...env,...patch}).ok,false,JSON.stringify(patch));
 assert.ok(!JSON.stringify(validate({...env,PGPASSWORD:''})).includes('SYNTHETIC_DB_PASSWORD'));
});
test('operator-only preflight requires command versions and Azure SDK, never contacts storage',()=>{
 const v=preflight(env,{versionOk:(bin,re)=>bin==='age'?re.test('v1.3.1'):true,loadSdk:()=>({})});
 assert.equal(v.ok,true);
 const denied=preflight(env,{versionOk:()=>false,loadSdk:()=>{throw Error('not installed')}});
 assert.equal(denied.ok,false);
 assert.ok(denied.errors.includes('AZURE_NODE_SDK_REQUIRED'));
});
test('credential isolation and unpredictable object keys',()=>{
 const pg=limitedEnv(env,'pg'),age=limitedEnv(env,'age');
 assert.equal(pg.PGPASSWORD,env.PGPASSWORD);
 assert.equal(age.PGPASSWORD,undefined);
 assert.equal(pg.AZURE_EXPORT_APPROVED,undefined);
 assert.equal(pg.AZURE_CONFIG_DIR,undefined);
 assert.throws(()=>limitedEnv(env,'cloud'));
 assert.match(keyAt(new Date('2026-11-04T00:00:00Z'),Buffer.alloc(16,2)),/^staging\/.*0202.*\.pgdump\.age$/);
});
test('encrypted streaming upload uses a consistent two-schema PostgreSQL snapshot and SHA256 readback',async()=>{
 const m=mock();
 const result=await run(env,{spawnImpl:m.spawnImpl,loadSdkImpl:m.loadSdkImpl,
   now:new Date('2026-11-04T12:00:00Z'),nonce:Buffer.alloc(16,1)});
 assert.equal(result.status,'AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED');
 assert.ok(m.getStored().toString().startsWith('CIPHERTEXT:'));
 assert.equal(result.ciphertextSHA256,crypto.createHash('sha256').update(m.getStored()).digest('hex'));
 const pg=m.commands.find(x=>x.program==='pg_dump');
 assert.deepEqual(pg.args,['--format=custom','--schema=public',
   '--schema=supabase_migrations','--no-password','--file=-']);
 assert.ok(!pg.args.join(' ').includes(env.PGPASSWORD));
 assert.deepEqual(m.getOpts().conditions,{ifNoneMatch:'*'});
});
test('tampered Azure readback fails; the upload does not approve any restore',async()=>{
 await assert.rejects(run(env,{...mock({corrupt:true})}),/AZURE_CIPHERTEXT_SHA256_MISMATCH/);
});
test('cloud upload failures and missing operator approval refuse success',async()=>{
 const m=mock({uploadError:true});
 await assert.rejects(run(env,{spawnImpl:m.spawnImpl,loadSdkImpl:m.loadSdkImpl}),
   /DATABASE_EXPORT_OR_ENCRYPTED_UPLOAD_FAILED/);
 await assert.rejects(run({...env,AZURE_EXPORT_APPROVED:''}),/EXPLICIT_OPERATOR_APPROVAL_REQUIRED/);
});
