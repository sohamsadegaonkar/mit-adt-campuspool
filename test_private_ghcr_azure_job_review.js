'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {review,reviewCompiled,reviewedImageDigest}=require('./scripts/review-private-ghcr-azure-job');
const base=fs.readFileSync('ops/cloud-backup/containerapp-job.private-ghcr.review.bicep','utf8');
test('manual-only, Vault-backed, pinned private GHCR review configuration is structurally eligible but not authorized',()=>{
 const r=review(base);
 assert.equal(r.status,'CONFIG_STRUCTURE_ELIGIBLE_FOR_REVIEW',JSON.stringify(r.reasons));
 assert.equal(r.deployAuthorized,false);
 assert.equal(r.mayConnectToStaging,false);
 assert.ok(r.unresolved.includes('authenticated_subscription_pricing'));
});
test('rejects any hidden automatic job schedule, retry or live export',()=>{
 for(const added of [
  "\ntriggerType: 'Schedule'\n",
  '\ncronExpression: "0 * * * *"\n',
  "\nname: 'AZURE_EXPORT_APPROVED'\n",
  "\nargs: ['--execute']\n",
  "\nreplicaRetryLimit: 3\n",
  "\ningress: { external: true }\n"
 ])assert.equal(review(base+added).status,'BLOCKED',added);
});
test('rejects removal of private registry token or SSL guard',()=>{
 for(const delta of [
  ["passwordSecretRef: 'ghcr-pull-token'","passwordSecretRef: 'other'"],
  ["value: 'verify-full'","value: 'require'"],
  ["triggerType: 'Manual'","triggerType: 'Event'"],
  ["args: [\n            '--preflight'\n          ]","args: ['--execute']"],
  ["replicaRetryLimit: 0","replicaRetryLimit: 1"]
 ]){
  assert.ok(base.includes(delta[0]),'expected original '+delta[0]);
  assert.equal(review(base.replace(delta[0],delta[1])).status,'BLOCKED');
 }
});
test('rejects hardcoded cloud secret env values, unattended approvals or a second resource',()=>{
 for(const added of [
  "\n{ name: 'PGPASSWORD', value: 'not-real' }\n",
  "\nAZURE_TLS_CHECK_APPROVED: 'YES'\n",
  "\nresource another 'Microsoft.Storage/storageAccounts@2024-01-01' = {}\n",
  "\nimage: 'ghcr.io/org/worker:latest'\n"
 ])assert.equal(review(base+added).status,'BLOCKED');
});

test('Bicep must construct a fixed GHCR repository and a constrained 64-character digest',()=>{
 assert.match(base,/@minLength\(64\)\s*@maxLength\(64\)\s*param ghcrImageSha256 string/);
 assert.equal(review(base.replace('@maxLength(64)','@maxLength(200)')).status,'BLOCKED');
 assert.equal(review(base.replace('campuspool-backup-worker@sha256:', 'some-other-worker@sha256:')).status,'BLOCKED');
 assert.equal(review(base.replace('ghcrImageSha256','arbitraryImage')).status,'BLOCKED');
});

function compiledFixture(){
 const param=name=>"[parameters('"+name+"')]";
 const pull=param('registryPullVaultReaderIdentityResourceId'),data=param('stagingDataIdentityResourceId');
 const envNames=['AZURE_AUTH_MODE','CAMPUSPOOL_CLOUD_WORKER','AZURE_CLIENT_ID','AZURE_KEYVAULT_URL',
  'AZURE_PG_SECRET_NAME','PGHOST','PGPORT','PGDATABASE','PGUSER','PGSSLMODE',
  'PGSSLROOTCERT','AGE_RECIPIENT','AZURE_STORAGE_ACCOUNT','AZURE_BACKUP_CONTAINER',
  'AZURE_PRIVATE_CONTAINER_CONFIRMED'];
 const env=envNames.map(name=>({name,value:name==='PGSSLMODE'?'verify-full':
  name==='PGSSLROOTCERT'?'/mnt/staging-ca/ca.pem':
  name==='AZURE_CLIENT_ID'?"[parameters('stagingDataIdentityClientId')]":
  name==='AZURE_PRIVATE_CONTAINER_CONFIRMED'?'YES':'safe-parameter-expression'}));
 return {parameters:{ghcrImageSha256:{type:'string',minLength:64,maxLength:64}},
  resources:[{type:'Microsoft.App/jobs',apiVersion:'2026-01-01',identity:{type:'UserAssigned',userAssignedIdentities:{[pull]:{},[data]:{}}},
   properties:{workloadProfileName:'Consumption',configuration:{identitySettings:[{identity:pull,lifecycle:'None'},{identity:data,lifecycle:'Main'}],triggerType:'Manual',replicaTimeout:1800,
    replicaRetryLimit:0,manualTriggerConfig:{parallelism:1,replicaCompletionCount:1},
    registries:[{server:'ghcr.io',passwordSecretRef:'ghcr-pull-token'}],
    secrets:[
      {name:'ghcr-pull-token',keyVaultUrl:param('ghcrPullTokenKeyVaultSecretUrl'),identity:pull},
      {name:'staging-pg-root-ca',keyVaultUrl:param('postgresCaKeyVaultSecretUrl'),identity:data}]},
   template:{containers:[{name:'backup-worker',
    image:"[format('ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:{0}', parameters('ghcrImageSha256'))]",
    args:['--preflight'],resources:{cpu:0.5,memory:'1Gi'},env,
    volumeMounts:[{volumeName:'staging-pg-ca',mountPath:'/mnt/staging-ca'}]}],
    volumes:[{name:'staging-pg-ca',storageType:'Secret',
     secrets:[{secretRef:'staging-pg-root-ca',path:'ca.pem'}]}]}}}]};
}
test('compiled ARM has exactly one bounded manual backup container',()=>{
 const good=compiledFixture();
 assert.equal(reviewCompiled(good).status,'COMPILED_STRUCTURE_ELIGIBLE_FOR_REVIEW');
 const compiledCpu=structuredClone(good);
 compiledCpu.resources[0].properties.template.containers[0].resources.cpu="[json('0.5')]";
 assert.equal(reviewCompiled(compiledCpu).status,'COMPILED_STRUCTURE_ELIGIBLE_FOR_REVIEW');
 const mutations=[
  x=>x.resources[0].identity.type='SystemAssigned,UserAssigned',
  x=>x.resources[0].identity.userAssignedIdentities['unexpected-identity']={},
  x=>x.resources[0].properties.configuration.identitySettings[0].lifecycle='All',
  x=>x.resources[0].properties.configuration.identitySettings[1].lifecycle='None',
  x=>x.resources[0].properties.configuration.identitySettings=[],
  x=>x.resources[0].properties.configuration.secrets[0].identity=x.resources[0].properties.configuration.secrets[1].identity,
  x=>x.resources[0].properties.template.containers[0].env.find(e=>e.name==='AZURE_CLIENT_ID').value='wrong-client',
  x=>x.resources[0].properties.template.containers.push({name:'another',image:'busybox'}),
  x=>x.resources[0].properties.template.initContainers=[{name:'sidecar'}],
  x=>x.resources[0].properties.template.containers[0].command=['sh'],
  x=>x.resources[0].properties.template.containers[0].resources.cpu="[json('1.5')]",
  x=>x.resources[0].properties.configuration.registries.push({server:'evil.example'}),
  x=>x.resources[0].properties.template.containers[0].env.push({name:'PGPASSWORD',value:'bad'}),
  x=>x.resources[0].properties.configuration.secrets[0].value='inline-secret',
  x=>x.resources[0].properties.configuration.replicaRetryLimit=2,
  x=>x.parameters.ghcrImageSha256.maxLength=200,
  x=>x.resources[0].properties.template.containers[0].image='docker.io/public/worker:latest'
 ];
 for(const mutate of mutations){
   const bad=structuredClone(good);mutate(bad);
   assert.equal(reviewCompiled(bad).status,'BLOCKED');
 }
});
test('signed GHCR image digest permits exact lower-case digest only',()=>{
 assert.equal(reviewedImageDigest('ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+'a'.repeat(64)),true);
 for(const s of [
  'ghcr.io/sohamsadegaonkar/campuspool-backup-worker:latest',
  'docker.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+'b'.repeat(64),
  'ghcr.io/another-org/worker@sha256:'+'c'.repeat(64),
  'ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:123',
  'ghcr.io/sohamsadegaonkar/other-worker@sha256:'+'c'.repeat(64),
  'ghcr.io/sohamsadegaonkar/worker@sha256:'+'A'.repeat(64)
 ])assert.equal(reviewedImageDigest(s),false,s);
});

test('source review rejects lifecycle or identity drift rather than relaxing the old guard',()=>{
 for(const [before,after] of [
  ["lifecycle: 'None'","lifecycle: 'All'"],
  ["lifecycle: 'Main'","lifecycle: 'None'"],
  ["type: 'UserAssigned'","type: 'SystemAssigned,UserAssigned'"],
  ["value: stagingDataIdentityClientId","value: 'wrong-client'"]
 ]){
  assert.ok(base.includes(before));
  assert.equal(review(base.replace(before,after)).status,'BLOCKED');
 }
});
