'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {assess,EXPECTED_ISSUER,EXPECTED_IDENTITY}=require('./scripts/recovery-g1-evidence-preflight');

const VERIFIED='ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+
  '35e37da37bb4b7790b5582dc73b7c11aad24068d4040a0b6401034d656698a4c';
const AZURE='ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:'+
  '694e39c24b89c91dfea8419ed669a70a9a62cef18d99038a87e84225e5468ce8';
const HASH='a'.repeat(64);
function completeClaims(){
  return {
    provenance:{azureJobImage:VERIFIED,verifiedSignedImage:VERIFIED,
      azureImageSignature:'VERIFIED',signerIdentity:EXPECTED_IDENTITY,
      issuer:EXPECTED_ISSUER,jobTrigger:'Manual',signatureEvidenceRef:'signed-checkpoint-ref'},
    archive:{source:'staging',exportSucceeded:true,sha256:HASH,byteSize:16384,
      blobVersion:'ver-1',encryption:'age',pgDumpCustomVerified:true,
      noPlaintextLeakVerified:true,postgresMajor:17,exportEvidenceRef:'export-ref'},
    recovery:{retrievedOffsite:true,operatorIndependentOfExporter:true,
      retrievedSha256:HASH,ageDecrypted:true,pgRestoreSucceeded:true,
      destination:'isolated',postgresMajor:17,rowContentParityVerified:true,
      activeAndCancelledBookingsVerified:true,rolesGrantsRlsVerified:true,
      restoreEvidenceRef:'independent-recovery-ref'},
    migration:{authoritativeLedgerVerified:true,sourceManifestApproved:true,
      snapshotStage:14,rollbackRehearsedOnSeparateDb:true,
      applicationShaPairingVerified:true,noDestructiveDown:true},
    operations:{trafficFreezeOrWriteReconcileApproved:true,
      rpoRtoMeasuredAndAccepted:true,externalReviewerSignedOff:true,
      reviewEvidenceRef:'review-ref'}
  };
}
test('actual 21-Nov Azure job image and trusted signer digest mismatch block G1',()=>{
  const evidence=completeClaims();
  evidence.provenance.azureJobImage=AZURE;
  evidence.provenance.azureImageSignature='NOT_CONFIRMED';
  evidence.archive.exportSucceeded=false;
  evidence.recovery.retrievedOffsite=false;
  const r=assess(evidence);
  assert.equal(r.status,'BLOCKED_G1_EVIDENCE_INCOMPLETE');
  for(const code of ['DEPLOYED_IMAGE_DIFFERS_FROM_VERIFIED',
    'DEPLOYED_DIGEST_SIGNATURE_NOT_VERIFIED','REAL_STAGING_EXPORT_NOT_VERIFIED',
    'INDEPENDENT_OFFSITE_RETRIEVAL_MISSING'])assert.ok(r.failures.includes(code),code);
  assert.equal(r.releaseReady,false);
  assert.equal(r.independentRecoveryVerified,false);
});

test('even internally complete metadata is not independently authenticated or release ready',()=>{
  const r=assess(completeClaims());
  assert.equal(r.failures.length,0);
  assert.equal(r.status,'CLAIMS_COMPLETE_EXTERNAL_ATTESTATION_REQUIRED');
  assert.equal(r.externalProofChecked,false);
  assert.equal(r.independentRecoveryVerified,false);
  assert.equal(r.releaseReady,false);
  assert.ok(r.checksRequired>=20);
});

test('forged/mismatched ciphertext hash, restore/roles evidence and write-frozen rollback block',()=>{
  const f=completeClaims();
  f.recovery.retrievedSha256='b'.repeat(64);
  f.recovery.pgRestoreSucceeded=false;
  f.recovery.rolesGrantsRlsVerified=false;
  f.migration.authoritativeLedgerVerified=false;
  f.operations.rpoRtoMeasuredAndAccepted=false;
  const r=assess(f);
  for(const code of ['RETRIEVED_CIPHERTEXT_HASH_MISMATCH',
    'ISOLATED_AGE_DECRYPT_AND_PG_RESTORE_NOT_VERIFIED',
    'SECURITY_ROLE_RLS_PARITY_UNVERIFIED','MIGRATION_LEDGER_UNVERIFIED',
    'TRAFFIC_FREEZE_RPO_RTO_UNVERIFIED'])assert.ok(r.failures.includes(code),code);
});

test('untrusted image scope, weak/no blob hash, non-isolated target and missing approvals block',()=>{
  const f=completeClaims();
  f.provenance.azureJobImage='ghcr.io/another/repo@sha256:'+HASH;
  f.archive.sha256='short';
  f.archive.byteSize=128;
  f.recovery.destination='production';
  f.operations.externalReviewerSignedOff=false;
  const r=assess(f);
  for(const code of ['AZURE_CONFIGURED_IMAGE_INVALID','DEPLOYED_IMAGE_DIFFERS_FROM_VERIFIED',
    'ENCRYPTED_BLOB_INTEGRITY_MISSING','RETRIEVED_CIPHERTEXT_HASH_MISMATCH',
    'ISOLATED_AGE_DECRYPT_AND_PG_RESTORE_NOT_VERIFIED',
    'INDEPENDENT_REVIEW_UNVERIFIED'])assert.ok(r.failures.includes(code),code);
});

test('missing/null/unexpected evidence shapes fail closed and never echo sensitive input',()=>{
  for(const input of [null,{}, {provenance:null,archive:null,recovery:null,
    migration:null,operations:null},'unexpected', []]){
    const out=assess(input);
    assert.equal(out.releaseReady,false);
    assert.notEqual(out.failures.length,0);
  }
  const secret=completeClaims();
  secret.archive.exportEvidenceRef='PRIVATE_TOKEN_DO_NOT_ECHO';
  const out=assess(secret);
  assert.ok(!JSON.stringify(out).includes('PRIVATE_TOKEN_DO_NOT_ECHO'));
});

test('CLI is offline and returns nonzero even on fabricated complete evidence',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-g1-'));
  try{
    const script=path.join(__dirname,'scripts','recovery-g1-evidence-preflight.js');
    const evidencePath=path.join(temp,'evidence.json');
    fs.writeFileSync(evidencePath,JSON.stringify(completeClaims()),{mode:0o600});
    const p=spawnSync(process.execPath,[script,'--evidence',evidencePath],{encoding:'utf8'});
    assert.equal(p.status,1);
    assert.match(p.stdout,/CLAIMS_COMPLETE_EXTERNAL_ATTESTATION_REQUIRED/);
    assert.match(p.stdout,/"releaseReady":false/);
    assert.ok(!p.stdout.includes('signed-checkpoint-ref'));
    assert.ok(!p.stdout.includes('export-ref'));
    const noArgs=spawnSync(process.execPath,[script],{encoding:'utf8'});
    assert.equal(noArgs.status,2);
    const missing=spawnSync(process.execPath,[script,'--evidence',path.join(temp,'missing.json')],
      {encoding:'utf8'});
    assert.equal(missing.status,1);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
