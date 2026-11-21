'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateTarget,parseArgs,assessPlan}=require('./scripts/reviewer-onboarding-preflight');
const project='tnitksrlntrdxbvznxzf';
const uuid='d2ef39d1-c9f4-4dc0-9a06-bad3d6dcf1c4';
const now=Date.parse('2026-11-21T10:00:00Z');
const expires=new Date(now+2*60*60*1000).toISOString().replace('.000','');
function args(action='grant',role='case_reviewer',date=expires){
 const result=['--action',action,'--role',role,'--user-id',uuid,'--approval','CP-OPS-TEST-001'];
 if(action==='grant')result.push('--expires-at',date);
 return result;
}
function fixture(options={}){
 const queries=[];
 const settings={verified:true,app_read:true,operator_insert:true,operator_update:true,
   rls:true,app_insert:false,app_update:false,app_delete:false,
   session_role:'postgres',db_name:'campuspool_stage1_ci',grants:[],...options};
 const client={query:async(sql,params)=>{
   queries.push({sql,params});
   if(sql==='BEGIN TRANSACTION READ ONLY'||sql==='ROLLBACK')return {rows:[]};
   if(sql.includes('current_database()'))return {rows:[{
     session_role:settings.session_role,db_name:settings.db_name
   }]};
   if(sql.includes('FROM pg_class t'))return {rows:[{
     rls:settings.rls,app_select:settings.app_read,
     app_insert:settings.app_insert,app_update:settings.app_update,
     app_delete:settings.app_delete,operator_insert:settings.operator_insert,
     operator_update:settings.operator_update
   }]};
   if(sql.includes('SELECT is_verified'))return {rows:settings.verified?[{is_verified:true}]:[]};
   if(sql.includes('FROM public.campus_case_reviewer_grants WHERE'))return {rows:settings.grants};
   throw Error('Unexpected query in test: '+sql.slice(0,100));
 }};
 return {client,queries};
}
test('only exact local CI and dedicated staging can be read; production and TLS off denied',()=>{
 assert.equal(validateTarget(
   'postgresql://postgres:dummy@127.0.0.1:5432/campuspool_stage1_ci').kind,'disposable');
 assert.equal(validateTarget(
   'postgresql://postgres:dummy@db.'+project+'.supabase.co/postgres').kind,'staging');
 assert.equal(validateTarget(
   'postgresql://postgres.'+project+':dummy@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres').kind,'staging');
 for(const bad of [
   '', 'http://example.com', 'postgresql://postgres:dummy@127.0.0.1:5432/postgres',
   'postgresql://postgres:dummy@127.0.0.1:5433/campuspool_stage1_ci',
   'postgresql://postgres:dummy@10.1.1.2:5432/campuspool_stage1_ci',
   'postgresql://postgres:dummy@db.wrongproject.supabase.co/postgres',
   'postgresql://postgres:dummy@db.'+project+'.supabase.co/postgres?sslmode=disable',
   'postgresql://postgres:dummy@db.'+project+'.supabase.co/postgres?connect_timeout=1',
   'postgresql://postgres:dummy@db.'+project+'.supabase.co/postgres#secret',
   'postgresql://campuspool_staging_app@db.'+project+'.supabase.co/postgres'
 ])assert.throws(()=>validateTarget(bad),'must reject unapproved target');
});
test('requires explicit bounded role, UUID, approval, action and UTC expiry; never accepts apply',()=>{
 assert.equal(parseArgs(args(),now).role,'case_reviewer');
 assert.equal(parseArgs(args('revoke'),now).expiresAt,null);
 for(const bad of [
   ['--apply','YES',...args()],['--action','renew',...args().slice(2)],
   args('grant','admin'),args('grant','case_reviewer','2026-11-21'),
   args('grant','case_reviewer',new Date(now+8*24*3600000).toISOString().replace('.000','')),
   args('grant','case_reviewer',new Date(now+1000).toISOString().replace('.000','')),
   [...args('revoke'),'--expires-at',expires],
   [...args(),'--role','case_reviewer'],
   args().filter((_,i)=>i!==5&&i!==4),
   args().map(x=>x===uuid?'not-uuid':x),
   args().map(x=>x==='CP-OPS-TEST-001'?'other':x)
 ])assert.throws(()=>parseArgs(bad,now));
});
test('new verified reviewer: dry-run succeeds, never writes, never logs UUID',async()=>{
 const {client,queries}=fixture();
 const input=parseArgs(args(),now);
 const result=await assessPlan(client,{kind:'disposable',database:'campuspool_stage1_ci'},input,new Date(now));
 assert.equal(result.eligible,true);
 assert.equal(result.canApply,false);
 assert.equal(result.readOnly,true);
 assert.equal(result.approved,false);
 assert.equal(result.verifiedCandidate,true);
 assert.equal(result.activeRoleCount,0);
 assert.equal(JSON.stringify(result).includes(uuid),false);
 assert.equal(JSON.stringify(result).includes(input.approval),false);
 assert.equal(queries[0].sql,'BEGIN TRANSACTION READ ONLY');
 assert.equal(queries[queries.length-1].sql,'ROLLBACK');
 assert.ok(queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE|GRANT|REVOKE|COMMIT|CREATE|ALTER|DROP)\b/i.test(q.sql)));
});
test('revocation plan requires an existing active matching grant; cannot revoke through app',async()=>{
 const record={reviewer_role:'appeal_reviewer',expires_at:new Date(now+5*3600000),revoked_at:null};
 const fixture1=fixture({grants:[record]});
 const p=parseArgs(args('revoke','appeal_reviewer'),now);
 const ok=await assessPlan(fixture1.client,{kind:'disposable',database:'campuspool_stage1_ci'},p,new Date(now));
 assert.equal(ok.eligible,true);
 assert.equal(ok.canApply,false);
 const old=fixture({grants:[{...record,revoked_at:new Date(now-1000)}]});
 const refused=await assessPlan(old.client,{kind:'disposable',database:'campuspool_stage1_ci'},p,new Date(now));
 assert.equal(refused.eligible,false);
 assert.equal(refused.reason,'ACTIVE_GRANT_NOT_FOUND');
});
test('no re-grant after expiration/revocation, no dual-role promotion and unverified user denied',async()=>{
 const before=new Date(now-60*60*1000);
 for(const opts of [
   {grants:[{reviewer_role:'case_reviewer',expires_at:before,revoked_at:null}]},
   {grants:[{reviewer_role:'case_reviewer',expires_at:new Date(now+100000),revoked_at:before}]}
 ]){
   const plan=await assessPlan(fixture(opts).client,{kind:'disposable',database:'campuspool_stage1_ci'},parseArgs(args(),now),new Date(now));
   assert.equal(plan.reason,'EXISTING_GRANT_NEEDS_SEPARATE_RENEWAL_POLICY');
   assert.equal(plan.eligible,false);
 }
 const dual=await assessPlan(fixture({grants:[
   {reviewer_role:'appeal_reviewer',expires_at:new Date(now+3600000),revoked_at:null}
 ]}).client,{kind:'disposable',database:'campuspool_stage1_ci'},parseArgs(args(),now),new Date(now));
 assert.equal(dual.eligible,false);
 assert.equal(dual.reason,'ROLE_SEPARATION_REVIEW_REQUIRED');
 const unverified=await assessPlan(fixture({verified:false}).client,{kind:'disposable',database:'campuspool_stage1_ci'},parseArgs(args(),now),new Date(now));
 assert.equal(unverified.eligible,false);
 assert.equal(unverified.reason,'USER_NOT_VERIFIED');
});
test('unsafe DB session/permissions fail closed and always rollback',async()=>{
 for(const opts of [
   {session_role:'campuspool_staging_app'},
   {db_name:'production'},
   {rls:false},{app_read:false},{app_insert:true},{app_update:true},{app_delete:true},
   {operator_insert:false}
 ]){
   const q=fixture(opts);
   await assert.rejects(assessPlan(q.client,{kind:'disposable',database:'campuspool_stage1_ci'},parseArgs(args(),now),new Date(now)));
   assert.equal(q.queries[0].sql,'BEGIN TRANSACTION READ ONLY');
   assert.equal(q.queries.at(-1).sql,'ROLLBACK');
 }
});
test('runbook is explicit draft, no self-service grants, penalties or imaginary support SLA',()=>{
 const policy=fs.readFileSync(path.join(__dirname,'docs/agents/tasks/2026-11-21-reviewer-operations-policy-proposal.md'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
 const code=fs.readFileSync(path.join(__dirname,'scripts/reviewer-onboarding-preflight.js'),'utf8');
 assert.match(policy,/UNAPPROVED POLICY DRAFT/);
 assert.match(policy,/NO LIVE REVIEWERS/);
 assert.match(policy,/both.*participants|two different booking participants/i);
 assert.match(policy,/no guaranteed response time/i);
 assert.match(policy,/seven|7 days/i);
 assert.match(policy,/active-undisputed legacy.*Pending/i);
 assert.match(policy,/No ad hoc manual database edits/i);
 assert.match(code,/BEGIN TRANSACTION READ ONLY/);
 assert.doesNotMatch(server,/\/api\/reviewer\/(?:grant|assign|promote|onboard|revoke)/);
 assert.doesNotMatch(code,/client\.query\(\s*['"]\s*(?:INSERT|UPDATE|DELETE|GRANT|REVOKE)/i);
});
