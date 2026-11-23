'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SCOPED_PGDUMP_ARGS,BACKUP_COVERAGE,dumpArguments,scopeEvidence}=
  require('./scripts/cloud-backup-scope');

test('backup selector remains an exact scoped PGDMP application archive',()=>{
  assert.deepEqual(dumpArguments(),[
    '--format=custom','--schema=public','--schema=supabase_migrations','--no-password'
  ]);
  assert.ok(Object.isFrozen(SCOPED_PGDUMP_ARGS));
  assert.ok(Object.isFrozen(BACKUP_COVERAGE));
  assert.deepEqual(scopeEvidence().schemas,['public','supabase_migrations']);
  assert.equal(scopeEvidence().scope,'SCOPED_APPLICATION_SCHEMAS_ONLY');
  assert.equal(scopeEvidence().largeObjectsIncluded,false);
  assert.equal(scopeEvidence().crossSchemaDependenciesVerified,false);
  assert.equal(scopeEvidence().globalRolesIncluded,false);
  assert.equal(scopeEvidence().externalRoleReconstructionRequired,true);
  assert.equal(scopeEvidence().independentArchiveRestoreVerified,false);
  assert.equal(scopeEvidence().releaseReady,false);
  const changed=dumpArguments();changed.push('--schema=auth');
  assert.deepEqual(dumpArguments(),[
    '--format=custom','--schema=public','--schema=supabase_migrations','--no-password'
  ]);
});

test('worker consumes the single scope declaration without silent broadening',()=>{
  const worker=fs.readFileSync(path.join(__dirname,'scripts/azure-blob-backup.js'),'utf8');
  const docker=fs.readFileSync(path.join(__dirname,'ops/cloud-backup/Dockerfile'),'utf8');
  assert.match(worker,/spawnChild\('pg_dump',dumpArguments\(\),/);
  assert.doesNotMatch(worker,/spawnChild\('pg_dump',\[/);
  assert.match(worker,/v\.backupCoverage=scopeEvidence\(\)/);
  assert.match(worker,/backupCoverage:scopeEvidence\(\)/);
  assert.match(docker,/^COPY scripts\/cloud-backup-scope\.js \.\/scripts\/cloud-backup-scope\.js$/m);
  assert.doesNotMatch(docker,/COPY\s+\./);
});
