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
 need(/image:\s*signedGhcrImageDigest/,'IMMUTABLE_IMAGE_PARAMETER_REQUIRED');
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
  /^ghcr\.io\/sohamsadegaonkar\/[a-z0-9._-]+@sha256:[0-9a-f]{64}$/.test(value);
}
if(require.main===module){
 let output;
 try{output=review(fs.readFileSync(process.argv[2]||file,'utf8'));}
 catch{output={status:'BLOCKED',reasons:['CONFIGURATION_UNREADABLE'],deployAuthorized:false};}
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
 if(output.status==='BLOCKED')process.exitCode=1;
}
module.exports={review,reviewedImageDigest};
