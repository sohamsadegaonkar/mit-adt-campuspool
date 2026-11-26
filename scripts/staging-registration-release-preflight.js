'use strict';
// Read-only, catalog/ledger gate. No credentials printed, no row data read.
// This is intentionally NOT a migration executor, backup proof or rollout authorization.
const {Client}=require('pg');
const {parseBackupTarget,parsePinnedCa}=require('./staging-008-backup-guard');
const APP='campuspool_staging_app';
const full=['otp_challenges','otp_rate_buckets','campus_users','campus_sessions','campus_identity_audit','campus_rides','campus_bookings','campus_ride_geo','campus_trip_intents','campus_idempotency_keys'];
const append=['campus_booking_cases','campus_booking_case_events','campus_booking_case_responses','campus_case_review_decisions','campus_case_appeals','campus_case_appeal_reviews'];
const reviewer='campus_case_reviewer_grants',pending='campus_pending_registrations';
const expected=[...full,...append,reviewer].sort();
const indexes=['campus_pending_registration_expiry_idx','campus_pending_registration_recovery_email_idx','campus_pending_registration_recovery_phone_idx'];
const purpose=['login','signup_email','signup_phone','signup_draft_email','signup_draft_phone','signup_recovery_email','signup_recovery_phone'].sort();
function assess(s,phase){
  if(!['before','frozen','after'].includes(phase))throw Error('INVALID_PHASE');
  const errors=[];
  const need=(ok,reason)=>{if(!ok)errors.push(reason);};
  const versions=Array.from({length:phase==='after'?15:14},(_,i)=>String(i+1).padStart(3,'0'));
  need(JSON.stringify(s.versions)===JSON.stringify(versions),'MIGRATION_LEDGER_MUST_BE_EXACT_AND_ORDERED');
  const names=phase==='after'?[...expected,pending].sort():expected;
  need(JSON.stringify(s.tables.map(t=>t.name).sort())===JSON.stringify(names),'APPLICATION_TABLE_SET_DRIFT');
  need(s.roles.length===3&&s.roles.some(r=>r.name==='anon')&&s.roles.some(r=>r.name==='authenticated'),'ROLE_INVENTORY_INCOMPLETE');
  const app=s.roles.find(r=>r.name===APP);
  need(app&&!app.super&&!app.bypass&&!app.createdb&&!app.createrole&&!app.replication,'APP_ROLE_UNSAFE');
  need(app&&app.login===(phase!=='frozen'),'APP_ROLE_LOGIN_STATE_WRONG');
  if(phase==='frozen'){
    need(s.connections===0,'APP_CONNECTIONS_NOT_DRAINED');
    need(s.writableSequences===0,'APP_WRITABLE_SEQUENCES_REMAIN');
  }
  for(const t of s.tables){
    need(t.rls&&!t.exposed&&!t.publicPolicy,'TABLE_ISOLATION_'+t.name);
    need(t.select,'APP_READ_MISSING_'+t.name);
    const canWrite=phase!=='frozen'&&t.name!==reviewer;
    need(t.insert===canWrite,'APP_INSERT_MISMATCH_'+t.name);
    const mutable=canWrite&&!append.includes(t.name);
    need(t.update===mutable&&t.delete===mutable,'APP_MUTATION_MISMATCH_'+t.name);
    need(!t.extra,'APP_EXTRA_PRIVILEGE_'+t.name);
    const policies=s.policies.filter(p=>p.tablename===t.name);
    const readOnly=t.name===reviewer,appendOnly=append.includes(t.name);
    const commands=readOnly?['SELECT']:appendOnly?['INSERT','SELECT']:['ALL'];
    need(policies.length===commands.length&&JSON.stringify(policies.map(p=>p.cmd).sort())===JSON.stringify(commands)&&policies.every(p=>p.roles.length===1&&p.roles[0]===APP&&(p.cmd==='INSERT'||p.qual==='true')&&(!['ALL','INSERT'].includes(p.cmd)||p.with_check==='true')),'APP_POLICY_DRIFT_'+t.name);
  }
  const requiredColumns=['campus_rides.payment_mode','campus_bookings.payment_mode','campus_rides.journey_stage','campus_rides.departed_at','campus_rides.pickup_at','campus_rides.arrived_at','campus_bookings.boarded_at','campus_bookings.boarding_pin_nonce','campus_bookings.boarding_pin_expires_at','campus_bookings.boarding_pin_attempts'];
  need(requiredColumns.every(x=>s.columns.includes(x)),'009_014_COLUMN_DRIFT');
  const requiredConstraints=['campus_idempotency_response_pair','campus_ride_payment_mode_check','campus_booking_payment_mode_check','campus_booking_ride_payment_mode_fk','campus_ride_journey_stage_check','campus_booking_boarding_pin_check'];
  const requiredIndexes=['campus_idempotency_expiry_idx','campus_rides_payment_mode_uidx','campus_booking_case_events_case_idx','campus_booking_cases_opened_idx','campus_case_responses_created_idx','campus_case_reviewer_grants_active_idx','campus_case_appeals_case_idx'];
  need(requiredConstraints.every(x=>s.constraints.includes(x))&&requiredIndexes.every(x=>s.indexes.includes(x)),'008_014_CONSTRAINT_OR_INDEX_DRIFT');
  need(s.invalidConstraints===0,'UNVALIDATED_APPLICATION_CONSTRAINT');
  need(s.purposeValidated,'OTP_PURPOSE_CONSTRAINT_MISSING_OR_INVALID');
  need(JSON.stringify(s.purposes)===JSON.stringify(phase==='after'?purpose:purpose.filter(x=>!x.startsWith('signup_draft_')&&!x.startsWith('signup_recovery_'))),'OTP_PURPOSE_DRIFT');
  if(phase==='after'){
    need(indexes.every(x=>s.indexes.includes(x)),'REGISTRATION_INDEX_DRIFT');
    need(['id','resume_hash','email','phone','email_challenge_id','phone_challenge_id','email_verified_at','phone_verified_at','created_at','expires_at','consumed_at'].every(x=>s.columns.includes(pending+'.'+x)),'REGISTRATION_COLUMN_DRIFT');
  }
  return {phase,catalogAndLedgerMatch:errors.length===0,errors,
    applicationFreezeVerified:phase==='frozen'&&errors.length===0,
    globalWriteFreezeVerified:false,backupVerified:false,releaseReady:false};
}
async function read(client){
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL statement_timeout=5000');
    const q=async(sql,args)=>(await client.query(sql,args)).rows;
    const roles=await q("SELECT rolname AS name,rolcanlogin AS login,rolsuper AS super,rolbypassrls AS bypass,rolcreatedb AS createdb,rolcreaterole AS createrole,rolreplication AS replication FROM pg_roles WHERE rolname IN ('campuspool_staging_app','anon','authenticated')");
    const tables=await q("SELECT c.relname AS name,c.relrowsecurity AS rls,has_table_privilege($1,c.oid,'SELECT') AS select,has_table_privilege($1,c.oid,'INSERT') AS insert,has_table_privilege($1,c.oid,'UPDATE') AS update,has_table_privilege($1,c.oid,'DELETE') AS delete,has_table_privilege($1,c.oid,'TRUNCATE,REFERENCES,TRIGGER') AS extra,(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)) AS exposed,EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND p.roles && ARRAY['public','anon','authenticated']::name[]) AS \"publicPolicy\" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (c.relname LIKE 'campus\\_%' OR c.relname LIKE 'otp\\_%')",[APP]);
    const versions=(await q('SELECT version::text AS v FROM supabase_migrations.schema_migrations ORDER BY version')).map(x=>x.v);
    const columns=(await q("SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema='public'")).map(x=>x.c);
    const indexes=(await q("SELECT indexname AS i FROM pg_indexes WHERE schemaname='public'")).map(x=>x.i);
    const constraints=(await q("SELECT conname AS c FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND p.convalidated")).map(x=>x.c);
    const policies=await q("SELECT tablename,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'");
    // node-postgres may expose name[] as text; accept only the exact single role syntax.
    for(const p of policies)if(typeof p.roles==='string')p.roles=p.roles.replace(/^\{|\}$/g,'').split(',');
    const purposeRows=await q("SELECT pg_get_constraintdef(oid) AS definition,convalidated FROM pg_constraint WHERE conrelid='public.otp_challenges'::regclass AND conname='otp_challenges_purpose_check' AND contype='c'");
    const invalidConstraints=(await q("SELECT count(*)::int AS n FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'campus\\_%' OR c.relname LIKE 'otp\\_%') AND NOT p.convalidated"))[0].n;
    const connections=(await q("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1",[APP]))[0].n;
    const writableSequences=(await q("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND has_sequence_privilege($1,c.oid,'USAGE,UPDATE')",[APP]))[0].n;
    const purposes=[...(purposeRows[0]?.definition||'').matchAll(/'([^']+)'/g)].map(x=>x[1]).sort();
    return {roles,tables,versions,columns,indexes,constraints,policies,purposes,purposeValidated:purposeRows.length===1&&purposeRows[0].convalidated,invalidConstraints,connections,writableSequences};
  }finally{await client.query('ROLLBACK');}
}
async function main(env=process.env,phase=process.argv[2]){
  if(env.APP_ENV!=='staging'||env.OTP_DB_SSL!=='true'||env.STAGING_REGISTRATION_PREFLIGHT_ACK!=='READ_ONLY_STAGING_REGISTRATION_CATALOG'||!['before','frozen','after'].includes(phase))throw Error('PRECONDITIONS_MISSING');
  // Ledger reads need separate privileged-use approval; same pinned staging CA
  // and exact target restrictions as the prior reviewed export guard.
  const allowAdmin=env.STAGING_REGISTRATION_ADMIN_ACK==='OWNER_APPROVED_STAGING_REGISTRATION_READ_ONLY';
  const target=parseBackupTarget(env.STAGING_BACKUP_DATABASE_URL,{allowAdmin});
  const client=new Client({host:target.hostname,port:target.port,user:target.user,password:target.password,database:target.database,
    ssl:{ca:parsePinnedCa(env.STAGING_BACKUP_CA_PEM_B64),rejectUnauthorized:true},connectionTimeoutMillis:5000,query_timeout:10000,application_name:'campuspool_registration_readonly'});
  try{
    await client.connect();
    return assess(await read(client),phase);
  }finally{await client.end().catch(()=>{});}
}
if(require.main===module)main().then(r=>{console.log(JSON.stringify(r));if(!r.catalogAndLedgerMatch)process.exitCode=1;}).catch(()=>{console.error('STAGING_REGISTRATION_PREFLIGHT_BLOCKED');process.exitCode=1;});
module.exports={assess,read,main};
