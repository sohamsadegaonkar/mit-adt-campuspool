'use strict';

// Source review inventory for a LOCAL, non-published OCI candidate.
// This is NOT a signed attestation or evidence that an image exists in GHCR.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const SOURCE_REPOSITORY='sohamsadegaonkar/mit-adt-campuspool';
const WORKFLOW_FILE='.github/workflows/cloud-backup-worker-ci.yml';
const ARCHIVE_NAME='campuspool-backup-worker-linux-amd64.oci.tar';
const REVIEW_FILES=Object.freeze([
  'ops/cloud-backup/Dockerfile',
  'ops/cloud-backup/package.json',
  'ops/cloud-backup/package-lock.json',
  'scripts/staging-backup-guard.js',
  'scripts/cloud-backup-runtime-security.js',
  'scripts/cloud-backup-vault-bootstrap.js',
  'scripts/age-ciphertext-guard.js',
  'scripts/cloud-backup-tls-probe.js',
  'scripts/cloud-backup-scope.js',
  'scripts/azure-blob-backup.js'
]);

function assertSha(sha,label){
  if(typeof sha!=='string'||!/^[0-9a-f]{40}$/.test(sha))
    throw Error(label+'_MUST_BE_FULL_COMMIT_SHA');
  return sha;
}
async function sha256File(filename){
  const st=fs.lstatSync(filename);
  if(!st.isFile()||st.isSymbolicLink()||st.size<=0)
    throw Error('SOURCE_INVENTORY_NON_REGULAR_FILE');
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(filename))hash.update(chunk);
  return hash.digest('hex');
}
async function candidateInventory({
  root,archivePath,checkoutSha,prHeadSha,workflowRef
}){
  assertSha(checkoutSha,'CHECKOUT');
  if(prHeadSha!==null&&prHeadSha!==undefined&&prHeadSha!=='')
    assertSha(prHeadSha,'PR_HEAD');
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('INVALID_ROOT');
  if(typeof archivePath!=='string'||!path.isAbsolute(archivePath)||
     path.basename(archivePath)!==ARCHIVE_NAME)
    throw Error('INVALID_ARCHIVE_PATH');
  const canonicalRoot=fs.realpathSync(root);
  const canonicalArchive=fs.realpathSync(archivePath);
  if(!canonicalArchive.startsWith(canonicalRoot+path.sep))
    throw Error('ARCHIVE_MUST_BE_IN_CHECKED_OUT_SOURCE');
  if(typeof workflowRef!=='string'||
     !workflowRef.startsWith(SOURCE_REPOSITORY+'/'+WORKFLOW_FILE+'@refs/'))
    throw Error('UNEXPECTED_BUILD_WORKFLOW');
  const fileDigests={};
  for(const file of REVIEW_FILES){
    const full=path.join(canonicalRoot,file);
    const resolved=fs.realpathSync(full);
    if(!resolved.startsWith(canonicalRoot+path.sep))
      throw Error('SOURCE_FILE_ESCAPED_CHECKOUT');
    fileDigests[file]=await sha256File(full);
  }
  return {
    schemaVersion:1,
    evidenceKind:'UNATTESTED_LOCAL_SOURCE_INVENTORY',
    sourceRepository:SOURCE_REPOSITORY,
    checkoutCommit:checkoutSha,
    prHeadCommit:prHeadSha||null,
    workflowRef,
    localOciTar:{name:ARCHIVE_NAME,sha256:await sha256File(archivePath)},
    sourceFilesSha256:fileDigests,
    ghcrImageManifestDigest:null,
    authenticatedBuildProvenanceVerified:false,
    publishedImageSignatureVerified:false,
    independentScanOfPublishedDigestVerified:false,
    deploymentAuthorized:false,
    releaseReady:false
  };
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!==ARCHIVE_NAME)
    throw Error('USAGE_LOCAL_ARCHIVE_ONLY');
  const root=process.cwd();
  const sha=execFileSync('git',['rev-parse','HEAD'],{
    cwd:root,encoding:'utf8',timeout:5000
  }).trim();
  assertSha(sha,'CHECKOUT');
  if(process.env.GITHUB_SHA&&process.env.GITHUB_SHA!==sha)
    throw Error('GITHUB_SHA_DOES_NOT_MATCH_CHECKOUT');
  const report=await candidateInventory({
    root,archivePath:path.join(root,ARCHIVE_NAME),
    checkoutSha:sha,
    prHeadSha:process.env.REVIEW_PR_HEAD_SHA||null,
    workflowRef:process.env.GITHUB_WORKFLOW_REF
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
if(require.main===module){
  main().catch(()=>{process.stderr.write('LOCAL_OCI_SOURCE_INVENTORY_BLOCKED\n');process.exitCode=1;});
}
module.exports={ARCHIVE_NAME,REVIEW_FILES,SOURCE_REPOSITORY,WORKFLOW_FILE,assertSha,sha256File,candidateInventory};
