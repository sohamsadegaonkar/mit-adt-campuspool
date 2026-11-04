'use strict';
// Local-operator preflight ONLY. Never prints credentials or connects to a database.
const fs=require('node:fs');
const path=require('node:path');
const STAGING_REF='tnitksrlntrdxbvznxzf';

function extractRef(raw){
  if(typeof raw!=='string'||!raw)throw Error('Missing database connection URL');
  let u;
  try{u=new URL(raw);}catch{throw Error('Invalid PostgreSQL connection URL');}
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.password||!u.username ||
     u.pathname!=='/postgres'||u.searchParams.get('sslmode')==='disable' ||
     u.hostname!==u.hostname.toLowerCase()){
    throw Error('Unsupported PostgreSQL URL, disabled TLS or missing credentials');
  }
  const direct=/^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  if(direct)return direct[1];
  // Supabase session-pooler. The username must carry the project ID.
  if(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)){
    const user=decodeURIComponent(u.username);
    const match=/^[a-zA-Z0-9_]+\.([a-z0-9]{20})$/.exec(user);
    if(match)return match[1];
  }
  throw Error('Refusing non-Supabase or unscoped database connection');
}
function within(parent,child){
  return child===parent || child.startsWith(parent+path.sep);
}
function safeDir(value,label){
  if(!value||!path.isAbsolute(value))throw Error(label+' must be an absolute path');
  let real;
  try{real=fs.realpathSync(value);}catch{throw Error(label+' must already exist');}
  if(!fs.statSync(real).isDirectory())throw Error(label+' must be a directory');
  if(real===path.parse(real).root)throw Error(label+' must not be a filesystem root');
  return real;
}
function validatePlan(env){
  if(extractRef(env.STAGING_DB_URL)!==STAGING_REF)
    throw Error('Refusing to export any database other than dedicated CampusPool staging');
  if(env.STAGING_WORKDIR_ENCRYPTED!=='YES')
    throw Error('Operator has not confirmed encrypted local temporary work volume');
  if(env.OFFSITE_MOUNT_VERIFIED!=='YES')
    throw Error('Operator has not confirmed encrypted remote off-site mount');
  if(!/^age1[0-9a-z]{20,}$/.test(env.AGE_RECIPIENT||''))
    throw Error('AGE_RECIPIENT must be an age public recipient key');
  const work=safeDir(env.STAGING_ENCRYPTED_WORKDIR,'STAGING_ENCRYPTED_WORKDIR');
  const offsite=safeDir(env.OFFSITE_DIR,'OFFSITE_DIR');
  const repository=fs.realpathSync(path.join(__dirname,'..'));
  if(within(repository,work)||within(repository,offsite))
    throw Error('Backup directories must be outside the repository');
  if(within(work,offsite)||within(offsite,work))
    throw Error('Working directory and off-site destination cannot overlap');
  return {source:'campuspool-staging-db',projectRef:STAGING_REF,
    workDir:work,offsiteDir:offsite,encrypt:true,remoteProof:false};
}
if(require.main===module){
  try{
    validatePlan(process.env);
    console.log('[STAGING BACKUP] Target/path/recipient guard passed. No database was accessed.');
  }catch{
    // Fail closed, with no URLs/paths/private-key details in logs.
    console.error('[STAGING BACKUP] BLOCKED: invalid or incomplete private operator configuration.');
    process.exitCode=1;
  }
}
module.exports={STAGING_REF,extractRef,validatePlan};
