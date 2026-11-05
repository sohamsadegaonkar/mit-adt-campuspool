'use strict';
// Review-only analysis: never authenticates, provisions, starts a job, or reads a database.
const fs=require('node:fs');
const path='ops/cloud-backup/containerapp-job.registry-portable.review.bicep';
const fixedRepository='campuspool-backup-worker';
const ghcrHost='ghcr.io/sohamsadegaonkar/';
const fields=['AZURE_AUTH_MODE','CAMPUSPOOL_CLOUD_WORKER','AZURE_KEYVAULT_URL',
  'AZURE_PG_SECRET_NAME','PGHOST','PGPORT','PGDATABASE','PGUSER','PGSSLMODE',
  'PGSSLROOTCERT','AGE_RECIPIENT','AZURE_STORAGE_ACCOUNT','AZURE_BACKUP_CONTAINER',
  'AZURE_PRIVATE_CONTAINER_CONFIRMED'];

function checkSource(source){
 const errors=[];
 const requireMatch=(pattern,code)=>{if(!pattern.test(source))errors.push(code)};
 const banMatch=(pattern,code)=>{if(pattern.test(source))errors.push(code)};
 requireMatch(/@allowed\(\['ghcr', 'acr'\]\)\s*param registryProvider string = 'ghcr'/,'DEFAULT_PRIVATE_GHCR_REQUIRED');
 requireMatch(/@minLength\(64\)\s*@maxLength\(64\)\s*param imageSha256 string/,'DIGEST_LENGTH_REQUIRED');
 requireMatch(/var isAcr = registryProvider == 'acr'/,'ACR_BRANCH_REQUIRED');
 requireMatch(/userAssignedIdentities:\s*isAcr \?/,'SEPARATE_IDENTITY_BRANCH_REQUIRED');
 requireMatch(/registries:\s*isAcr \?/,'REGISTRY_BRANCH_REQUIRED');
 requireMatch(/secrets:\s*isAcr \?/,'TOKEN_REMOVAL_BRANCH_REQUIRED');
 requireMatch(/image:\s*isAcr \?/,'IMAGE_BRANCH_REQUIRED');
 requireMatch(/server:\s*'\$\{acrRegistryName\}\.azurecr\.io'/,'ACR_SERVER_REQUIRED');
 requireMatch(/identity:\s*acrPullIdentityResourceId/,'ACR_PULL_IDENTITY_REQUIRED');
 requireMatch(/server:\s*'ghcr\.io'/,'GHCR_SERVER_REQUIRED');
 requireMatch(/passwordSecretRef:\s*'ghcr-pull-token'/,'GHCR_VAULT_TOKEN_REQUIRED');
 requireMatch(/name:\s*'staging-pg-root-ca'/,'CA_SECRET_REQUIRED');
 requireMatch(/storageType:\s*'Secret'/,'CA_SECRET_MOUNT_REQUIRED');
 requireMatch(/'\$\{acrRegistryName\}\.azurecr\.io\/campuspool-backup-worker@sha256:\$\{imageSha256\}'/,'PINNED_ACR_IMAGE_REQUIRED');
 requireMatch(/'ghcr\.io\/sohamsadegaonkar\/campuspool-backup-worker@sha256:\$\{imageSha256\}'/,'PINNED_GHCR_IMAGE_REQUIRED');
 requireMatch(/triggerType:\s*'Manual'/,'MANUAL_ONLY');
 requireMatch(/replicaRetryLimit:\s*0/,'NO_RETRIES');
 requireMatch(/parallelism:\s*1/,'ONE_REPLICA');
 requireMatch(/replicaCompletionCount:\s*1/,'ONE_COMPLETION');
 requireMatch(/replicaTimeout:\s*1800/,'TIMEOUT_UNCHANGED');
 requireMatch(/args:\s*\[\s*'--preflight'\s*\]/,'PREFLIGHT_ONLY');
 requireMatch(/name:\s*'PGSSLMODE',\s*value:\s*'verify-full'/,'VERIFY_FULL_REQUIRED');
 requireMatch(/name:\s*'PGSSLROOTCERT',\s*value:\s*'\/mnt\/staging-ca\/ca.pem'/,'CA_PATH_UNCHANGED');
 requireMatch(/name:\s*'AZURE_BACKUP_CONTAINER',\s*value:\s*'campuspool-staging-backups'/,'BLOB_DESTINATION_UNCHANGED');
 requireMatch(/name:\s*'AZURE_PRIVATE_CONTAINER_CONFIRMED',\s*value:\s*'YES'/,'PRIVATE_BLOB_REQUIRED');
 requireMatch(/type:\s*'SystemAssigned,UserAssigned'/,'JOB_IDENTITIES_REQUIRED');
 banMatch(/(?:--execute|--check-tls|AZURE_EXPORT_APPROVED|AZURE_TLS_CHECK_APPROVED)/,'LIVE_OR_TLS_EXECUTION_FORBIDDEN');
 banMatch(/(?:cronExpression|scheduleTriggerConfig|triggerType:\s*'(?:Schedule|Event)')/,'SCHEDULE_FORBIDDEN');
 banMatch(/(?:name:\s*'(?:PGPASSWORD|AZURE_STORAGE_KEY|GHCR_TOKEN|AGE_IDENTITY)')/,'SECRET_ENV_FORBIDDEN');
 banMatch(/(?:ingress:|targetPort:|external:)/,'INGRESS_FORBIDDEN');
 banMatch(/(?:':latest'|:latest\b)/i,'MUTABLE_IMAGE_FORBIDDEN');
 const resources=source.match(/\bresource\s+\w+\s+'Microsoft\.[^']+'/g)||[];
 if(resources.length!==1||!resources[0].includes('Microsoft.App/jobs@2024-03-01'))
   errors.push('ONE_MANUAL_JOB_ONLY');
 const requiredSettings=['registries','image','args','triggerType',
   'replicaRetryLimit','parallelism','replicaCompletionCount'];
 for(const key of requiredSettings)
   if((source.match(new RegExp('\\b'+key+'\\s*:','g'))||[]).length!==1)
     errors.push('CRITICAL_FIELD_DUPLICATED_OR_MISSING_'+key);
 return result(errors);
}

function reviewCompiled(arm) {
 const errors=[];
 const params=arm?.parameters||{};
 if(params.registryProvider?.defaultValue!=='ghcr'||
   JSON.stringify(params.registryProvider?.allowedValues)!==JSON.stringify(['ghcr','acr']))
   errors.push('COMPILED_PROVIDER_DEFAULT_OR_ALLOWLIST_CHANGED');
 if(params.imageSha256?.minLength!==64||params.imageSha256?.maxLength!==64)
   errors.push('COMPILED_DIGEST_LENGTH_CHANGED');
 const items=arm?.resources;
 const job=Array.isArray(items)&&items.length===1?items[0]:null;
 if(job?.type!=='Microsoft.App/jobs')errors.push('COMPILED_UNEXPECTED_RESOURCES');
 const config=job?.properties?.configuration;
 const trigger=config?.manualTriggerConfig;
 if(config?.triggerType!=='Manual'||config?.replicaRetryLimit!==0||
   config?.replicaTimeout!==1800||trigger?.parallelism!==1||
   trigger?.replicaCompletionCount!==1)
   errors.push('COMPILED_EXECUTION_POLICY_CHANGED');
 if(job?.identity?.type!=='SystemAssigned,UserAssigned')errors.push('COMPILED_IDENTITY_POLICY_CHANGED');
 const identityBranches=JSON.stringify(job?.identity?.userAssignedIdentities||null);
 if(!identityBranches.includes("variables('isAcr')")||
   !identityBranches.includes('acrPullIdentityResourceId')||
   !identityBranches.includes('registryPullVaultReaderIdentityResourceId'))
   errors.push('COMPILED_ACR_IDENTITY_ISOLATION_UNVERIFIED');
 const modeExpression=arm?.variables?.isAcr;
 if(modeExpression!=="[equals(parameters('registryProvider'), 'acr')]")
   errors.push('COMPILED_PROVIDER_CONDITION_CHANGED');
 const reg=JSON.stringify(config?.registries||null);
 if(!reg.includes("variables('isAcr')")||!reg.includes('ghcr.io')||
   !reg.includes('azurecr.io')||!reg.includes('acrPullIdentityResourceId')||
   !reg.includes('ghcr-pull-token'))
   errors.push('COMPILED_REGISTRY_SWITCH_MISSING');
 const secrets=JSON.stringify(config?.secrets||null);
 if(!secrets.includes("variables('isAcr')")||!secrets.includes('staging-pg-root-ca')||
   !secrets.includes('ghcr-pull-token')||!secrets.includes('keyVaultUrl')||
   secrets.includes('age-secret-key-'))
   errors.push('COMPILED_REGISTRY_SECRETS_UNSAFE');
 const containers=job?.properties?.template?.containers;
 if(!Array.isArray(containers)||containers.length!==1)
   errors.push('COMPILED_WORKER_COUNT_CHANGED');
 if(job?.properties?.template?.initContainers?.length)
   errors.push('COMPILED_INIT_CONTAINER_FORBIDDEN');
 const container=Array.isArray(containers)?containers[0]:null;
 if(container?.name!=='backup-worker'||!Array.isArray(container?.args)||
   container.args.length!==1||container.args[0]!=='--preflight'||
   Object.hasOwn(container||{},'command'))
   errors.push('COMPILED_WORKER_COMMAND_CHANGED');
 const image=String(container?.image||'');
 if(!image.includes("variables('isAcr')")||!image.includes('campuspool-backup-worker@sha256:')||
   !image.includes('ghcr.io')||!image.includes('azurecr.io')||!image.includes('imageSha256'))
   errors.push('COMPILED_IMAGE_BRANCH_CHANGED');
 if(container?.resources?.memory!=='1Gi'||
   ![0.5,"[json('0.5')]"].includes(container?.resources?.cpu))
   errors.push('COMPILED_COMPUTE_CHANGED');
 const env=container?.env||[];
 const names=new Set(fields);
 if(!Array.isArray(env)||env.length!==fields.length||
   new Set(env.map(x=>x.name)).size!==fields.length||
   env.some(x=>!names.has(x.name)||Object.hasOwn(x,'secretRef'))||
   !env.some(x=>x.name==='PGSSLMODE'&&x.value==='verify-full')||
   !env.some(x=>x.name==='AZURE_PRIVATE_CONTAINER_CONFIRMED'&&x.value==='YES'))
   errors.push('COMPILED_WORKER_ENV_DRIFT');
 const mounts=container?.volumeMounts||[];
 const volumes=job?.properties?.template?.volumes||[];
 if(mounts.length!==1||mounts[0].volumeName!=='staging-pg-ca'||
   mounts[0].mountPath!=='/mnt/staging-ca'||volumes.length!==1||
   volumes[0].storageType!=='Secret'||volumes[0].secrets?.length!==1||
   volumes[0].secrets[0].secretRef!=='staging-pg-root-ca'||
   volumes[0].secrets[0].path!=='ca.pem')
   errors.push('COMPILED_CA_MOUNT_DRIFT');
 return result(errors);
}

function reviewTransition(input) {
 const errors=[];
 if(!input||typeof input!=='object'||Array.isArray(input))
   return result(['CONFIG_REQUIRED']);
 if(!['ghcr','acr'].includes(input.registryProvider))
   errors.push('PROVIDER_NOT_ALLOWED');
 if(typeof input.imageSha256!=='string'||!/^[0-9a-f]{64}$/.test(input.imageSha256))
   errors.push('DIGEST_MUST_BE_LOWERCASE_SHA256');
 if(input.registryProvider==='acr') {
   if(!/^[a-z0-9]{5,50}$/.test(input.acrRegistryName||''))
     errors.push('ACR_REGISTRY_NAME_INVALID');
   if(!/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[a-zA-Z0-9._()-]+\/providers\/Microsoft\.ManagedIdentity\/userAssignedIdentities\/[a-zA-Z0-9._-]+$/.test(input.acrPullIdentityResourceId||''))
     errors.push('ACR_USER_ASSIGNED_IDENTITY_REQUIRED');
   if(input.ghcrPullToken||input.ghcrPullTokenKeyVaultSecretUrl||input.ghcrReadOnlyUsername)
     errors.push('GHCR_AUTH_MUST_NOT_LEAK_IN_ACR_MODE');
   if(!/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[a-zA-Z0-9._()-]+\/providers\/Microsoft\.ManagedIdentity\/userAssignedIdentities\/[a-zA-Z0-9._-]+$/.test(input.registryPullVaultReaderIdentityResourceId||''))
     errors.push('CA_VAULT_READER_IDENTITY_REQUIRED');
   if(input.acrPullIdentityResourceId===input.registryPullVaultReaderIdentityResourceId)
     errors.push('ACR_PULL_IDENTITY_MUST_DIFFER_FROM_CA_READER');
 } else if(input.registryProvider==='ghcr') {
   if(input.acrRegistryName||input.acrPullIdentityResourceId)
     errors.push('ACR_SETTINGS_NOT_USED_IN_GHCR_MODE');
 }
 if(Object.keys(input).some(k=>/password|tokenvalue|secretvalue|privatekey/i.test(k)))
   errors.push('INLINE_CREDENTIAL_FIELD_FORBIDDEN');
 return result(errors);
}

function result(reasons) {return {
 status:reasons.length?'BLOCKED':'REVIEW_ELIGIBLE',reasons,
 provisioningAuthorized:false,backupAuthorized:false,migrationAuthorized:false
};}

if(require.main===module) {
 let outcome;
 try{
  if(process.argv[2]==='--compiled')
    outcome=reviewCompiled(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
  else if(process.argv[2]==='--transition')
    outcome=reviewTransition(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
  else outcome=checkSource(fs.readFileSync(process.argv[2]||path,'utf8'));
 } catch { outcome=result(['INPUT_UNREADABLE_OR_INVALID']); }
 process.stdout.write(JSON.stringify(outcome,null,2)+'\n');
 if(outcome.status==='BLOCKED')process.exitCode=1;
}
module.exports={checkSource,reviewCompiled,reviewTransition};
