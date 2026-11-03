'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {STAGING_REF}=require('./scripts/staging-backup-guard');
const {validatePlan,connectionConfig,snapshot,compare}=require('./scripts/staging-restore-compare');
const OTHER='bbbbbbbbbbbbbbbbbbbb';
const url=ref=>'postgresql://postgres.'+ref+':TEST_ONLY@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
const config={APP_ENV:'staging',RESTORE_TARGET_CONFIRMED:'YES',RESTORE_PROJECT_REF:OTHER,STAGING_DB_URL:url(STAGING_REF),RESTORE_DB_URL:url(OTHER)};

test('guard requires exact separate Supabase project, signed-off target and TLS',()=>{
  const ok=validatePlan(config);
  assert.equal(ok.readOnly,true);assert.equal(ok.releaseReady,false);
  for(const env of [
    {...config,APP_ENV:'production'},
    {...config,RESTORE_TARGET_CONFIRMED:''},
    {...config,RESTORE_PROJECT_REF:STAGING_REF},
    {...config,RESTORE_DB_URL:url(STAGING_REF)},
    {...config,RESTORE_DB_URL:url(OTHER).replace('sslmode=require','sslmode=disable')},
    {...config,STAGING_DB_URL:url(STAGING_REF).replace('?sslmode=require','')},
    {...config,RESTORE_DB_URL:'postgresql://postgres:TEST_ONLY@localhost/postgres?sslmode=require'}
  ])assert.throws(()=>validatePlan(env));
  assert.equal(connectionConfig(url(OTHER)).ssl.rejectUnauthorized,true);
  assert.ok(!Object.prototype.hasOwnProperty.call(validatePlan(config),'STAGING_DB_URL'));
});

test('comparison detects metadata, RLS grants and row-count divergence without approving release',()=>{
  const a={tables:[{name:'campus_users',rls:true}],policies:[{name:'p'}],grants:[{can_select:false}],counts:[{name:'campus_users',count:'0'}],migrationHistoryPresent:true,migrationVersions:['001']};
  assert.equal(compare(a,structuredClone(a)).matches,true);
  const b=structuredClone(a);b.tables[0].rls=false;b.counts[0].count='1';
  const out=compare(a,b);
  assert.deepEqual(out.mismatches,['tables','counts']);
  assert.equal(out.releaseReady,false);
  assert.doesNotMatch(JSON.stringify(out),/TEST_ONLY/);
});

test('snapshot uses read-only transaction, compares all campus tables and rolls back failures',async()=>{
  const names=['campus_users','campus_sessions','campus_rides','campus_bookings','campus_trip_intents'];
  const seen=[];
  const db={query:async sql=>{
    seen.push(sql);
    if(sql.includes(' AS kind,'))return {rows:names.map(name=>({name,rls:true}))};
    if(sql.includes('AS name,rolcanlogin'))return {rows:[{name:'campuspool_staging_app'}]};
    if(sql.startsWith('SELECT count(*)'))return {rows:[{count:'0'}]};
    if(sql.startsWith('SELECT to_regclass'))return {rows:[{present:false}]};
    return {rows:[]};
  }};
  const out=await snapshot(db);
  assert.equal(out.counts.length,5);
  assert.match(seen[0],/READ ONLY/);assert.equal(seen.at(-1),'COMMIT');
  assert.ok(seen.every(s=>!/^INSERT|^UPDATE|^DELETE|^ALTER|^DROP/i.test(s)));
  const broken={query:async sql=>{seen.push(sql);if(sql.startsWith('SELECT'))throw Error('fail');return {rows:[]};}};
  await assert.rejects(snapshot(broken),/fail/);
  assert.equal(seen.at(-1),'ROLLBACK');
});

test('CLI does not print credentials or connect during preflight',()=>{
  const pre=spawnSync(process.execPath,['scripts/staging-restore-compare.js','--preflight'],{cwd:__dirname,encoding:'utf8',env:{...process.env,...config}});
  assert.equal(pre.status,0,pre.stderr);
  assert.match(pre.stdout,/comparisonPerformed/);
  const invalid=spawnSync(process.execPath,['scripts/staging-restore-compare.js','--compare'],{cwd:__dirname,encoding:'utf8',env:{...process.env,...config,RESTORE_DB_URL:'postgresql://bad:LEAK_ME@localhost/postgres?sslmode=require'}});
  assert.notEqual(invalid.status,0);
  assert.doesNotMatch(invalid.stdout+invalid.stderr,/LEAK_ME|localhost/);
});

test('disposable PostGIS runs real read-only recovery catalog SQL',
  {skip:!process.env.OTP_DATABASE_URL?'requires isolated local PostgreSQL CI':false},
  async()=>{
    const url=new URL(process.env.OTP_DATABASE_URL);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),
      'This integration test must NEVER connect to Supabase or production');
    const {Client}=require('pg');
    const client=new Client({connectionString:process.env.OTP_DATABASE_URL,ssl:false});
    try{
      await client.connect();
      const data=await snapshot(client);
      assert.ok(data.tables.some(t=>t.name==='campus_rides'));
      assert.equal(compare(data,structuredClone(data)).matches,true);
    }finally{await client.end().catch(()=>{});}
  });
