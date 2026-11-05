'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const tls=require('node:tls');
const {X509Certificate}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {stagingTlsProbe,SQL}=require('./scripts/cloud-backup-tls-probe');
const {main}=require('./scripts/azure-blob-backup');

const dir=fs.mkdtempSync('/dev/shm/campuspool-tls-synthetic-');
fs.chmodSync(dir,0o700);
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
const ca=dir+'/ca.pem';
const pem=tls.rootCertificates.find(s=>{
 try{const cert=new X509Certificate(s);return cert.ca&&Date.parse(cert.validTo)>Date.now();}
 catch{return false;}
});
fs.writeFileSync(ca,pem,{mode:0o600});
const host='aws-0-ap-southeast-1.pooler.supabase.com';
const user='postgres.tnitksrlntrdxbvznxzf';
const pass=dir+'/pgpass';
fs.writeFileSync(pass,host+':5432:postgres:'+user+':SYNTHETIC_ONLY\n',{mode:0o600});
const env={
 PGHOST:host,PGPORT:'5432',PGDATABASE:'postgres',PGUSER:user,
 PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGPASSFILE:pass,
 AZURE_AUTH_MODE:'managed-identity',CAMPUSPOOL_CLOUD_WORKER:'YES',
 AGE_RECIPIENT:'age1'+'a'.repeat(58),
 AZURE_STORAGE_ACCOUNT:'011campuspoolbackup',AZURE_BACKUP_CONTAINER:'campuspool-staging-backups',
 AZURE_PRIVATE_CONTAINER_CONFIRMED:'YES'
};
function fakePsql(stdout,code=0){
 return (bin,args,opts)=>{
  assert.equal(bin,'psql');
  assert.ok(args.includes('--no-psqlrc'));
  assert.ok(args.includes('--no-password'));
  assert.ok(args.includes('ON_ERROR_STOP=1'));
  assert.deepEqual(args.slice(-2),['--command',SQL]);
  assert.ok(!SQL.toLowerCase().includes('public.'));
  assert.equal(opts.env.PGPASSWORD,undefined);
  assert.equal(opts.env.PGPASSFILE,pass);
  assert.equal(opts.env.PGSSLMODE,'verify-full');
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.kill=()=>true;
  process.nextTick(()=>{child.stdout.end(stdout);child.emit('close',code);});
  return child;
 };
}
test('staging-only read query checks actual pg_stat_ssl TLS version and no student rows',async()=>{
 const result=await stagingTlsProbe(env,{spawnImpl:fakePsql('TLS_VERIFIED\n')});
 assert.equal(result.status,'STAGING_TLS_VERIFY_FULL_PASS');
 assert.equal(result.dataRead,false);
 assert.equal(result.backupCreated,false);
});
test('psql TLS rejection or failed command never yields success',async()=>{
 await assert.rejects(()=>stagingTlsProbe(env,{spawnImpl:fakePsql('TLS_REJECTED\n')}),/STAGING_TLS_HANDSHAKE_BLOCKED/);
 await assert.rejects(()=>stagingTlsProbe(env,{spawnImpl:fakePsql('',1)}),/STAGING_TLS_HANDSHAKE_BLOCKED/);
});
test('non-verify-full SSL settings and missing valid CA fail before subprocess',async()=>{
 await assert.rejects(()=>stagingTlsProbe({...env,PGSSLMODE:'require'},{spawnImpl:()=>{throw Error('UNEXPECTED_CHILD')}}),
   /STAGING_TLS_CONFIGURATION_BLOCKED/);
});
test('CLI denies TLS probe without explicit approval and never contacts Vault',async()=>{
 const vaultEnv={...env,PGPASSFILE:undefined,
  AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net',
  AZURE_PG_SECRET_NAME:'campuspool-staging-pg-password'
 };
 const code=await main(['--check-tls'],vaultEnv,{
  versionOk:()=>true,loadSdk:()=>{throw Error('NO_TOKEN_EXPECTED')},
  fetchImpl:()=>{throw Error('NO_NETWORK_EXPECTED')}
 });
 assert.equal(code,1);
});
test('approved synthetic CLI TLS check uses protected Vault-file and no blob or dump',async()=>{
 const vaultEnv={...env,PGPASSFILE:undefined,AZURE_TLS_CHECK_APPROVED:'YES',
  AZURE_KEYVAULT_URL:'https://campuspool-backup-kv-01.vault.azure.net',
  AZURE_PG_SECRET_NAME:'campuspool-staging-pg-password'
 };
 let file;
 const code=await main(['--check-tls'],vaultEnv,{
  versionOk:()=>true,
  loadSdk:()=>({ManagedIdentityCredential:class{getToken(){
    return Promise.resolve({token:'SYNTHETIC_TEST_TOKEN'});
  }}}),
  fetchImpl:async()=>({
    ok:true,headers:{get:()=>null},
    body:new ReadableStream({start(controller){
      const obj={
        id:'https://campuspool-backup-kv-01.vault.azure.net/secrets/campuspool-staging-pg-password/'+
          'abcdef0123456789abcdef0123456789',
        attributes:{enabled:true},value:'SYNTHETIC_ONLY'
      };
      controller.enqueue(new TextEncoder().encode(JSON.stringify(obj)));
      controller.close();
    }})
  }),
  tlsProbe:async e=>{
    file=e.PGPASSFILE;
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.equal(e.AZURE_EXPORT_APPROVED,undefined);
    return {status:'STAGING_TLS_VERIFY_FULL_PASS',dataRead:false,backupCreated:false};
  }
 });
 assert.equal(code,0);
 assert.ok(file);
 assert.equal(fs.existsSync(file),false,'temporary secret must not persist');
});
