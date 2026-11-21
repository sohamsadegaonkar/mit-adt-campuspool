'use strict';
// Operator planning only. NEVER writes DB, cannot grant/revoke reviewer roles.
// Staging queries require separate owner approval. Actual changes are manual,
// approved DBA work outside this repository and outside this command.
const {Client}=require('pg');
const {validateTarget:validateStagingTarget}=require('./staging-migration-preflight');

const ROLE_SET=new Set(['case_reviewer','appeal_reviewer']);
const ACTION_SET=new Set(['grant','revoke']);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const UTC_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const STAGING_PROJECT='tnitksrlntrdxbvznxzf';
const APP_ROLE='campuspool_staging_app';
const MAX_GRANT_MS=7*24*60*60*1000;
const MIN_GRANT_MS=60*60*1000;

function validateTarget(connectionString) {
  if(typeof connectionString!=='string'||!connectionString)
    throw Error('Reviewer preflight database target is missing');
  let parsed;
  try{parsed=new URL(connectionString);}catch{throw Error('Invalid database URL');}
  if(!['postgres:','postgresql:'].includes(parsed.protocol)
    ||!parsed.username||!parsed.password||parsed.hash
    ||parsed.searchParams.get('sslmode')==='disable')
    throw Error('Unapproved or insecure database URL');
  if(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)){
    if(parsed.pathname!=='/campuspool_stage1_ci'||parsed.search||parsed.port!=='5432')
      throw Error('Refusing non-disposable local database');
    return {kind:'disposable',database:'campuspool_stage1_ci',ssl:false};
  }
  validateStagingTarget(connectionString);
  if(!parsed.hostname.includes(STAGING_PROJECT) &&
      !decodeURIComponent(parsed.username).endsWith('.'+STAGING_PROJECT))
    throw Error('Refusing wrong staging project');
  if(parsed.search||parsed.hash)
    throw Error('Unapproved staging query parameters');
  return {kind:'staging',database:'postgres',ssl:true};
}

function parseArgs(argv,now=Date.now()){
  if(!Array.isArray(argv)||argv.length===0)throw Error('Missing explicit dry-run planning inputs');
  const allowed=new Set(['--action','--role','--user-id','--expires-at','--approval']);
  const input=Object.create(null);
  if(argv.length%2!==0)throw Error('Unknown or incomplete CLI argument');
  for(let i=0;i<argv.length;i+=2){
    if(!allowed.has(argv[i])||Object.hasOwn(input,argv[i]))throw Error('Unknown, unsafe or repeated CLI argument');
    input[argv[i]]=argv[i+1];
    if(typeof input[argv[i]]!=='string'||!input[argv[i]]||input[argv[i]].startsWith('--'))
      throw Error('Missing CLI argument value');
  }
  const action=input['--action'],role=input['--role'],userId=input['--user-id'];
  if(!ACTION_SET.has(action)||!ROLE_SET.has(role)||!UUID.test(userId||''))
    throw Error('Invalid reviewer action, role or UUID');
  const approval=input['--approval'];
  if(typeof approval!=='string'||!/^CP-[A-Z0-9-]{6,48}$/.test(approval))
    throw Error('A private approved change reference is required');
  const expiration=input['--expires-at'];
  if(action==='grant'){
    if(!UTC_TIME.test(expiration||''))throw Error('Grant requires an explicit UTC expiration');
    const millis=Date.parse(expiration);
    if(!Number.isFinite(millis)||new Date(millis).toISOString().replace('.000','')!==expiration)
      throw Error('Invalid absolute UTC expiration');
    if(millis-now<MIN_GRANT_MS||millis-now>MAX_GRANT_MS)
      throw Error('Proposed grant duration must be between 1 hour and 7 days');
  }else if(expiration!==undefined){
    throw Error('Revocation must not carry a new expiration');
  }
  return Object.freeze({action,role,userId:userId.toLowerCase(),
    expiresAt:expiration||null,approval});
}

// Review is an explicit single read-only DB transaction. Even a privileged
// connection cannot commit a grant/role/payment write via this codepath.
async function assessPlan(client,target,request,now=new Date()){
  if(!client||typeof client.query!=='function')throw Error('Database client is required');
  if(!target||!['disposable','staging'].includes(target.kind))
    throw Error('Unsafe database target');
  if(!request||!ACTION_SET.has(request.action)||!ROLE_SET.has(request.role)
    ||!UUID.test(request.userId||''))
    throw Error('Incomplete plan request');
  let began=false;
  try{
    await client.query('BEGIN TRANSACTION READ ONLY');
    began=true;
    const state=await client.query(
      'SELECT current_database() AS db_name, current_user AS session_role');
    const db=state.rows[0]||{};
    if(db.db_name!==target.database||db.session_role===APP_ROLE)
      throw Error('Refusing unexpected DB or application identity');
    const inventory=await client.query([
      "SELECT t.relrowsecurity AS rls,",
      "has_table_privilege($1,'public.campus_case_reviewer_grants','SELECT') AS app_select,",
      "has_table_privilege($1,'public.campus_case_reviewer_grants','INSERT') AS app_insert,",
      "has_table_privilege($1,'public.campus_case_reviewer_grants','UPDATE') AS app_update,",
      "has_table_privilege($1,'public.campus_case_reviewer_grants','DELETE') AS app_delete,",
      "has_table_privilege(current_user,'public.campus_case_reviewer_grants','INSERT') AS operator_insert,",
      "has_table_privilege(current_user,'public.campus_case_reviewer_grants','UPDATE') AS operator_update",
      "FROM pg_class t WHERE t.oid=to_regclass('public.campus_case_reviewer_grants')"
    ].join(' '),[APP_ROLE]);
    const grants=inventory.rows[0];
    if(!grants||!grants.rls||!grants.app_select||
      grants.app_insert||grants.app_update||grants.app_delete)
      throw Error('Reviewer grant table is absent or violates least privilege');
    if(request.action==='grant'&&!grants.operator_insert ||
      request.action==='revoke'&&!grants.operator_update)
      throw Error('Operator identity lacks approved reviewer grant authority');
    const user=await client.query(
      'SELECT is_verified FROM public.campus_users WHERE id=$1::uuid',[request.userId]);
    const rows=await client.query([
      'SELECT reviewer_role,expires_at,revoked_at',
      'FROM public.campus_case_reviewer_grants WHERE user_id=$1::uuid'
    ].join(' '),[request.userId]);
    const verified=user.rows.length===1 && user.rows[0].is_verified===true;
    const active=rows.rows.filter(x=>!x.revoked_at&&Date.parse(x.expires_at)>now.getTime());
    const exact=rows.rows.find(x=>x.reviewer_role===request.role);
    let eligible=false,reason='NONE';
    if(!verified)reason='USER_NOT_VERIFIED';
    else if(rows.rows.some(x=>x.reviewer_role!==request.role))
      reason='ROLE_SEPARATION_REVIEW_REQUIRED';
    else if(request.action==='grant'){
      if(exact)reason='EXISTING_GRANT_NEEDS_SEPARATE_RENEWAL_POLICY';
      else eligible=true;
    }else if(!exact||!active.some(x=>x.reviewer_role===request.role))
      reason='ACTIVE_GRANT_NOT_FOUND';
    else eligible=true;
    return Object.freeze({
      target:target.kind,action:request.action,role:request.role,
      readOnly:true,approved:false,canApply:false,
      verifiedCandidate:verified,existingGrant:!!exact,
      activeRoleCount:active.length,
      reviewerGrantLeastPrivilege:true,eligible,reason
      // Never return/log user UUID, approval ref, email, phone, DB URL or role credentials.
    });
  }finally{
    if(began)await client.query('ROLLBACK');
  }
}

async function main(argv=process.argv.slice(2),env=process.env){
  const request=parseArgs(argv);
  const value=env.REVIEWER_OPERATOR_DB_URL;
  const target=validateTarget(value);
  const db=new Client({connectionString:value,ssl:target.ssl?{rejectUnauthorized:true}:false,
    application_name:'campuspool-reviewer-preflight-readonly',
    connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:5000});
  try{
    await db.connect();
    const result=await assessPlan(db,target,request);
    console.log('[REVIEWER PREFLIGHT] '+JSON.stringify(result));
    console.log('NO_DB_WRITES=YES NO_REVIEWER_GRANTED=YES NO_PENALTIES_OR_PAYMENTS=YES');
    if(!result.eligible)process.exitCode=1;
    return result;
  }finally{await db.end();}
}
if(require.main===module)main().catch(()=>{
  // No DB names, connection strings, user identifiers, approval refs or passwords.
  console.error('[REVIEWER PREFLIGHT] BLOCKED: plan/target/access requirements not met. No changes made.');
  process.exitCode=1;
});
module.exports={validateTarget,parseArgs,assessPlan,main};
