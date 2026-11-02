'use strict';

// Verify staging never hydrates user or ride records from tracked legacy files.
// This uses a temporary SQLite file, not a live Supabase/Render database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const SqliteCampusDatabase=require('./database');

test('staging never imports legacy student identities or ride records',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-staging-isolation-'));
  const dbPath=path.join(dir,'test.db');
  const previous=process.env.APP_ENV;
  let db;
  try{
    process.env.APP_ENV='staging';
    db=new SqliteCampusDatabase(dbPath);
    assert.deepEqual(db.getProfiles(),[]);
    assert.deepEqual(db.getRides(),[]);
    const records=db.db.prepare('SELECT count(*) AS n FROM profiles').get();
    assert.equal(records.n,0);
    const rides=db.db.prepare('SELECT count(*) AS n FROM rides').get();
    assert.equal(rides.n,0);
  }finally{
    if(db?.db)db.db.close();
    if(previous===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=previous;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('staging TLS uses a specific Supabase CA without bypassing verification',()=>{
  const config=fs.readFileSync(path.join(__dirname,'render-staging.yaml'),'utf8');
  const pool=fs.readFileSync(path.join(__dirname,'stage1-otp','pg-store.js'),'utf8');
  assert.match(config,/key: OTP_DB_SSL\s*\n\s*value: ["']true["']/);
  assert.match(config,/key: NODE_EXTRA_CA_CERTS\s*\n\s*value: \/etc\/secrets\/campuspool-supabase-ca\.crt/);
  assert.match(pool,/rejectUnauthorized:\s*true/);
  assert.doesNotMatch(pool,/rejectUnauthorized:\s*false/);
  assert.doesNotMatch(config,/NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('staging docs never pin the known broken Node 22.12.0 runtime',()=>{
  const config=fs.readFileSync(path.join(__dirname,'render-staging.yaml'),'utf8');
  assert.match(config,/key: NODE_VERSION\s*\n\s*value: ["']22\.23\.2["']/);
  assert.doesNotMatch(config,/22\.12\.0/);
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
  assert.equal(pkg.engines.node,'>=22.14.0');
});
