'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {checkSource,reviewTransition}=require('./scripts/review-registry-portability');
const config=fs.readFileSync('ops/cloud-backup/containerapp-job.registry-portable.review.bicep','utf8');
const digest='a'.repeat(64);
const acrId='/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-example/providers/Microsoft.ManagedIdentity/userAssignedIdentities/acr-reader';
const caId='/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-example/providers/Microsoft.ManagedIdentity/userAssignedIdentities/ca-reader';

test('GHCR stays the default and same worker configuration is used for both registry modes',()=>{
 const r=checkSource(config);
 assert.equal(r.status,'REVIEW_ELIGIBLE',JSON.stringify(r.reasons));
 assert.equal(r.provisioningAuthorized,false);
 assert.equal(r.backupAuthorized,false);
 assert.equal((config.match(/resource manualBackupJob/g)||[]).length,1);
 assert.equal((config.match(/name: 'backup-worker'/g)||[]).length,1);
});
test('reject registry credential, execution and policy bypass in source',()=>{
 const cases=[
  config.replace("param registryProvider string = 'ghcr'","param registryProvider string = 'acr'"),
  config.replace("server: '${acrRegistryName}.azurecr.io'","server: 'attacker.example'"),
  config.replace("image: isAcr ?","image: "),
  config.replace("replicaRetryLimit: 0","replicaRetryLimit: 3"),
  config.replace("triggerType: 'Manual'","triggerType: 'Schedule'"),
  config.replace("'--preflight'","'--execute'"),
  config+"\nresource bad 'Microsoft.Storage/storageAccounts@2024-01-01' = {}",
  config+"\ningress: { external: true }"
 ];
 for(const c of cases)assert.equal(checkSource(c).status,'BLOCKED');
});
test('both registry previews require a lowercase 64-hex digest and never authorize deployment',()=>{
 for(const config of [
  {registryProvider:'ghcr',imageSha256:digest},
  {registryProvider:'acr',imageSha256:digest,acrRegistryName:'campuspoolregistry01',
   acrPullIdentityResourceId:acrId,registryPullVaultReaderIdentityResourceId:caId}
 ]) {
  const r=reviewTransition(config);
  assert.equal(r.status,'REVIEW_ELIGIBLE',JSON.stringify(r.reasons));
  assert.equal(r.provisioningAuthorized,false);
 }
});
test('ACR transition cannot reuse or leak GHCR secret and needs reader identity',()=>{
 const base={registryProvider:'acr',imageSha256:digest,acrRegistryName:'campuspoolregistry01',acrPullIdentityResourceId:acrId,registryPullVaultReaderIdentityResourceId:caId};
 for(const change of [
  {acrRegistryName:'bad.example.com'},
  {acrPullIdentityResourceId:''},
  {registryPullVaultReaderIdentityResourceId:''},
  {registryPullVaultReaderIdentityResourceId:acrId},
  {ghcrPullTokenKeyVaultSecretUrl:'https://example.vault.azure.net/secrets/ghcr'},
  {ghcrReadOnlyUsername:'gh-user'},
  {imageSha256:'Z'.repeat(64)},
  {imageSha256:digest.replace('a','g')},
  {password:'never-store'}
 ]) {
  const review=reviewTransition({...base,...change});
  assert.equal(review.status,'BLOCKED',JSON.stringify(change));
 }
});
test('GHCR transition cannot silently select a paid ACR or inline credentials',()=>{
 for(const overrides of [
  {acrRegistryName:'registryname'},
  {acrPullIdentityResourceId:acrId},
  {privateKey:'do-not-store'},
  {imageSha256:'f'.repeat(63)}
 ])assert.equal(reviewTransition({registryProvider:'ghcr',imageSha256:digest,...overrides}).status,'BLOCKED');
});
test('future registry is not an arbitrary provider',()=>{
 assert.equal(reviewTransition({registryProvider:'dockerhub',imageSha256:digest}).status,'BLOCKED');
 assert.equal(reviewTransition(null).status,'BLOCKED');
});
