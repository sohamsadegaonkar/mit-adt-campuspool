'use strict';

/**
 * Read-only startup-configuration preflight for CampusPool.
 * This is intentionally NOT a release approval: real provider delivery,
 * backup/restore, credential rotation and rollback must be reviewed separately.
 * No network calls, environment writes or secret-value printing.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');

const EXPOSED_OTP_FINGERPRINT='5fb097213f66224b532793a99a1b6d30d5a7af86d8ba8a9874b661a2484c8382';

function privateSecret(value){
  return typeof value==='string' && value.length>=32 &&
    crypto.createHash('sha256').update(value).digest('hex')!==EXPOSED_OTP_FINGERPRINT;
}
function hasValue(value){
  return typeof value==='string' && value.trim().length>0;
}
function emailLike(value){
  return typeof value==='string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}
function certificateFile(value,fsImpl=fs){
  if(!hasValue(value))return false;
  try{
    const stat=fsImpl.statSync(value);
    return stat.isFile() && stat.size>0;
  }catch(_){return false;}
}
function privatePostgresUrl(value){
  if(!hasValue(value))return false;
  try{
    const u=new URL(value);
    if(!['postgres:','postgresql:'].includes(u.protocol)||
       !u.username || !u.password ||
       !/^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$|^db\.[a-z0-9-]+\.supabase\.co$/i.test(u.hostname) ||
       u.port!=='5432' || u.hash)return false;
    // A 'disable' or 'allow' mode must never silently bypass expected TLS.
    const sslmode=u.searchParams.get('sslmode');
    return !sslmode || ['require','verify-ca','verify-full'].includes(sslmode);
  }catch(_){return false;}
}
function checkRuntime({target,env=process.env,fsImpl=fs}={}){
  if(target!=='production' && target!=='staging')throw Error('TARGET_MUST_BE_PRODUCTION_OR_STAGING');
  const checks=[];
  const check=(code,ok)=>checks.push({code,ok:Boolean(ok)});
  const manual=[
    'CONFIRM_HISTORICAL_CREDENTIALS_REVOKED',
    'CONFIRM_REAL_OTP_INBOX_AND_HANDSET_DELIVERY',
    'CONFIRM_ENCRYPTED_BACKUP_INDEPENDENT_RESTORE_AND_ROLLBACK',
    'CONFIRM_INDEPENDENT_REVIEW_AND_RELEASE_APPROVAL'
  ];

  check('NODE_ENV_PRODUCTION',env.NODE_ENV==='production');
  check('OTP_SECRET_STRONG_NOT_KNOWN_EXPOSED',privateSecret(env.OTP_SECRET));
  const isStaging=target==='staging';

  if(!isStaging){
    // Mirrors the currently deployed, legacy SQLite runtime profile.
    // A PostgreSQL production promotion is a DIFFERENT supervised release.
    check('PRODUCTION_NOT_MARKED_STAGING',env.APP_ENV!=='staging');
    check('LEGACY_AUTH_BACKEND',!env.AUTH_OTP_BACKEND || env.AUTH_OTP_BACKEND==='sqlite');
    check('LEGACY_RIDES_BACKEND',!env.RIDES_BACKEND || env.RIDES_BACKEND==='sqlite');
    check('MOBILITY_FLAG_OFF',env.MOBILITY_MATCHING_ENABLED!=='true');
    check('SMTP_SENDER_CONFIGURED',emailLike(env.SMTP_USER) && hasValue(env.SMTP_PASS)
      && hasValue(env.SMTP_FROM) && emailLike(env.SMTP_FROM.match(/<([^<>]+)>/)?.[1]||env.SMTP_FROM));
    check('SMTP_HOST_CONFIGURED',hasValue(env.SMTP_HOST)&&!/\s/.test(env.SMTP_HOST));
    const port=env.SMTP_PORT||'465',secure=env.SMTP_SECURE||'true';
    check('SMTP_PORT_TLS_CONSISTENT',(port==='465' && secure==='true')||
      (port==='587' && secure==='false'));
    manual.push('LEGACY_SQLITE_DATA_PERSISTENCE_NOT_PRODUCTION_DURABILITY');
    manual.push('SMTP_PASSWORD_ROTATION_AND_REAL_DELIVERY_UNVERIFIED');
  }else{
    check('STAGING_ISOLATED_APP_ENV',env.APP_ENV==='staging');
    check('STAGING_BASIC_AUTH_PRIVATE',hasValue(env.STAGING_BASIC_AUTH_PASSWORD) &&
      env.STAGING_BASIC_AUTH_PASSWORD.length>=20);
    check('POSTGRES_IDENTITY_BACKEND',env.AUTH_OTP_BACKEND==='postgres');
    check('POSTGRES_RIDES_BACKEND',env.RIDES_BACKEND==='postgres');
    check('POSTGRES_DATABASE_URL_PRIVATE_POOLER',privatePostgresUrl(env.OTP_DATABASE_URL));
    check('POSTGRES_TLS_ENABLED',env.OTP_DB_SSL==='true');
    check('POSTGRES_CA_SECRET_FILE_PRESENT',certificateFile(env.NODE_EXTRA_CA_CERTS,fsImpl));
    check('OTP_HMAC_KEY_PRIVATE_AND_DISTINCT',privateSecret(env.OTP_HMAC_KEY) &&
      env.OTP_HMAC_KEY!==env.OTP_SECRET);
    const mail=env.EMAIL_PROVIDER;
    check('TRANSACTIONAL_EMAIL_PROVIDER_CONFIGURED',mail==='resend' &&
      hasValue(env.RESEND_API_KEY) && emailLike(env.EMAIL_FROM));
    const sms=env.SMS_PROVIDER||'disabled';
    check('SMS_PROVIDER_EXPLICITLY_SAFE',sms==='disabled' ||
      (sms==='msg91' && hasValue(env.MSG91_AUTHKEY) && hasValue(env.MSG91_FLOW_TEMPLATE_ID)));
    if(sms==='disabled')manual.push('STAGING_SMS_OTP_DISABLED_CANNOT_VERIFY_COMPLETE_SIGNUP');
    if(env.MOBILITY_MATCHING_ENABLED==='true')manual.push('MOBILITY_FLAG_REQUIRES_INDEPENDENT_PRIVACY_ACCEPTANCE');
    // No live connections or certificate validation are performed by this checker.
    manual.push('DATABASE_CONNECTIVITY_AND_CA_TRUST_NOT_TESTED');
  }
  const failed=checks.filter(c=>!c.ok).map(c=>c.code);
  return {
    target,
    status:failed.length?'CONFIG_BLOCKED':'CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED',
    checks,failed,manual,
    note:'Read-only configuration check; not a security, backup, provider delivery or deployment approval.'
  };
}
function parseArgs(args){
  if(args.includes('--help') || args.includes('-h'))return {help:true};
  let target;
  const json=args.includes('--json');
  for(let i=0;i<args.length;i++){
    if(args[i]==='--target')target=args[++i];
    else if(args[i].startsWith('--target='))target=args[i].slice('--target='.length);
    else if(args[i]!=='--json')throw Error('INVALID_ARGUMENT');
  }
  if(!['production','staging'].includes(target))throw Error('TARGET_REQUIRED');
  return {target,json};
}
function main(argv=process.argv.slice(2),env=process.env){
  let args;
  try{args=parseArgs(argv);}
  catch(_){process.stderr.write('CONFIG_PREFLIGHT_ERROR INVALID_ARGUMENT_OR_TARGET\n');return 2;}
  if(args.help){
    process.stdout.write('Usage: node scripts/check-runtime-config.js --target production|staging [--json]\n');
    return 0;
  }
  const result=checkRuntime({target:args.target,env});
  if(args.json)process.stdout.write(JSON.stringify(result)+'\n');
  else{
    for(const c of result.checks)process.stdout.write((c.ok?'PASS ':'BLOCK ')+c.code+'\n');
    for(const label of result.manual)process.stdout.write('MANUAL '+label+'\n');
    process.stdout.write('RESULT '+result.status+'\n');
  }
  return result.failed.length?1:0;
}
if(require.main===module)process.exitCode=main();
module.exports={privateSecret,hasValue,emailLike,certificateFile,privatePostgresUrl,checkRuntime,parseArgs,main};
