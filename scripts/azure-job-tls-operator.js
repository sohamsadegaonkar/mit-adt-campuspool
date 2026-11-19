'use strict';
// D07 only. No database export path. Run exclusively as the authorized Azure operator.
// The state machine owns the one-start / rollback sequence. Unknown outcomes never retry.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {compare,historyGuard,selfTest}=require('./azure-job-readback-guard');
const {makeOperator,operatorTests}=require('./azure-job-tls-operator-state');
const op=makeOperator(compare,historyGuard);
const RG='campuspool-backup-rg', JOB='campuspool-staging-backup-job', API='2026-01-01';
const SUB=process.env.CAMPUSPOOL_APPROVED_AZURE_SUBSCRIPTION||'';
const ROOT='/subscriptions/'+SUB+'/resourceGroups/'+RG;
const ID=ROOT+'/providers/Microsoft.App/jobs/'+JOB;
const URL='https://management.azure.com'+ID+'?api-version='+API;
const QUERY='{identity:identity,configuration:properties.configuration,environmentId:properties.environmentId,workloadProfileName:properties.workloadProfileName,provisioningState:properties.provisioningState,template:properties.template}';
const lower=x=>String(x).toLowerCase();
const need=(v,code)=>{if(!v)throw Error(code)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const BASE_HASH='153eb21eb03d2f1e97797f595beffa74eae108c566c567056e91307a02dc9027';
function safeAzureFailure(args,e){
  const verb=args.slice(0,3).join(' ');
  const method=args[args.indexOf('--method')+1];
  const url=args[args.indexOf('--url')+1]||'';
  let step='OTHER';
  if(verb.startsWith('account show'))step='ACCOUNT';
  else if(verb.startsWith('identity show'))step=args.includes('campuspool-ghcr-vault-reader')?'PULL_IDENTITY':'DATA_IDENTITY';
  else if(verb.startsWith('keyvault show'))step='VAULT_CONFIGURATION';
  else if(verb==='role assignment list')step='SECRET_ROLE_ASSIGNMENTS';
  else if(verb==='containerapp job execution')step='EXECUTION_HISTORY';
  else if(verb==='containerapp job start')step='JOB_START';
  else if(args[0]==='rest')step=method==='patch'?'JOB_PATCH':url.includes('/secrets/')?'SECRET_METADATA':'JOB_READBACK';
  const msg=String(e?.stderr||'');
  const why=e?.code==='ETIMEDOUT'?'TIMEOUT':e?.code==='ENOENT'?'CLI_NOT_FOUND':e?.code==='ENOBUFS'?'OUTPUT_LIMIT':e instanceof SyntaxError?'INVALID_JSON':/AADSTS|az login|login again|expired|AuthenticationFailed|InvalidAuthenticationToken/i.test(msg)?'AUTHENTICATION':/AuthorizationFailed|Forbidden|AccessDenied|insufficient privileges|permission denied|status code[: ]+403/i.test(msg)?'AUTHORIZATION':/ResourceNotFound|NotFound|status code[: ]+404/i.test(msg)?'NOT_FOUND':/TooManyRequests|throttl|status code[: ]+429/i.test(msg)?'THROTTLED':/ServiceUnavailable|InternalServerError|BadGateway|GatewayTimeout|status code[: ]+50[0234]/i.test(msg)?'SERVICE_ERROR':/connection|network|DNS|SSL|TLS|certificate/i.test(msg)?'NETWORK_OR_TLS':/unrecognized arguments|invalid choice|InvalidApiVersionParameter/i.test(msg)?'CLI_OR_API_ARGUMENT':'UNKNOWN';
  return 'AZURE_'+step+'_'+why;
}
function az(args,json=true){
  try{const v=execFileSync('az',[...args,'--subscription',SUB,'--only-show-errors','-o',json?'json':'none'],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});return json?JSON.parse(v):undefined}
  catch(e){throw Error(safeAzureFailure(args,e))}
}
function same(a,b){return lower(a)===lower(b)}
function scopeGuard(s,ids){
  const c=s.template.containers[0], cfg=s.configuration;
  const id1=ROOT+'/providers/Microsoft.ManagedIdentity/userAssignedIdentities/campuspool-ghcr-vault-reader';
  const id2=ROOT+'/providers/Microsoft.ManagedIdentity/userAssignedIdentities/campuspool-staging-backup-data-id';
  const entries=Object.keys(s.identity.userAssignedIdentities||{});
  need(entries.length===2&&entries.some(x=>same(x,id1))&&entries.some(x=>same(x,id2)),'IDENTITY_SCOPE_BLOCK');
  need(cfg.identitySettings.length===2&&cfg.identitySettings.some(x=>same(x.identity,id1)&&x.lifecycle==='None')&&cfg.identitySettings.some(x=>same(x.identity,id2)&&x.lifecycle==='Main'),'IDENTITY_LIFECYCLE_BLOCK');
  need(same(ids.pull.id,id1)&&same(ids.data.id,id2)&&ids.pull.clientId!==ids.data.clientId,'IDENTITY_READBACK_BLOCK');
  need(c.env.some(e=>e.name==='AZURE_CLIENT_ID'&&e.value===ids.data.clientId),'CLIENT_ID_BLOCK');
  need(c.env.some(e=>e.name==='AZURE_KEYVAULT_URL'&&e.value==='https://campuspool-backup-kv-01.vault.azure.net'),'VAULT_HOST_BLOCK');
  need(c.env.some(e=>e.name==='AZURE_PG_SECRET_NAME'&&e.value==='campuspool-staging-pg-password'),'VAULT_SECRET_BLOCK');
  const refs=cfg.secrets||[];
  need(refs.length===2&&refs.some(x=>x.name==='ghcr-pull-token'&&same(x.identity,id1)&&/^https:\/\/campuspool-backup-kv-01\.vault\.azure\.net\/secrets\/ghcr-pull-token(?:\/[a-f0-9]{32})?$/i.test(x.keyVaultUrl||'')&&!x.value)&&refs.some(x=>x.name==='staging-pg-root-ca'&&same(x.identity,id2)&&/^https:\/\/campuspool-backup-kv-01\.vault\.azure\.net\/secrets\/staging-pg-root-ca(?:\/[a-f0-9]{32})?$/i.test(x.keyVaultUrl||'')&&!x.value),'SECRET_REFERENCES_BLOCK');
  need(s.workloadProfileName==='Consumption'&&c.resources.cpu===0.5&&c.resources.memory==='1Gi'&&cfg.replicaTimeout===1800,'RESOURCE_LIMIT_BLOCK');
  need(s.environmentId?.toLowerCase().startsWith((ROOT+'/providers/Microsoft.App/managedEnvironments/').toLowerCase()),'ENVIRONMENT_SCOPE_BLOCK');
}
function checkRbac(ids){
  const vault=ROOT+'/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01';
  const role='Key Vault Secrets User';
  const scope=(n)=>vault+'/secrets/'+n;
  const assignments=(principal,sc)=>az(['role','assignment','list','--scope',sc,'--assignee-object-id',principal,'--include-inherited','--fill-principal-name','false']);
  function exact(principal,sc,expected){
    const a=assignments(principal,sc);
    need(Array.isArray(a)&&a.length===(expected?1:0)&&(!expected||(same(a[0].scope,sc)&&a[0].roleDefinitionName===role&&!a[0].condition)),'EXACT_SECRET_RBAC_BLOCK');
  }
  const v=az(['keyvault','show','-g',RG,'-n','campuspool-backup-kv-01','--query','{id:id,rbac:properties.enableRbacAuthorization}']);
  need(same(v.id,vault)&&v.rbac===true,'VAULT_RBAC_BLOCK');
  for(const n of ['ghcr-pull-token','staging-pg-root-ca','campuspool-staging-pg-password']){
    const sc=scope(n);
    const enabled=az(['rest','--method','get','--url','https://management.azure.com'+sc+'?api-version=2024-11-01','--query','properties.attributes.enabled']);
    need(enabled===true,'SECRET_METADATA_BLOCK');
    exact(ids.pull.principalId,sc,n==='ghcr-pull-token');
    exact(ids.data.principalId,sc,n!=='ghcr-pull-token');
  }
}
function main(){
  const [mode,work]=process.argv.slice(2);
  if(mode==='--self-test'&&!work){console.log('SYNTHETIC_PREDICATES_PASS='+selfTest(compare,historyGuard));console.log('MOCKED_ORCHESTRATION_PASS='+operatorTests(makeOperator));return}
  need(['--plan','--run','--inspect'].includes(mode)&&work&&process.argv.length===4,'INVALID_MODE');
  need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(SUB),'APPROVED_SUBSCRIPTION_REQUIRED');
  const dir=fs.realpathSync(work), st=fs.statSync(dir);
  need(dir.startsWith('/dev/shm/campuspool-tls-plan.')&&(st.mode&0o777)===0o700&&fs.statfsSync(dir).type===0x01021994,'PROTECTED_WORKDIR_REQUIRED');
  process.umask(0o077);
  const read=n=>{const f=path.join(dir,n),s=fs.lstatSync(f);need(s.isFile()&&s.nlink===1&&(s.mode&0o077)===0,'UNSAFE_INPUT_FILE');return fs.readFileSync(f)};
  const base=JSON.parse(read('live-baseline.json'));
  need(hash(read('baseline.json'))===BASE_HASH,'BASELINE_HASH_BLOCK');
  need(JSON.stringify(base.template)===JSON.stringify(JSON.parse(read('baseline.json')))||require('node:util').isDeepStrictEqual(base.template,JSON.parse(read('baseline.json'))),'BASELINE_TEMPLATE_BLOCK');
  const p=op.build(base);
  const account=az(['account','show','--query','{id:id,state:state,name:name}']);
  need(same(account.id,SUB)&&account.state==='Enabled'&&account.name==='Azure for Students','SUBSCRIPTION_BLOCK');
  const ids={pull:az(['identity','show','-g',RG,'-n','campuspool-ghcr-vault-reader']),data:az(['identity','show','-g',RG,'-n','campuspool-staging-backup-data-id'])};
  scopeGuard(base,ids);
  const snapshot=()=>az(['rest','--method','get','--url',URL,'--query',QUERY]);
  const history=()=>az(['containerapp','job','execution','list','-g',RG,'-n',JOB]);
  const journal=path.join(dir,'tls-operator-journal.jsonl');
  function note(event){fs.appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),event})+'\n',{mode:0o600,flag:'a'})}
  if(mode==='--inspect'){
    const live=snapshot(),h=history();
    console.log('BASELINE='+compare(p.base,live,op.ctx).state);
    console.log('TLS_CANDIDATE='+compare(p.tls,live,op.ctx).state);
    console.log('EXECUTION_HISTORY='+JSON.stringify(h.map(x=>({name:x.name,status:x.properties?.status}))));
    console.log('NO_AZURE_WRITES=YES');return;
  }
  need(compare(p.base,snapshot(),op.ctx).state==='VERIFIED'&&historyGuard(history(),op.prior),'INITIAL_LIVE_GUARD_BLOCK');
  checkRbac(ids);
  console.log('EXACT_SCOPE_AND_SECRET_RBAC_PASS=YES');
  console.log('LIVE_BASELINE_AND_HISTORY_PASS=YES');
  if(mode==='--plan'){console.log('NO_AZURE_WRITES=YES');console.log('NO_NEW_JOB_EXECUTION=YES');return}
  // Refuse reruns even if the previous local process stopped before a response.
  need(process.stdin.isTTY&&process.stdout.isTTY,'INTERACTIVE_TERMINAL_REQUIRED');
  need(!fs.existsSync(journal),'PRIOR_ATTEMPT_REQUIRES_INSPECTION');
  const approve=phrase=>{process.stdout.write('Type '+phrase+': ');let x='',b=Buffer.alloc(1);while(x.length<256){const n=fs.readSync(0,b,0,1,null);if(!n||b[0]===10)break;if(b[0]!==13)x+=b.toString()}return x===phrase};
  // Owner revised monthly target to INR 500 or less, flexible up to 800; detailed billing review deferred for this one TLS run.
  // This is not an assertion of verified current spend, nor permission for additional resources.
  need(approve('ACK_800_INR_LIMIT_BILLING_REVIEW_DEFERRED_EXCLUSIVE_OPERATOR'),'BUDGET_OR_EXCLUSIVITY_NOT_APPROVED');
  const fd=fs.openSync(journal,'wx',0o600);fs.closeSync(fd);note('ATTEMPT_OPEN');
  const deadline=process.hrtime.bigint()+2700n*1000000000n;
  const pause=()=>{need(process.hrtime.bigint()<deadline,'OPERATOR_DEADLINE');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);need(process.hrtime.bigint()<deadline,'OPERATOR_DEADLINE')};
  let writes=0,starts=0;
  const io={snapshot,history,approve,wait:pause,log:msg=>{console.log(msg);note(msg)},
    patch:body=>{need(writes<2,'PATCH_LIMIT');const expected=writes===0?p.apply:p.rollback;need(require('node:util').isDeepStrictEqual(body,expected),'PATCH_BODY_BLOCK');writes++;note('PATCH_'+writes+'_REQUESTING');const f=path.join(dir,'tls-operator-patch-'+writes+'.json');fs.writeFileSync(f,JSON.stringify(body),{mode:0o600,flag:'wx'});az(['rest','--method','patch','--url',URL,'--headers','Content-Type=application/json','--body','@'+f],false);note('PATCH_'+writes+'_REQUEST_ACCEPTED')},
    start:()=>{need(starts===0,'START_LIMIT');checkRbac(ids);need(compare(p.tls,snapshot(),op.ctx).state==='VERIFIED'&&historyGuard(history(),op.prior),'PRE_START_DRIFT');starts++;note('START_REQUESTING');const v=az(['containerapp','job','start','-g',RG,'-n',JOB,'--query','name']);note('START_RESPONSE_RECEIVED');return v}};
  const result=op.run(io,base,{maxPoll:18,maxRunPoll:180});note(result);console.log(JSON.stringify(result));
  console.log('NO_DATABASE_EXPORT_AUTHORIZED=YES');
  if(result.state==='BLOCK'){console.log('DO_NOT_RETRY_USE_INSPECT=YES');process.exitCode=1}
  else if(result.state==='RESTORED'&&result.status!=='Succeeded')process.exitCode=1;
}
if(require.main===module){try{main()}catch(e){console.error('BLOCK '+(/^[A-Z_]+$/.test(e?.message||'')?e.message:'OPERATOR_ERROR_OR_UNKNOWN'));process.exitCode=1}}
