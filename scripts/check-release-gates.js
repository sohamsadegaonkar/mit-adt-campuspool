'use strict';

// Read-only release gate. It NEVER prints or sends credentials.
// Use --ci for static regression validation; --production for a local,
// explicitly supervised review of actual service configuration.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');

function inspect({mode='ci',env=process.env,root=path.resolve(__dirname,'..')}={}){
  const failed=[],passed=[],manual=[];
  const check=(ok,label)=>{(ok?passed:failed).push(label);};
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const pkg=JSON.parse(read('package.json'));
  const render=read('render.yaml');
  const staging=read('render-staging.yaml');
  const server=read('server.js');
  const sqlite=read('database.js');
  const auth=read('stage1-otp/auth-routes.js');
  const paymentFailClosed=(server.match(/return sendJson\(501, \{ success: false, error: 'PAYMENT_VERIFICATION_REQUIRED'/g)||[]).length>=2;
  check(pkg.engines?.node==='>=22.14.0','Node runtime excludes affected early Node 22 patch releases');
  check(/- key: NODE_VERSION\s*\n\s*value: ['"]?22\.23\.2/.test(render),
    'Production Blueprint pins tested Node 22.23.2 runtime');
  check(/NODE_EXTRA_CA_CERTS/.test(staging) && /OTP_DB_SSL\s*\n\s*value: ['"]true['"]/.test(staging),
    'Staging requires verified Supabase TLS');
  check(/const STAGING_ONLY = process\.env\.APP_ENV === 'staging'/.test(server) && /validStagingBasicAuth/.test(server),
    'Staging requires an authentication gate');
  check(auth.includes('throttleLoginLookup') && auth.includes('INVALID_OR_EXPIRED_OTP'),
    'Public login does not reveal registered accounts or unissued challenges');
  check(server.includes('status:') || server.includes('health'),
    'Server includes health monitoring');
  check(paymentFailClosed,'Unverified payment status cannot be marked paid from client requests');
  let tracked=[];
  try{tracked=cp.execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split(/\r?\n/)}catch(_){}
  check(!tracked.some(f=>/(^|\/)\.env\.production$/.test(f)), 'No production .env credentials in current Git tree');

  if(mode==='production'){
    check(env.NODE_ENV==='production'&&env.APP_ENV==='production',
      'Production mode is explicitly selected');
    check(env.AUTH_OTP_BACKEND==='postgres','PostgreSQL-backed OTP and identity mode enabled');
    check(env.OTP_DB_SSL==='true','Database TLS enabled');
    check(typeof env.OTP_HMAC_KEY==='string'&&env.OTP_HMAC_KEY.length>=32,
      'Private OTP HMAC key present');
    check(typeof env.OTP_SECRET==='string'&&env.OTP_SECRET.length>=32,
      'Private session/CSRF key present');
    check(!!env.NODE_EXTRA_CA_CERTS&&fs.existsSync(env.NODE_EXTRA_CA_CERTS),
      'Trusted PostgreSQL CA secret file exists');
    let urlIsSafe=false;
    try{
      const u=new URL(env.OTP_DATABASE_URL||'');
      urlIsSafe=u.protocol==='postgresql:' &&
        /\.pooler\.supabase\.com$/i.test(u.hostname) &&
        u.username.length>0 && u.password.length>0 &&
        u.port==='5432';
    }catch(_){}
    check(urlIsSafe,'Private verified PostgreSQL session pooler configured');
    check(env.EMAIL_PROVIDER==='resend'&&!!env.RESEND_API_KEY&&!!env.EMAIL_FROM,
      'Verified transactional email settings present');
    check(env.SMS_PROVIDER==='msg91'&&!!env.MSG91_AUTHKEY&&!!env.MSG91_FLOW_TEMPLATE_ID,
      'Approved transactional SMS configuration present');
    // A real production launch cannot rely on an ephemeral SQLite file.
    check(!/require\(['"]better-sqlite3['"]\)/.test(sqlite),
      'Rides and bookings use durable shared PostgreSQL (not local SQLite)');
    manual.push('Google App Password revoked and historical secret exposure investigated');
    manual.push('Resend domain verified and real inbox receipt tested');
    manual.push('MSG91 DLT sender/template approved and real handset receipt tested');
    manual.push('Backup restore drill and rollout rollback rehearsed');
    manual.push('Security PRs reviewed/merged and production deployment explicitly approved');
    manual.push('End-to-end browser QA on the target release commit completed');
  }else if(mode!=='ci'){
    throw Error('Choose --ci or --production');
  }
  return {mode,passed,failed,manual,ready:failed.length===0&&manual.length===0};
}
if(require.main===module){
  const mode=process.argv.includes('--production')?'production':'ci';
  const result=inspect({mode});
  for(const label of result.passed)console.log('PASS '+label);
  for(const label of result.failed)console.log('BLOCK '+label);
  for(const label of result.manual)console.log('MANUAL '+label);
  console.log('Release assessment: '+(result.ready?'PASS':'BLOCKED'));
  if(!result.ready)process.exitCode=1;
}
module.exports={inspect};
