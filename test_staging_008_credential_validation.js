'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {config,explainConfig,inspect,assess,validate,ADMIN_ACK,SQL}=require('./scripts/staging-008-credential-validation');
const {TABLES,APP_ROLE}=require('./scripts/staging-migration-preflight');
const project='tnitksrlntrdxbvznxzf';
const env={APP_ENV:'staging',STAGING_CREDENTIAL_VALIDATION_ACK:'STAGING_CREDENTIALS_READ_ONLY',
  STAGING_BACKUP_DATABASE_URL:'postgresql://'+APP_ROLE+'.'+project+':synthetic-only@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full',
  STAGING_BACKUP_CA_PEM_B64:'synthetic-only'};
const row={connected_role:APP_ROLE,database_ok:true,read_only:true,pg17:true,
  ledger_schema_access:true,ledger_read:true,app_tables:TABLES.length,
  tables_dump_readable:true,sequences_dump_readable:true,pre008:true};
test('reject wrong stage, branch-independent missing consent, unsafe TLS, non-session port, wrong project and unauthorized admin',()=>{
  assert.equal(config(env).role,APP_ROLE);
  for(const changed of [
    {...env,APP_ENV:'production'},
    {...env,STAGING_CREDENTIAL_VALIDATION_ACK:''},
    {...env,STAGING_BACKUP_DATABASE_URL:env.STAGING_BACKUP_DATABASE_URL.replace(project,'otherproject')},
    {...env,STAGING_BACKUP_DATABASE_URL:env.STAGING_BACKUP_DATABASE_URL.replace('verify-full','require')},
    {...env,STAGING_BACKUP_DATABASE_URL:env.STAGING_BACKUP_DATABASE_URL.replace(':5432',':6543')},
    {...env,STAGING_BACKUP_DATABASE_URL:'postgresql://'+APP_ROLE+':synthetic-only@db.'+project+'.supabase.co:15432/postgres?sslmode=verify-full'}
  ])assert.throws(()=>config(changed));
  const admin={...env,STAGING_BACKUP_DATABASE_URL:env.STAGING_BACKUP_DATABASE_URL.replace(APP_ROLE,'postgres')};
  assert.throws(()=>config(admin));
  assert.throws(()=>config({...admin,STAGING_008_BACKUP_ADMIN_ACK:ADMIN_ACK}));
  assert.throws(()=>config({...admin,STAGING_VALIDATE_ADMIN:'true'}));
  assert.equal(config({...admin,STAGING_VALIDATE_ADMIN:'true',STAGING_008_BACKUP_ADMIN_ACK:ADMIN_ACK}).role,'postgres');
});
test('catalog query is scoped metadata only, inside read-only transaction and always rolls back',async()=>{
  const calls=[];
  const client={query:async (q,p)=>{calls.push([q,p]);return {rows:[row]};}};
  assert.deepEqual(await inspect(client),row);
  assert.match(calls[0][0],/READ ONLY/);
  assert.equal(calls[2][0],SQL);
  assert.deepEqual(calls[2][1],[TABLES]);
  assert.equal(calls.at(-1)[0],'ROLLBACK');
  assert.doesNotMatch(SQL,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|COPY|CREATE)\b/i);
  assert.doesNotMatch(SQL,/FROM public\./i);
});
test('partial permissions and RLS-active tables fail export readiness independently',()=>{
  assert.ok(Object.values(assess(row,APP_ROLE)).every(Boolean));
  assert.equal(assess({...row,ledger_read:false},APP_ROLE).MIGRATION_LEDGER_ACCESS,false);
  assert.equal(assess({...row,tables_dump_readable:false},APP_ROLE).EXPORT_TABLE_READABILITY,false);
  assert.equal(assess({...row,sequences_dump_readable:false},APP_ROLE).EXPORT_SEQUENCE_READABILITY,false);
  assert.equal(assess({...row,connected_role:'postgres'},APP_ROLE).DATABASE_IDENTITY,false);
  assert.equal(assess({...row,pre008:false},APP_ROLE).PRE_008_APP_SCHEMA,false);
});
test('diagnostic never connects when validation fails; no raw error or credentials logged',async()=>{
  let created=0;const logs=[];
  class Forbidden {constructor(){created++;throw Error('do not connect');}}
  const r=await validate({...env,APP_ENV:'production'},{ClientImpl:Forbidden,emit:x=>logs.push(x),parseCa:()=>{throw Error('synthetic-only');}});
  assert.equal(r.ok,false);assert.equal(created,0);
  assert.ok(logs.every(l=>/^[A-Z0-9_]+=(PASS|FAIL)$/.test(l)));
});
test('connection is verified TLS, read-only catalog checks are redacted and client closes',async()=>{
  let options,closed=false,queries=0;
  class Mock{
    constructor(o){options=o;this.connection={stream:{encrypted:true,authorized:true}};}
    async connect(){}
    async query(q){queries++;return {rows:[row]};}
    async end(){closed=true;}
  }
  const logs=[];
  const r=await validate(env,{ClientImpl:Mock,emit:x=>logs.push(x),parseCa:()=> 'fake-ca'});
  assert.equal(r.ok,true);assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.ssl.ca,'fake-ca');
  assert.equal(queries,4);assert.equal(closed,true);
  assert.ok(logs.every(l=>/^[A-Z0-9_]+=(PASS|FAIL)$/.test(l)));
  assert.ok(logs.includes('TLS_VERIFY_FULL=PASS'));
  class Broken extends Mock{async connect(){throw Error(env.STAGING_BACKUP_DATABASE_URL);}}
  const failure=await validate(env,{ClientImpl:Broken,emit:x=>logs.push(x),parseCa:()=> 'fake-ca'});
  assert.equal(failure.ok,false);
  assert.ok(logs.every(l=>/^[A-Z0-9_]+=(PASS|FAIL)$/.test(l)));
});
test('non-authorized TLS cannot query',async()=>{
  class BadTLS {
    constructor(){this.connection={stream:{encrypted:true,authorized:false}};}
    async connect(){}
    async query(){assert.fail('query not allowed');}
    async end(){}
  }
  const r=await validate(env,{ClientImpl:BadTLS,emit:()=>{},parseCa:()=> 'fake-ca'});
  assert.equal(r.ok,false);assert.equal(r.results.TLS_VERIFY_FULL,false);
});
test('manual main-only protected workflow cannot export or migrate, and secrets remain step-local',()=>{
  const y=fs.readFileSync('.github/workflows/staging-008-credential-validation.yml','utf8');
  assert.match(y,/workflow_dispatch:/);
  assert.doesNotMatch(y,/^\s*(push|pull_request|schedule|pull_request_target):/m);
  assert.equal((y.match(/github\.ref == 'refs\/heads\/main'/g)||[]).length,3);
  assert.match(y,/environment: staging-008-backup/);
  assert.match(y,/environment: staging-008-restore/);
  assert.match(y,/npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(y,/pg_dump|pg_restore|apply_migration|trigger_deploy|supabase db push|ALTER ROLE/i);
  const secrets=y.split('\n').filter(l=>l.includes('secrets.'));
  assert.equal(secrets.length,4);
  assert.ok(secrets.every(l=>/^          STAGING_[A-Z0-9_]+: \$\{\{ secrets\.STAGING_[A-Z0-9_]+ \}\}$/.test(l)));
  assert.doesNotMatch(y.split('  restore-credentials:')[0],/secrets\.STAGING_008_AGE_IDENTITY/);
  assert.doesNotMatch(y.split('  restore-credentials:')[1],/secrets\.STAGING_BACKUP_/);
  assert.match(y,/head -c 64 \/dev\/urandom/);
  assert.match(y,/AGE_KEY_PAIR_MATCH=PASS/);
  assert.match(y,/REAL_DATABASE_EXPORT=NO/);
});

test('failed configuration has specific fixed diagnostics without secret disclosure or connection',async()=>{
  const admin={...env,STAGING_VALIDATE_ADMIN:'true',STAGING_BACKUP_DATABASE_URL:env.STAGING_BACKUP_DATABASE_URL.replace(APP_ROLE,'postgres')};
  assert.equal(explainConfig(admin).DIAG_ADMIN_ACK,false);
  assert.equal(explainConfig(admin).DIAG_SSL_MODE,true);
  const allowed={...admin,STAGING_008_BACKUP_ADMIN_ACK:ADMIN_ACK};
  assert.ok(Object.values(explainConfig(allowed)).every(Boolean));
  assert.equal(explainConfig({...allowed,STAGING_BACKUP_DATABASE_URL:allowed.STAGING_BACKUP_DATABASE_URL.replace('?sslmode=verify-full','')}).DIAG_SSL_MODE,false);
  assert.equal(explainConfig({...allowed,STAGING_BACKUP_DATABASE_URL:allowed.STAGING_BACKUP_DATABASE_URL+'&x=1'}).DIAG_QUERY_PARAMETER_COUNT,false);
  assert.equal(explainConfig({...allowed,STAGING_BACKUP_DATABASE_URL:allowed.STAGING_BACKUP_DATABASE_URL.replace(':5432',':6543')}).DIAG_PORT,false);
  assert.equal(explainConfig({...allowed,STAGING_BACKUP_DATABASE_URL:allowed.STAGING_BACKUP_DATABASE_URL.replace(project,'wrongproject')}).DIAG_STAGING_PROJECT,false);
  assert.equal(explainConfig({...allowed,STAGING_BACKUP_DATABASE_URL:'not-a-url-sensitive'}).DIAG_URL_PARSE,false);
  const logs=[];
  class Forbidden{constructor(){assert.fail('must not connect');}}
  const r=await validate(admin,{ClientImpl:Forbidden,emit:x=>logs.push(x),parseCa:()=> 'fake-ca'});
  assert.equal(r.ok,false);
  assert.ok(logs.includes('DIAG_ADMIN_ACK=FAIL'));
  assert.ok(logs.every(l=>/^[A-Z0-9_]+=(PASS|FAIL)$/.test(l)));
  assert.ok(!logs.join('\n').includes('synthetic-only'));
});
