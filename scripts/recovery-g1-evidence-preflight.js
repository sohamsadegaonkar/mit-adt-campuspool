'use strict';
// Offline classification of redacted G1 evidence claims; never proves a
// real off-site restore or authenticates external evidence by itself.
// NO cloud, database, network, migration, signing or restore operations.
const fs=require('node:fs');
const SHA=/^[a-f0-9]{64}$/i;
const GHCR=/^ghcr\.io\/sohamsadegaonkar\/campuspool-backup-worker@sha256:[a-f0-9]{64}$/i;
const EXPECTED_ISSUER='https://token.actions.githubusercontent.com';
const EXPECTED_IDENTITY=
 'https://github.com/sohamsadegaonkar/campuspool-backup-signer/.github/workflows/sign-existing-backup-worker.yml@refs/heads/main';
const APPROVED_STAGE_VERSIONS=new Set([7,8,9,10,11,12,13,14]);
function safeObject(x){return x&&typeof x==='object'&&!Array.isArray(x);}
function validSha(x){return typeof x==='string'&&SHA.test(x);}
function nonblank(x){return typeof x==='string'&&x.length>0&&x.trim()===x&&x.length<=256;}
function assess(evidence){
  const missing=[];
  let checksRequired=0;
  const block=(code,condition)=>{checksRequired++;if(!condition)missing.push(code);};
  if(!safeObject(evidence)){
    return {status:'BLOCKED_MISSING_EVIDENCE',failures:['EVIDENCE_NOT_OBJECT'],
      independentRecoveryVerified:false,releaseReady:false,externalProofChecked:false};
  }
  const provenance=safeObject(evidence.provenance)?evidence.provenance:{};
  const archive=safeObject(evidence.archive)?evidence.archive:{};
  const recovery=safeObject(evidence.recovery)?evidence.recovery:{};
  const migration=safeObject(evidence.migration)?evidence.migration:{};
  const operations=safeObject(evidence.operations)?evidence.operations:{};
  // Source and image provenance are independently trusted ONLY after reviewing
  // authenticated GitHub/Azure evidence outside this offline checker.
  block('AZURE_CONFIGURED_IMAGE_INVALID',GHCR.test(provenance.azureJobImage||''));
  block('KNOWN_SIGNED_IMAGE_INVALID',GHCR.test(provenance.verifiedSignedImage||''));
  block('DEPLOYED_IMAGE_DIFFERS_FROM_VERIFIED',GHCR.test(provenance.azureJobImage||'')&&
    provenance.azureJobImage===provenance.verifiedSignedImage);
  block('DEPLOYED_DIGEST_SIGNATURE_NOT_VERIFIED',provenance.azureImageSignature==='VERIFIED');
  block('EXPECTED_SIGNER_IDENTITY_MISSING',provenance.signerIdentity===EXPECTED_IDENTITY);
  block('EXPECTED_OIDC_ISSUER_MISSING',provenance.issuer===EXPECTED_ISSUER);
  block('MANUAL_JOB_NOT_CONFIRMED',provenance.jobTrigger==='Manual');
  block('SIGNATURE_EVIDENCE_REFERENCE_MISSING',nonblank(provenance.signatureEvidenceRef));

  block('REAL_STAGING_EXPORT_NOT_VERIFIED',archive.source==='staging'&&archive.exportSucceeded===true);
  block('ENCRYPTED_BLOB_INTEGRITY_MISSING',validSha(archive.sha256)&&
    Number.isSafeInteger(archive.byteSize)&&archive.byteSize>1024&&nonblank(archive.blobVersion));
  block('ARCHIVE_FORMAT_UNVERIFIED',archive.encryption==='age'&&archive.pgDumpCustomVerified===true);
  block('ARCHIVE_PLAINTEXT_CONTAINMENT_UNVERIFIED',archive.noPlaintextLeakVerified===true);
  block('ARCHIVE_EXPORT_EVIDENCE_MISSING',nonblank(archive.exportEvidenceRef));

  block('INDEPENDENT_OFFSITE_RETRIEVAL_MISSING',recovery.retrievedOffsite===true&&
    recovery.operatorIndependentOfExporter===true);
  block('RETRIEVED_CIPHERTEXT_HASH_MISMATCH',validSha(archive.sha256)&&
    recovery.retrievedSha256===archive.sha256);
  block('ISOLATED_AGE_DECRYPT_AND_PG_RESTORE_NOT_VERIFIED',recovery.ageDecrypted===true&&
    recovery.pgRestoreSucceeded===true&&recovery.destination==='isolated');
  block('RESTORE_SOURCE_MAJOR_UNMATCHED',Number.isInteger(recovery.postgresMajor)&&
    Number.isInteger(archive.postgresMajor)&&archive.postgresMajor===recovery.postgresMajor&&
    recovery.postgresMajor>=16);
  block('ROW_CONTENT_PARITY_UNVERIFIED',recovery.rowContentParityVerified===true&&
    recovery.activeAndCancelledBookingsVerified===true);
  block('SECURITY_ROLE_RLS_PARITY_UNVERIFIED',recovery.rolesGrantsRlsVerified===true);
  block('RESTORE_EVIDENCE_MISSING',nonblank(recovery.restoreEvidenceRef));

  block('MIGRATION_LEDGER_UNVERIFIED',migration.authoritativeLedgerVerified===true&&
    migration.sourceManifestApproved===true&&
    APPROVED_STAGE_VERSIONS.has(migration.snapshotStage));
  block('007_TO_014_COMPATIBILITY_UNVERIFIED',migration.rollbackRehearsedOnSeparateDb===true&&
    migration.applicationShaPairingVerified===true&&migration.noDestructiveDown===true);
  block('TRAFFIC_FREEZE_RPO_RTO_UNVERIFIED',operations.trafficFreezeOrWriteReconcileApproved===true&&
    operations.rpoRtoMeasuredAndAccepted===true);
  block('INDEPENDENT_REVIEW_UNVERIFIED',operations.externalReviewerSignedOff===true&&
    nonblank(operations.reviewEvidenceRef));

  const unique=[...new Set(missing)];
  return {status:unique.length?'BLOCKED_G1_EVIDENCE_INCOMPLETE':'CLAIMS_COMPLETE_EXTERNAL_ATTESTATION_REQUIRED',
    failures:unique,checksRequired,
    independentRecoveryVerified:false,releaseReady:false,externalProofChecked:false,
    note:'This tool checks internally consistent, operator-supplied metadata ONLY; it never authenticates the cited evidence, accesses Azure or PostgreSQL, or grants a release.'};
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==2||argv[0]!=='--evidence') {
    process.stderr.write('G1_EVIDENCE_PREFLIGHT_USAGE: --evidence <redacted-json-file>\n');
    return 2;
  }
  try{
    const file=argv[1],stat=fs.statSync(file);
    if(!stat.isFile()||stat.size>64*1024)throw Error('BAD_FILE');
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    const out=assess(data);
    process.stdout.write('G1_EVIDENCE_PREFLIGHT '+JSON.stringify(out)+'\n');
    // Never return success as if operator-supplied claims were verified G1.
    return 1;
  }catch(_){
    process.stderr.write('G1_EVIDENCE_PREFLIGHT_BLOCKED_REDACTED\n');
    return 1;
  }
}
if(require.main===module)process.exitCode=main();
module.exports={assess,main,EXPECTED_IDENTITY,EXPECTED_ISSUER};
