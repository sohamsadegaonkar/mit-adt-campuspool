'use strict';
// Fail-closed evidence contract: this staging dump covers only the named
// application schemas. It is NOT a full Supabase cluster or recovery proof.
// Never widen scope to managed auth/storage data without independent review.
const SCOPED_PGDUMP_ARGS=Object.freeze([
  '--format=custom','--schema=public','--schema=supabase_migrations','--no-password'
]);
const BACKUP_COVERAGE=Object.freeze({
  format:'PGDMP',
  scope:'SCOPED_APPLICATION_SCHEMAS_ONLY',
  schemas:Object.freeze(['public','supabase_migrations']),
  globalRolesIncluded:false,
  tablespacesIncluded:false,
  largeObjectsIncluded:false,
  crossSchemaDependenciesVerified:false,
  externalRoleReconstructionRequired:true,
  independentArchiveRestoreVerified:false,
  releaseReady:false
});
function dumpArguments(){
  return [...SCOPED_PGDUMP_ARGS];
}
function scopeEvidence(){
  return {...BACKUP_COVERAGE,schemas:[...BACKUP_COVERAGE.schemas]};
}
module.exports={SCOPED_PGDUMP_ARGS,BACKUP_COVERAGE,dumpArguments,scopeEvidence};
