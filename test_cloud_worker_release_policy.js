'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  ARCHIVE_NAME,REVIEW_FILES,SOURCE_REPOSITORY,WORKFLOW_FILE,
  candidateInventory
}=require('./scripts/cloud-backup-release-source-inventory');

const ci=fs.readFileSync(path.join(__dirname,WORKFLOW_FILE),'utf8');
const docker=fs.readFileSync(path.join(__dirname,'ops/cloud-backup/Dockerfile'),'utf8');

test('public CI has no GHCR package write or sign-existing-image route',()=>{
  assert.doesNotMatch(ci, /^\s*packages:\s*write\b/m);
  assert.doesNotMatch(ci, /manually-sign-reviewed-ghcr|sign_existing_oci|SIGN_EXACT_35E37DA_GHCR/);
  assert.doesNotMatch(ci, /\bcosign\s+sign\s+--yes\b|\bdocker\s+push\b|\bpush-to-registry:\s*true\b/);
  assert.doesNotMatch(ci, /--push\b/);
  assert.match(ci, /workflow_dispatch:\s*\n\s*permissions:/);
  assert.match(ci, /CANDIDATE_OCI_ARCHIVE_SIGSTORE_VERIFIED; NOT_A_REGISTRY_IMAGE_SIGNATURE/);
  assert.match(ci, /signed-oci-candidate:/);
  assert.match(ci, /event\.pull_request\.head\.repo\.full_name == github\.repository/);
});
test('reviewed source includes CA projection guard and scoped backup contract',()=>{
  const ca=fs.readFileSync(path.join(__dirname,'scripts/cloud-backup-runtime-security.js'),'utf8');
  const scope=fs.readFileSync(path.join(__dirname,'scripts/cloud-backup-scope.js'),'utf8');
  assert.match(ca,/projectedCaMount:'.?\/mnt\/staging-ca'/);
  assert.match(ca,/resolved\.startsWith\(projectedCaMount\+path\.sep\)/);
  assert.match(scope,/independentArchiveRestoreVerified:false/);
  assert.match(scope,/releaseReady:false/);
  assert.match(docker,/^USER 65532:65532$/m);
  assert.match(docker,/^CMD \["--preflight"\]$/m);
  assert.match(docker,/^COPY scripts\/cloud-backup-scope\.js \.\/scripts\/cloud-backup-scope\.js$/m);
});
test('source inventory is an unsigned LOCAL archive record, never a GHCR image claim',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-provenance-test-'));
  try{
    for(const name of REVIEW_FILES){
      const file=path.join(dir,name);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,'SYNTHETIC_SOURCE_FILE_'+name+'\n');
    }
    const tar=path.join(dir,ARCHIVE_NAME);
    fs.writeFileSync(tar,'SYNTHETIC_LOCAL_OCI_TAR\n');
    const sha='1'.repeat(40);
    const head='2'.repeat(40);
    const data=await candidateInventory({
      root:dir,archivePath:tar,
      checkoutSha:sha,prHeadSha:head,
      workflowRef:SOURCE_REPOSITORY+'/'+WORKFLOW_FILE+'@refs/pull/75/merge'
    });
    assert.equal(data.checkoutCommit,sha);
    assert.equal(data.prHeadCommit,head);
    assert.equal(Object.keys(data.sourceFilesSha256).length,REVIEW_FILES.length);
    assert.match(data.localOciTar.sha256,/^[a-f0-9]{64}$/);
    assert.equal(data.ghcrImageManifestDigest,null);
    assert.equal(data.authenticatedBuildProvenanceVerified,false);
    assert.equal(data.publishedImageSignatureVerified,false);
    assert.equal(data.independentScanOfPublishedDigestVerified,false);
    assert.equal(data.deploymentAuthorized,false);
    assert.equal(data.releaseReady,false);
    await assert.rejects(candidateInventory({
      root:dir,archivePath:tar,checkoutSha:sha,prHeadSha:'bad',
      workflowRef:SOURCE_REPOSITORY+'/'+WORKFLOW_FILE+'@refs/pull/75/merge'
    }),/PR_HEAD_MUST_BE_FULL_COMMIT_SHA/);
    await assert.rejects(candidateInventory({
      root:dir,archivePath:tar,checkoutSha:sha,prHeadSha:head,
      workflowRef:'attacker/repository/'+WORKFLOW_FILE+'@refs/heads/main'
    }),/UNEXPECTED_BUILD_WORKFLOW/);
    await assert.rejects(candidateInventory({
      root:dir,archivePath:tar+'.wrong',checkoutSha:sha,prHeadSha:head,
      workflowRef:SOURCE_REPOSITORY+'/'+WORKFLOW_FILE+'@refs/heads/main'
    }),/INVALID_ARCHIVE_PATH/);
    fs.symlinkSync(tar,path.join(dir,'linked-artifact'));
    await assert.rejects(candidateInventory({
      root:dir,archivePath:path.join(dir,'linked-artifact'),checkoutSha:sha,prHeadSha:head,
      workflowRef:SOURCE_REPOSITORY+'/'+WORKFLOW_FILE+'@refs/heads/main'
    }),/INVALID_ARCHIVE_PATH/);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
