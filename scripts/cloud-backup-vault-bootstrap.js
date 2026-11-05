'use strict';
// Managed-identity Key Vault -> memory-only libpq passfile bootstrap.
// Never prints secrets, driver errors, token strings or sensitive request bodies.
const fs = require('node:fs');
const path = require('node:path');
const {validCloudPassFile} = require('./cloud-backup-runtime-security');

const SECRET_NAME='campuspool-staging-pg-password';
const TMPFS_MAGIC=0x01021994;
const VAULT_HOST_RE=/^campuspool-backup-kv-[a-z0-9]{1,3}\.vault\.azure\.net$/;

function vaultConfigOk(env){
  if(env.AZURE_AUTH_MODE!=='managed-identity' ||
     env.CAMPUSPOOL_CLOUD_WORKER!=='YES' ||
     env.AZURE_PG_SECRET_NAME!==SECRET_NAME ||
     env.PGPASSWORD || env.PGPASSFILE)return false;
  try{
    const u=new URL(env.AZURE_KEYVAULT_URL);
    return u.protocol==='https:' && !u.username && !u.password &&
      !u.search && !u.hash && (u.pathname===''||u.pathname==='/') &&
      !u.port && VAULT_HOST_RE.test(u.hostname);
  }catch{return false;}
}

function checkTmpfs(){
  try{
    return fs.realpathSync('/dev/shm')==='/dev/shm' &&
      fs.statfsSync('/dev/shm').type===TMPFS_MAGIC;
  }catch{return false;}
}

function formatPgpass(env,secret){
  if(typeof secret!=='string'||secret.length===0||secret.length>2048||
     /[\r\n\0]/.test(secret))throw Error('VAULT_PASSWORD_INVALID');
  const vals=[env.PGHOST,env.PGPORT,env.PGDATABASE,env.PGUSER];
  if(vals.some(v=>typeof v!=='string'||!v||/[:\\\r\n\0]/.test(v)))
    throw Error('VAULT_DB_IDENTITY_INVALID');
  // libpq's .pgpass requires backslash and colon to be escaped.
  const password=secret.replace(/\\/g,'\\\\').replace(/:/g,'\\:');
  return vals.join(':')+':'+password+'\n';
}

async function fetchPassword(env,{getToken,fetchImpl=globalThis.fetch}){
  if(!vaultConfigOk(env))throw Error('VAULT_CONFIGURATION_BLOCKED');
  if(typeof getToken!=='function'||typeof fetchImpl!=='function')
    throw Error('VAULT_CLIENT_UNAVAILABLE');
  const vault=env.AZURE_KEYVAULT_URL.replace(/\/$/,'');
  const url=vault+'/secrets/'+SECRET_NAME+'?api-version=7.4';
  try{
    const token=await getToken('https://vault.azure.net/.default');
    if(typeof token?.token!=='string'||token.token.length<10)
      throw Error('NO_TOKEN');
    const response=await fetchImpl(url,{
      method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+token.token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
    if(!response?.ok)throw Error('BAD_HTTP');
    const body=await response.text();
    if(body.length>16384)throw Error('OVERSIZED_BODY');
    const json=JSON.parse(body);
    if(typeof json.value!=='string'||json.value.length===0)
      throw Error('NO_VALUE');
    return json.value;
  }catch{
    // Network/SDK errors could contain headers, URLs or tokens. Never echo.
    throw Error('VAULT_SECRET_READ_BLOCKED');
  }
}

async function withProtectedPgpass(env,work,{
  getToken,fetchImpl=globalThis.fetch
}={}){
  if(typeof work!=='function')throw Error('INVALID_BACKUP_WORK');
  if(!vaultConfigOk(env))throw Error('VAULT_CONFIGURATION_BLOCKED');
  if(!checkTmpfs())throw Error('PRIVATE_TMPFS_UNAVAILABLE');
  let dir=null;
  try{
    const password=await fetchPassword(env,{getToken,fetchImpl});
    const pgpass=formatPgpass(env,password);
    dir=fs.mkdtempSync('/dev/shm/campuspool-vault-pgpass-');
    fs.chmodSync(dir,0o700);
    const file=path.join(dir,'pgpass');
    const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
      (fs.constants.O_NOFOLLOW||0);
    const fd=fs.openSync(file,flags,0o600);
    try{fs.writeFileSync(fd,pgpass,{encoding:'utf8'});}
    finally{fs.closeSync(fd);}
    if(!validCloudPassFile(file,env))throw Error('VAULT_PGPASS_VALIDATION_BLOCKED');
    const protectedEnv={...env,PGPASSFILE:file};
    return await work(protectedEnv);
  }finally{
    if(dir)fs.rmSync(dir,{recursive:true,force:true});
  }
}
module.exports={SECRET_NAME,vaultConfigOk,checkTmpfs,formatPgpass,fetchPassword,withProtectedPgpass};
