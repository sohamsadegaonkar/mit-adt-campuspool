'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const normalize = value => value.replace(/\\/g, '/');

test('No local credential or runtime data files are tracked', () => {
  const denied = tracked.filter(filename => {
    const f = normalize(filename);
    return /(^|\/)\.env(?:\.[^/]+)?$/i.test(f) && !f.endsWith('.env.example') ||
      /(^|\/)(?:-|campuspool_database\.json|[^/]+\.(?:db|db-shm|db-wal|sqlite|sqlite3|pem|key|p12|pfx|pgdump|dump|backup|age|tar|zip))$/i.test(f);
  });
  assert.deepEqual(denied, [], 'Tracked secrets/runtime data found (file paths only)');
});

test('Render Blueprint uses HTTPS email sender/API key as private inputs', () => {
  const yaml = fs.readFileSync('render.yaml', 'utf8');
  for (const key of ['RESEND_API_KEY', 'EMAIL_FROM']) {
    const pattern = new RegExp('- key:\\s*' + key + '\\s*\\n([\\s\\S]*?)(?=\\n\\s*- key:|$)');
    const section = yaml.match(pattern);
    assert.ok(section, key + ' missing from Blueprint');
    assert.match(section[1], /sync:\s*false/, key + ' needs a private Render value');
    assert.doesNotMatch(section[1], /(?:^|\n)\s*value:/, key + ' still includes a literal value');
  }
  assert.match(yaml, /- key:\s*OTP_SECRET\s*\n\s*generateValue:\s*true/);
  assert.match(yaml, /- key:\s*EMAIL_PROVIDER\s*\n\s*value:\s*resend/);
  assert.doesNotMatch(yaml, /- key:\s*SMTP_PASS/);
});

test('Vercel configuration has no plaintext SMTP account or password', () => {
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  for (const name of ['SMTP_PASS', 'SMTP_USER', 'SMTP_FROM']) {
    assert.equal(Object.hasOwn(vercel.env || {}, name), false, 'Remove ' + name + ' from vercel.json');
  }
});

test('Known hardcoded OTP secret fallback is not present', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.match(source, /OTP_SECRET must be configured as a strong private environment variable/);
  assert.doesNotMatch(source, /const OTP_SECRET\s*=\s*[^;\n]*\|\|\s*['"][A-Za-z0-9_]{20,}['"]/);
});

test('Git and Docker ignore rules exclude secret and local data files', () => {
  for (const filename of ['.env.production', 'campuspool.db', 'campuspool_database.json']) {
    const ignored = execFileSync('git', ['check-ignore', '--no-index', filename], { encoding: 'utf8' }).trim();
    assert.equal(ignored, filename);
  }
  const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\*\.db$/m);
  assert.match(dockerignore, /^campuspool_database\.json$/m);
  assert.match(dockerignore, /^-$/m);
  assert.match(dockerignore, /^\*\*\/-$/m);
  for (const suffix of ['pgdump', 'dump', 'backup', 'age', 'tar', 'zip']) {
    assert.ok(dockerignore.split('\n').includes('*.' + suffix), 'Docker must exclude local ' + suffix + ' archives');
  }
});
