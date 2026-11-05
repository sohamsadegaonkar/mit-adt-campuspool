'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {review,reviewedImageDigest}=require('./scripts/review-private-ghcr-azure-job');
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
test('signed GHCR image digest permits exact lower-case digest only',()=>{
 assert.equal(reviewedImageDigest('ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+'a'.repeat(64)),true);
 for(const s of [
  'ghcr.io/sohamsadegaonkar/campuspool-backup-worker:latest',
  'docker.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+'b'.repeat(64),
  'ghcr.io/another-org/worker@sha256:'+'c'.repeat(64),
  'ghcr.io/sohamsadegaonkar/worker@sha256:123',
  'ghcr.io/sohamsadegaonkar/worker@sha256:'+'A'.repeat(64)
 ])assert.equal(reviewedImageDigest(s),false,s);
});
