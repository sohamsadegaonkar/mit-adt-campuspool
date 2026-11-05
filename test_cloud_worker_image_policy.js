'use strict';
// Static deployment policy for a manual-only, non-root, no-secrets backup image.
// This test never accesses Azure, PostgreSQL, Docker registries or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const docker = fs.readFileSync(path.join(__dirname, 'ops/cloud-backup/Dockerfile'), 'utf8');
const deps = JSON.parse(fs.readFileSync(path.join(__dirname, 'ops/cloud-backup/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'ops/cloud-backup/package-lock.json'), 'utf8'));

test('all base images reference immutable 64-character SHA256 digests', () => {
  const images = [...docker.matchAll(/^FROM\s+([^\s]+)(?:\s+AS\s+\w+)?\s*$/gmi)].map(m => m[1]);
  assert.equal(images.length, 2, 'expect exactly two reviewed base images');
  for (const image of images) {
    assert.match(image, /^\S+@sha256:[a-f0-9]{64}$/i);
  }
  assert.match(images[0], /^node:22-alpine3\.23@/);
  assert.equal(images[1], images[0], 'runtime must be same pinned Node slim base, not full PostgreSQL server');
});

test('worker defaults to non-root, preflight-only and copies allowlisted files', () => {
  assert.match(docker, /^USER\s+65532:65532\s*$/m);
  assert.match(docker, /^ENTRYPOINT\s+\["node","scripts\/azure-blob-backup\.js"\]\s*$/m);
  assert.match(docker, /^CMD\s+\["--preflight"\]\s*$/m);
  assert.match(docker, /^\s*AZURE_AUTH_MODE=managed-identity\s*\\/m);
  assert.match(docker, /^\s*CAMPUSPOOL_CLOUD_WORKER=YES\s*$/m);
  for (const line of docker.split('\n')) {
    if (!/^COPY\s+/i.test(line)) continue;
    assert.doesNotMatch(line, /(?:^|\s)(?:\.|\.\.\/|\/)(?:\s|$)/, 'no broad/unrestricted COPY');
  }
  assert.doesNotMatch(docker, /^(?:ARG|ENV)\s+(?:PGPASSWORD|AGE_IDENTITY|AZURE_STORAGE_KEY)\s*=/mi);
  assert.match(docker, /^COPY scripts\/cloud-backup-runtime-security\.js \.\/scripts\/cloud-backup-runtime-security\.js$/m);
  assert.match(docker, /^COPY scripts\/cloud-backup-vault-bootstrap\.js \.\/scripts\/cloud-backup-vault-bootstrap\.js$/m);
  assert.match(docker, /^COPY scripts\/age-ciphertext-guard\.js \.\/scripts\/age-ciphertext-guard\.js$/m);
  assert.match(docker, /^COPY scripts\/cloud-backup-tls-probe\.js \.\/scripts\/cloud-backup-tls-probe\.js$/m);
});

test('runtime uses pinned Alpine client-only packages without Debian, curl or server', () => {
  assert.match(docker, /apk add --no-cache ca-certificates=20261020-r0 postgresql17-client=17\.11-r0 age=1\.2\.1-r15;/);
  assert.match(docker, /pg_dump --version \| grep -F 'pg_dump \(PostgreSQL\) 17\.'/);
  assert.match(docker, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
  assert.match(docker, /rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
  assert.doesNotMatch(docker, /(?:apt-get|postgresql-17|curl|Signed-By:)/);
});

test('Azure dependency graph is locked and Docker uses reproducible npm ci', () => {
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].dependencies, deps.dependencies);
  assert.match(docker, /^COPY ops\/cloud-backup\/package\.json ops\/cloud-backup\/package-lock\.json \.\/$/m);
  assert.match(docker, /^RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund$/m);
  assert.doesNotMatch(docker, /^RUN npm install\b/m);
});

test('Azure dependencies are exact and the image cannot launch an automatic export', () => {
  assert.equal(deps.private, true);
  for (const name of ['@azure/identity', '@azure/storage-blob']) {
    assert.match(deps.dependencies[name], /^\d+\.\d+\.\d+$/);
  }
  assert.doesNotMatch(docker, /^CMD\s+\["--execute"\]/m);
});
