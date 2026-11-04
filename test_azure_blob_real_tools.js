'use strict';
// Real PostgreSQL 17 and age binaries; synthetic rows and RAM-only fake Blob.
// Docker container has no networking and a tmpfs data directory.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {run,ACCOUNT,CONTAINER}=require('./scripts/azure-blob-backup');

function command(program,args){
  const p=spawnSync(program,args,{encoding:'utf8',timeout:30000,
    stdio:['ignore','pipe','pipe']});
  assert.equal(p.status,0,program+' synthetic subprocess failed');
  return (p.stdout||'').trim();
}
function closed(child){
  return new Promise((resolve,reject)=>{
    child.once('error',()=>reject(Error('Synthetic child launch failed')));
    child.once('close',code=>resolve(code));
  });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real subprocess streaming and independent synthetic encrypted restore',
  {timeout:150000},async()=>{
  assert.equal(process.platform,'linux');
  assert.equal(fs.statfsSync('/dev/shm').type,0x01021994);
  command('docker',['info','--format','{{.ServerVersion}}']);
  command('docker',['image','inspect','postgres:17','--format','{{.Id}}']);
  command('age',['--version']);
  const temp=fs.mkdtempSync('/dev/shm/campuspool-azure-realtools-');
  fs.chmodSync(temp,0o700);
  const cid='campuspool-azure-rt-'+process.pid+'-'+crypto.randomBytes(4).toString('hex');
  let started=false;
  try{
    const identity=temp+'/identity.txt';
    command('age-keygen',['-o',identity]);
    const recipient=command('age-keygen',['-y',identity]);
    assert.match(recipient,/^age1[0-9a-z]{45,90}$/);
    command('docker',['run','--pull=never','--rm','-d','--name',cid,
      '--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m',
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    started=true;
    let ready=false;
    for(let i=0;i<60;i++){
      const p=spawnSync('docker',['exec',cid,'pg_isready','-q','-U','postgres'],
        {stdio:'ignore',timeout:3000});
      if(p.status===0){ready=true;break;}
      await pause(250);
    }
    assert.ok(ready,'Disposable PostgreSQL 17 was not ready');
    const createSQL=[
      'CREATE TABLE public.backup_probe(id integer PRIMARY KEY)',
      'INSERT INTO public.backup_probe VALUES (1),(2)',
      'CREATE SCHEMA supabase_migrations',
      'CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)',
      "INSERT INTO supabase_migrations.schema_migrations VALUES ('synthetic_001')"
    ].join('; ')+';';
    command('docker',['exec',cid,'psql','-X','-U','postgres','-d','postgres',
      '-v','ON_ERROR_STOP=1','-q','-c',createSQL]);
    command('docker',['exec',cid,'createdb','-U','postgres','campuspool_restore']);

    // Allowlisted source names are dummy configuration. pg_dump is intercepted;
    // Docker's --network none prevents any staging or public DB connection.
    const env={
      PATH:process.env.PATH,HOME:process.env.HOME||'/',
      PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
      PGUSER:'postgres.tnitksrlntrdxbvznxzf',
      PGDATABASE:'postgres',PGPORT:'5432',PGSSLMODE:'verify-full',
      PGPASSWORD:'SYNTHETIC_ONLY',
      AZURE_STORAGE_ACCOUNT:ACCOUNT,AZURE_BACKUP_CONTAINER:CONTAINER,
      AZURE_PRIVATE_CONTAINER_CONFIRMED:'YES',AZURE_CONFIG_DIR:temp,
      AGE_RECIPIENT:recipient,AZURE_EXPORT_APPROVED:'YES'
    };
    let dumpCalls=0;
    const spawnImpl=(program,args,opts)=>{
      if(program==='pg_dump'){
        dumpCalls++;
        assert.ok(!args.some(a=>a==='-'||a.startsWith('--file')),
          'No plaintext output file arguments permitted');
        return spawn('docker',['exec',cid,'pg_dump','-U','postgres',
          '--dbname=postgres',...args],
          {stdio:opts.stdio,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
      }
      if(program==='age')return spawn('age',args,opts);
      throw Error('Unexpected child program in synthetic test');
    };
    let ciphertext,blobKey,uploadOptions;
    const blob={
      async uploadStream(stream,_blockSize,_concurrency,opts){
        uploadOptions=opts;
        const parts=[];
        for await(const chunk of stream)parts.push(Buffer.from(chunk));
        ciphertext=Buffer.concat(parts);
      },
      async download(){
        assert.ok(ciphertext);
        return {readableStreamBody:Readable.from([ciphertext])};
      }
    };
    const loadSdkImpl=()=>({
      AzureCliCredential:class FakeCredential {},
      BlobServiceClient:class FakeBlobService {
        constructor(url){assert.equal(url,'https://'+ACCOUNT+'.blob.core.windows.net');}
        getContainerClient(name){
          assert.equal(name,CONTAINER);
          return {getBlockBlobClient:key=>{
            blobKey=key;
            assert.ok(key.startsWith('staging/')&&key.endsWith('.pgdump.age'));
            return blob;
          }};
        }
      }
    });
    const result=await run(env,{spawnImpl,loadSdkImpl});
    assert.equal(result.status,'AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED');
    assert.equal(dumpCalls,1);
    assert.equal(result.objectKey,blobKey);
    assert.deepEqual(uploadOptions.conditions,{ifNoneMatch:'*'});
    assert.ok(ciphertext.length>500,'Encrypted archive too small');
    assert.notEqual(ciphertext.subarray(0,5).toString(),'PGDMP');
    assert.equal(result.bytes,ciphertext.length);

    // Decrypt exactly the captured blob bytes into a different DB via pipes.
    const decrypt=spawn('age',['--decrypt','--identity',identity],
      {stdio:['pipe','pipe','ignore']});
    const restore=spawn('docker',['exec','-i',cid,'pg_restore','-U','postgres',
      '-d','campuspool_restore','--clean','--if-exists','--no-owner',
      '--no-acl','--exit-on-error'],
      {stdio:['pipe','ignore','ignore']});
    const work=await Promise.allSettled([
      pipeline(Readable.from([ciphertext]),decrypt.stdin),
      pipeline(decrypt.stdout,restore.stdin),
      closed(decrypt),closed(restore)
    ]);
    assert.ok(work.every(r=>r.status==='fulfilled'),'AGE/pg_restore pipes failed');
    assert.equal(work[2].value,0,'AGE decryption did not complete');
    assert.equal(work[3].value,0,'PostgreSQL restore did not complete');
    const ids=command('docker',['exec',cid,'psql','-X','-U','postgres',
      '-d','campuspool_restore','-qAt','-c',
      "SELECT string_agg(id::text, ',' ORDER BY id) FROM public.backup_probe"]);
    assert.equal(ids,'1,2');
    const ledger=command('docker',['exec',cid,'psql','-X','-U','postgres',
      '-d','campuspool_restore','-qAt','-c',
      'SELECT version FROM supabase_migrations.schema_migrations']);
    assert.equal(ledger,'synthetic_001');
    assert.ok(!fs.existsSync('./-'),'Unexpected local plaintext archive file');
  }finally{
    if(started)spawnSync('docker',['rm','-f',cid],{stdio:'ignore',timeout:30000});
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
