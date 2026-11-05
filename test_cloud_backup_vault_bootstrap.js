'use strict';
// No Azure, Supabase or network calls. All credentials/CA values are synthetic.
const test=require('node:test');
const AGE_HEADER='age-encryption.org/v1\n-> X25519 '+'A'.repeat(43)+'\n'+'B'.repeat(43)+'\n--- '+'C'.repeat(43)+'\n';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const tls=require('node:tls');
const {X509Certificate}=require('node:crypto');
const {PassThrough,Readable}=require('node:stream');
const {EventEmitter}=require('node:events');
const {main,validate}=require('./scripts/azure-blob-backup');
const {SECRET_NAME,vaultConfigOk,formatPgpass,fetchPassword,withProtectedPgpass,checkTmpfs}
  =require('./scripts/cloud-backup-vault-bootstrap');

const dir=fs.mkdtempSync('/dev/shm/campuspool-vault-synthetic-');
fs.chmodSync(dir,0o700);
const ca=dir+'/ca.crt';
const trusted=tls.rootCertificates.find(pem=>{
  try{
    const c=new X509Certificate(pem);
    return c.ca&&Date.parse(c.validFrom)<Date.now()&&Date.parse(c.validTo)>Date.now();
  }catch{return false;}
});
assert.ok(trusted,'need a synthetically selected public CA');
fs.writeFileSync(ca,trusted,{mode:0o600});
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));

const env={
  AZURE_AUTH_MODE:'managed-identity',CAMPUSPOOL_CLOUD_WORKER:'YES',
  AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net/',
  AZURE_PG_SECRET_NAME:SECRET_NAME,
  PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
  PGUSER:'postgres.tnitksrlntrdxbvznxzf',
  PGPORT:'5432',PGDATABASE:'postgres',PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,
  AZURE_STORAGE_ACCOUNT:'011campuspoolbackup',
  AZURE_BACKUP_CONTAINER:'campuspool-staging-backups',
  AZURE_PRIVATE_CONTAINER_CONFIRMED:'YES',
  AGE_RECIPIENT:'age1'+'a'.repeat(58)
};
const PASSWORD='SYNTHETIC:password\\with:colons';
const getToken=async scope=>{
  assert.equal(scope,'https://vault.azure.net/.default');
  return {token:'SYNTHETIC_TEST_TOKEN_ONLY'};
};
const fetchImpl=async (url,request)=>{
  assert.equal(url,'https://campuspool-backup-kv-01.vault.azure.net/secrets/'+SECRET_NAME+'?api-version=7.4');
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  assert.equal(request.headers.Authorization,'Bearer SYNTHETIC_TEST_TOKEN_ONLY');
  return secretResponse({value:PASSWORD});
};

function secretResponse(fields){
  const payload=JSON.stringify({
    id:'https://campuspool-backup-kv-01.vault.azure.net/secrets/'+SECRET_NAME+'/'+
      'abcdef0123456789abcdef0123456789',
    attributes:{enabled:true},
    ...fields
  });
  return {
    ok:true,headers:{get:()=>null},
    body:new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    }})
  };
}

test('cloud URL is precisely restricted to expected staging Key Vault host',()=>{
  assert.equal(vaultConfigOk(env),true);
  for(const bad of [
    {AZURE_KEYVAULT_URL:'http://campuspool-backup-kv-01.vault.azure.net'},
    {AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net.attacker.invalid'},
    {AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net.extra.vault.azure.net'},
    {AZURE_KEYVAULT_URL:'https://a@campuspool-backup-kv-01.vault.azure.net'},
    {AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net/secrets/test'},
    {AZURE_PG_SECRET_NAME:'other-secret'},
    {PGPASSWORD:'SHOULD_BLOCK'},
    {PGPASSFILE:'/tmp/should-not-be-supplied'}
  ])assert.equal(vaultConfigOk({...env,...bad}),false,JSON.stringify(bad));
});

test('libpq special characters are escaped; newline, null and empty are rejected',()=>{
  assert.ok(formatPgpass(env,PASSWORD).endsWith(':SYNTHETIC\\:password\\\\with\\:colons\n'));
  for(const bad of ['', 'line\nbreak', 'line\rbreak','nul\0byte'])
    assert.throws(()=>formatPgpass(env,bad),/VAULT_PASSWORD_INVALID/);
});

test('actual tmpfs file is 0600 and automatically removed after callback succeeds',async()=>{
  assert.equal(checkTmpfs(),true);
  let created;
  const result=await withProtectedPgpass(env,async e=>{
    assert.equal(validate(e).ok,true);
    created=e.PGPASSFILE;
    assert.equal(fs.statSync(created).mode&0o777,0o600);
    assert.equal(fs.statSync(created).uid,process.getuid());
    assert.equal(fs.readFileSync(created,'utf8'),formatPgpass(env,PASSWORD));
    return 'SYNTHETIC_OK';
  },{getToken,fetchImpl});
  assert.equal(result,'SYNTHETIC_OK');
  assert.equal(fs.existsSync(created),false);
  assert.equal(fs.existsSync(require('node:path').dirname(created)),false);
});

test('temporary secret is removed even when work fails',async()=>{
  let created;
  await assert.rejects(()=>withProtectedPgpass(env,async e=>{
    created=e.PGPASSFILE;
    throw Error('SYNTHETIC_WORK_FAILURE');
  },{getToken,fetchImpl}),/SYNTHETIC_WORK_FAILURE/);
  assert.equal(fs.existsSync(created),false);
});

test('Vault API failures are sanitized with no token, URI or body leakage',async()=>{
  await assert.rejects(
    ()=>fetchPassword(env,{getToken,fetchImpl:async()=>{throw Error('sensitive token: TEST_TOKEN');}}),
    e=>e.message==='VAULT_SECRET_READ_BLOCKED');
});

test('rejects mismatched or disabled Key Vault secret identity',async()=>{
  for(const fields of [
    {id:'https://other-vault.vault.azure.net/secrets/'+SECRET_NAME+'/abcdef0123456789abcdef0123456789'},
    {id:'https://campuspool-backup-kv-01.vault.azure.net/secrets/other/abcdef0123456789abcdef0123456789'},
    {attributes:{enabled:false}},
    {attributes:{enabled:true,exp:1}}
  ]){
    await assert.rejects(
      ()=>fetchPassword(env,{getToken,fetchImpl:async()=>secretResponse({...fields,value:PASSWORD})}),
      e=>e.message==='VAULT_SECRET_READ_BLOCKED');
  }
});

test('rejects oversized Key Vault response without allocating unbounded text',async()=>{
  let cancelCalled=false;
  const big=new Uint8Array(20000).fill(65);
  const response={
    ok:true,headers:{get:()=>null},
    body:new ReadableStream({
      start(controller){controller.enqueue(big);},
      cancel(){cancelCalled=true;}
    })
  };
  await assert.rejects(
    ()=>fetchPassword(env,{getToken,fetchImpl:async()=>response}),
    e=>e.message==='VAULT_SECRET_READ_BLOCKED');
  assert.equal(cancelCalled,true);
});

test('offline preflight does not request token, Key Vault, staging or Blob',async()=>{
  const code=await main(['--preflight'],env,{
    versionOk:()=>true,
    loadSdk:()=>({ManagedIdentityCredential:class{constructor(){throw Error('SHOULD_NOT_CONSTRUCT')}}}),
    fetchImpl:()=>{throw Error('SHOULD_NOT_FETCH')}
  });
  assert.equal(code,0);
});

test('no explicit export approval means zero Key Vault requests',async()=>{
  const code=await main(['--execute'],env,{
    versionOk:()=>true,
    loadSdk:()=>({ManagedIdentityCredential:class{constructor(){throw Error('SHOULD_NOT_CONSTRUCT')}}}),
    fetchImpl:()=>{throw Error('SHOULD_NOT_FETCH')}
  });
  assert.equal(code,1);
});

test('approved synthetic end-to-end stream uses protected passfile, never plaintext env',async()=>{
  const runEnv={...env,AZURE_EXPORT_APPROVED:'YES',INJECTED_CANARY:'NO'};
  let encrypted=null,observedPath,closed=false;
  function spawnImpl(bin,_args,opts){
    assert.equal(opts.env.PGPASSWORD,undefined);
    assert.equal(opts.env.INJECTED_CANARY,undefined);
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;
    if(bin==='pg_dump'){
      observedPath=opts.env.PGPASSFILE;
      assert.ok(fs.existsSync(observedPath));
      assert.equal(fs.statSync(observedPath).mode&0o777,0o600);
      process.nextTick(()=>{
        child.stdout.end(Buffer.from('PGDMP'+'.'.repeat(180)));
        child.emit('close',0);
      });
    }else if(bin==='age'){
      assert.equal(opts.env.PGPASSFILE,undefined);
      const chunks=[];
      child.stdin.on('data',part=>chunks.push(part));
      child.stdin.on('end',()=>{
        child.stdout.end(Buffer.concat([Buffer.from(AGE_HEADER),...chunks]));
        child.emit('close',0);
      });
    }else throw Error('Unexpected subprocess');
    return child;
  }
  const loadSdkImpl=()=>({
    ManagedIdentityCredential:class{},
    BlobServiceClient:class{
      getContainerClient(){return {getBlockBlobClient(){return {
        async uploadStream(stream){
          const chunks=[];for await(const c of stream)chunks.push(Buffer.from(c));
          encrypted=Buffer.concat(chunks);
        },
        async download(){return {readableStreamBody:Readable.from([encrypted])};}
      };}};}
    }
  });
  const code=await main(['--execute'],runEnv,{
    versionOk:()=>true,
    loadSdk:()=>({
      ManagedIdentityCredential:class{getToken(scope){return getToken(scope);}}
    }),
    fetchImpl,
    runOptions:{spawnImpl,loadSdkImpl}
  });
  assert.equal(code,0);
  assert.ok(encrypted?.length>50);
  assert.equal(fs.existsSync(observedPath),false,'passfile must be destroyed after backup');
});
