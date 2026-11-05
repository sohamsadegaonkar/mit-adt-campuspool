'use strict';
// Static review guard: never deploys, never reads billing or secrets.
const fs=require('node:fs');
const file='ops/cloud-backup/containerapp-job.private-ghcr.review.bicep';

function review(source){
 const reasons=[];
 const need=(re,code)=>{if(!re.test(source))reasons.push(code);};
 const ban=(re,code)=>{if(re.test(source))reasons.push(code);};
 need(/resource manualBackupJob 'Microsoft\.App\/jobs@2024-03-01'/,'JOB_RESOURCE_UNKNOWN');
 need(/triggerType:\s*'Manual'/,'JOB_MUST_BE_MANUAL');
 need(/replicaTimeout:\s*1800/,'JOB_TIMEOUT_UNREVIEWED');
 need(/replicaRetryLimit:\s*0/,'JOB_RETRIES_MUST_BE_ZERO');
 need(/parallelism:\s*1/,'JOB_MUST_BE_ONE_REPLICA');
 need(/replicaCompletionCount:\s*1/,'JOB_COMPLETION_MUST_BE_ONE');
 need(/@minLength\(64\)\s*@maxLength\(64\)\s*param ghcrImageSha256 string/,'SHA256_PARAMETER_LENGTH_REQUIRED');
 need(/image:\s*'ghcr\.io\/sohamsadegaonkar\/campuspool-backup-worker@sha256:\$\{ghcrImageSha256\}'/,'FIXED_DIGEST_IMAGE_REFERENCE_REQUIRED');
 need(/passwordSecretRef:\s*'ghcr-pull-token'/,'PRIVATE_GHCR_SECRET_REQUIRED');
 need(/server:\s*'ghcr\.io'/,'REGISTRY_SERVER_MISMATCH');
 need(/keyVaultUrl:\s*ghcrPullTokenKeyVaultSecretUrl/,'REGISTRY_TOKEN_VAULT_REF_REQUIRED');
 need(/identity:\s*registryPullVaultReaderIdentityResourceId/,'VAULT_READER_IDENTITY_REQUIRED');
 need(/type:\s*'SystemAssigned,UserAssigned'/,'ISOLATED_JOB_IDENTITIES_REQUIRED');
 need(/args:\s*\[\s*'--preflight'\s*\]/,'DEFAULT_PRE_FLIGHT_REQUIRED');
 need(/name:\s*'PGSSLMODE',\s*value:\s*'verify-full'/,'TLS_VERIFY_FULL_REQUIRED');
 need(/name:\s*'PGSSLROOTCERT',\s*value:\s*'\/mnt\/staging-ca\/ca\.pem'/,'CA_ROOT_FILE_REQUIRED');
 need(/storageType:\s*'Secret'/,'PUBLIC_CA_FILE_MOUNT_REQUIRED');
 need(/name:\s*'AZURE_AUTH_MODE',\s*value:\s*'managed-identity'/,'MANAGED_IDENTITY_REQUIRED');
 need(/name:\s*'AZURE_BACKUP_CONTAINER',\s*value:\s*'campuspool-staging-backups'/,'BACKUP_CONTAINER_MISMATCH');
 need(/name:\s*'AZURE_PRIVATE_CONTAINER_CONFIRMED',\s*value:\s*'YES'/,'PRIVATE_BLOB_REQUIRED');
 need(/@allowed\(\['malaysiawest'\]\)/,'REGION_NOT_FIXED');
 ban(/name:\s*'(?:PGPASSWORD|AGE_IDENTITY|AZURE_STORAGE_KEY|GHCR_TOKEN)'/,'SECRET_AS_CONTAINER_ENV');
 ban(/(?:AZURE_EXPORT_APPROVED|AZURE_TLS_CHECK_APPROVED|--execute|--check-tls)/,'LIVE_EXECUTION_CONFIG_FORBIDDEN');
 ban(/triggerType:\s*'(?:Event|Schedule)'|cronExpression|scheduleTriggerConfig/,'AUTOMATIC_EXECUTION_FORBIDDEN');
 ban(/(?:ingress:|external:|targetPort:)/,'JOB_INGRESS_FORBIDDEN');
 ban(/\bvalue:\s*'(?:ghp_|github_pat_|pk_[a-z]|age-secret-key-)/i,'CREDENTIAL_LITERAL_FORBIDDEN');
 ban(/(?:'latest'|:[Ll][Aa][Tt][Ee][Ss][Tt]')/,'MUTABLE_IMAGE_TAG_FORBIDDEN');
 ban(/\bparam\s+signedGhcrImageDigest\b/,'RAW_IMAGE_REFERENCE_PARAMETER_FORBIDDEN');
 const criticalKeys=['triggerType','replicaTimeout','replicaRetryLimit',
   'parallelism','replicaCompletionCount','image','args','passwordSecretRef'];
 for(const name of criticalKeys){
   const hits=(source.match(new RegExp('\\b'+name+'\\s*:', 'g'))||[]);
   if(hits.length!==1)reasons.push('DUPLICATE_OR_MISSING_CRITICAL_FIELD_'+name);
 }
 const resources=source.match(/\bresource\s+[A-Za-z0-9_]+\s+'Microsoft\.[^']+'/g)||[];
 if(resources.length!==1)reasons.push('ADDITIONAL_AZURE_RESOURCES_NOT_REVIEWED');
 return {status:reasons.length?'BLOCKED':'CONFIG_STRUCTURE_ELIGIBLE_FOR_REVIEW',
  reasons,deployAuthorized:false,mayConnectToStaging:false,
  unresolved:['authenticated_subscription_pricing','human_security_approval',
    'private_GHCR_read_token_lifecycle','identity_role_scopes',
    'actual_CA_volume_mount_file_safety','published_digest_signature',
    'real_staging_tls','independent_age_pg17_postgis_restore']};
}
function reviewedImageDigest(value){
 return typeof value==='string' &&
  /^ghcr\.io\/sohamsadegaonkar\/campuspool-backup-worker@sha256:[0-9a-f]{64}$/.test(value);
}

function reviewCompiled(template){
 const reasons=[];
 const fail=(when,code)=>{if(when)reasons.push(code);};
 const resources=template?.resources;
 const job=Array.isArray(resources)&&resources.length===1?resources[0]:null;
 fail(!job||job.type!=='Microsoft.App/jobs','COMPILED_RESOURCE_SCOPE_UNREVIEWED');
 const digest=template?.parameters?.ghcrImageSha256;
 fail(!digest||digest.type!=='string'||digest.minLength!==64||digest.maxLength!==64,
   'COMPILED_DIGEST_LENGTH_UNBOUNDED');
 fail(job?.identity?.type!=='SystemAssigned,UserAssigned','COMPILED_IDENTITIES_CHANGED');
 const cfg=job?.properties?.configuration;
 const run=cfg?.manualTriggerConfig;
 fail(cfg?.triggerType!=='Manual'||cfg?.replicaTimeout!==1800||cfg?.replicaRetryLimit!==0||
   run?.parallelism!==1||run?.replicaCompletionCount!==1,
   'COMPILED_MANUAL_SINGLE_ATTEMPT_REQUIRED');
 const registries=cfg?.registries;
 fail(!Array.isArray(registries)||registries.length!==1||
   registries[0].server!=='ghcr.io'||registries[0].passwordSecretRef!=='ghcr-pull-token',
   'COMPILED_REGISTRY_AUTH_CHANGED');
 const secrets=cfg?.secrets;
 fail(!Array.isArray(secrets)||secrets.length!==2||
   !secrets.some(x=>x.name==='ghcr-pull-token'&&x.keyVaultUrl&&x.identity)||
   !secrets.some(x=>x.name==='staging-pg-root-ca'&&x.keyVaultUrl&&x.identity)||
   secrets.some(x=>Object.hasOwn(x,'value')),
   'COMPILED_SECRETS_UNREVIEWED');
 const tpl=job?.properties?.template;
 const containers=tpl?.containers;
 fail(!Array.isArray(containers)||containers.length!==1,'COMPILED_EXTRA_CONTAINER_FORBIDDEN');
 fail(Array.isArray(tpl?.initContainers)&&tpl.initContainers.length>0,
   'COMPILED_INIT_CONTAINER_FORBIDDEN');
 const c=Array.isArray(containers)?containers[0]:null;
 const image=typeof c?.image==='string'?c.image:'';
 fail(c?.name!=='backup-worker'||!image.includes('ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:')||
   !image.includes('ghcrImageSha256'),'COMPILED_IMAGE_NOT_FIXED');
 fail(!Array.isArray(c?.args)||c.args.length!==1||c.args[0]!=='--preflight'||
   Object.hasOwn(c||{},'command'),'COMPILED_EXECUTION_NOT_PREFLIGHT');
 fail(!c?.resources||c.resources.cpu!==0.5||c.resources.memory!=='1Gi',
   'COMPILED_RESOURCES_UNREVIEWED');
 const mounts=c?.volumeMounts;
 const volumes=tpl?.volumes;
 fail(!Array.isArray(mounts)||mounts.length!==1||
   mounts[0].volumeName!=='staging-pg-ca'||mounts[0].mountPath!=='/mnt/staging-ca'||
   !Array.isArray(volumes)||volumes.length!==1||
   volumes[0].name!=='staging-pg-ca'||volumes[0].storageType!=='Secret'||
   !Array.isArray(volumes[0].secrets)||volumes[0].secrets.length!==1||
   volumes[0].secrets[0].secretRef!=='staging-pg-root-ca'||volumes[0].secrets[0].path!=='ca.pem',
   'COMPILED_VOLUME_UNREVIEWED');
 const env=c?.env;
 const expected=new Set(['AZURE_AUTH_MODE','CAMPUSPOOL_CLOUD_WORKER',
  'AZURE_KEYVAULT_URL','AZURE_PG_SECRET_NAME','PGHOST','PGPORT',
  'PGDATABASE','PGUSER','PGSSLMODE','PGSSLROOTCERT','AGE_RECIPIENT',
  'AZURE_STORAGE_ACCOUNT','AZURE_BACKUP_CONTAINER','AZURE_PRIVATE_CONTAINER_CONFIRMED']);
 fail(!Array.isArray(env)||env.length!==expected.size||
  env.some(e=>!expected.has(e.name)||!Object.hasOwn(e,'value')||Object.hasOwn(e,'secretRef'))||
  new Set(env.map(e=>e.name)).size!==expected.size,'COMPILED_ENV_ALLOWLIST_CHANGED');
 fail(!Array.isArray(env)||!env.some(e=>e.name==='PGSSLMODE'&&e.value==='verify-full')||
   !env.some(e=>e.name==='PGSSLROOTCERT'&&e.value==='/mnt/staging-ca/ca.pem')||
   !env.some(e=>e.name==='AZURE_PRIVATE_CONTAINER_CONFIRMED'&&e.value==='YES'),
   'COMPILED_SECURITY_ENV_MISSING');
 return {status:reasons.length?'BLOCKED':'COMPILED_STRUCTURE_ELIGIBLE_FOR_REVIEW',
  reasons,deployAuthorized:false,mayConnectToStaging:false};
}

if(require.main===module){
 let output;
 try{
  if(process.argv[2]==='--compiled')
    output=reviewCompiled(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
  else output=review(fs.readFileSync(process.argv[2]||file,'utf8'));
 }
 catch{output={status:'BLOCKED',reasons:['CONFIGURATION_UNREADABLE'],deployAuthorized:false};}
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
 if(output.status==='BLOCKED')process.exitCode=1;
}
module.exports={review,reviewCompiled,reviewedImageDigest};
