'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,smoke,parse,main}=require('./scripts/deployment-smoke');
const SHA='202330a8166674d86a428e1f90ab8ed857d1313d';
const base={target:'production',url:'https://mit-adt-campuspool.onrender.com',
  expectedSha:SHA,deployedSha:SHA};
const ok=(status,text)=>({status,async json(){return JSON.parse(text||'{}');},async text(){return text||'';}});

test('only exact approved Render origins or HTTP loopback are accepted',()=>{
  assert.equal(validate(base).ok,true);
  assert.equal(validate({...base,target:'staging',url:'https://mit-adt-campuspool-staging.onrender.com'}).ok,true);
  assert.equal(validate({...base,target:'local',url:'http://127.0.0.1:18080'}).ok,true);
  for(const url of ['https://evil.example','http://mit-adt-campuspool.onrender.com',
    'https://mit-adt-campuspool.onrender.com/?secret=1',
    'https://user:password@mit-adt-campuspool.onrender.com',
    'https://mit-adt-campuspool.onrender.com/other','https://mit-adt-campuspool.onrender.com.evil.test']){
    assert.equal(validate({...base,url}).ok,false,url);
  }
  assert.equal(validate({...base,target:'local',url:'http://192.168.1.1:18080'}).ok,false);
});

test('missing or mismatched commit blocks before any network request',async()=>{
  let count=0;
  const fetchImpl=async()=>{count++;throw Error('unexpected network');};
  for(const opts of [{...base,deployedSha:'f'.repeat(40)},{...base,deployedSha:''},
    {...base,url:'https://evil.example'}]){
    const r=await smoke({...opts,fetchImpl});
    assert.equal(r.verdict,'BLOCKED_PREFLIGHT');
  }
  assert.equal(count,0);
});

test('production smoke is 3 read-only GETs, without sensitive bodies or headers',async()=>{
  const seen=[];
  const fetchImpl=async(url,opts)=>{
    seen.push({url,opts});
    if(url.endsWith('/healthz'))return ok(200,'{"status":"healthy"}');
    if(url.endsWith('/api/auth/me'))return ok(401,'{"error":"UNAUTHORIZED"}');
    return ok(200,'<h1>CampusPool</h1>');
  };
  const result=await smoke({...base,fetchImpl});
  assert.equal(result.verdict,'PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL');
  assert.equal(result.requestsMade,3);
  assert.equal(result.shaEvidence,'OPERATOR_SUPPLIED_NOT_ATTESTED_BY_SCRIPT');
  assert.deepEqual(seen.map(x=>new URL(x.url).pathname),['/healthz','/','/api/auth/me']);
  for(const {opts} of seen){
    assert.equal(opts.method,'GET');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.redirect,'manual');
    assert.deepEqual(Object.keys(opts.headers),['Accept']);
  }
  assert.ok(!JSON.stringify(result).includes('UNAUTHORIZED'));
  assert.ok(result.releaseGatesStillRequired.includes('REAL_EMAIL_AND_SMS_DELIVERY'));
});

test('staging demands a protected homepage (401), not public home',async()=>{
  const cfg={...base,target:'staging',url:'https://mit-adt-campuspool-staging.onrender.com'};
  const responses={'/healthz':ok(200,'{"status":"healthy"}'),'/':ok(401,''),'/api/auth/me':ok(401,'')};
  const fetchImpl=async url=>responses[new URL(url).pathname];
  const good=await smoke({...cfg,fetchImpl});
  assert.equal(good.verdict,'PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL');
  responses['/']=ok(200,'CampusPool');
  const leak=await smoke({...cfg,fetchImpl});
  assert.equal(leak.verdict,'BLOCKED_SMOKE_FAILURE');
  assert.ok(leak.failures.includes('/'));
});

test('unhealthy status, false 200 status, unsafe redirect and timeout cannot pass',async()=>{
  for(const health of [ok(200,'{"status":"degraded"}'),ok(500,'{}'),ok(302,''),
    {status:200,async json(){throw Error('invalid json');}}]){
    const result=await smoke({...base,fetchImpl:async url=>
      url.endsWith('/healthz')?health:url.endsWith('/api/auth/me')?ok(401,''):ok(200,'CampusPool')});
    assert.equal(result.verdict,'BLOCKED_SMOKE_FAILURE');
    assert.ok(result.failures.includes('/healthz'));
  }
});

test('local QA reports only readiness and does not misstate production approval',async()=>{
  const local={...base,target:'local',url:'http://localhost:18080'};
  const result=await smoke({...local,fetchImpl:async url=>
    url.endsWith('/healthz')?ok(200,'{"status":"healthy"}'):
      url.endsWith('/api/auth/me')?ok(401,''):ok(200,'CampusPool')});
  assert.equal(result.verdict,'PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL');
  assert.equal(result.target,'local');
});

test('CLI arguments reject accidental extra commands and secrets in flags',async()=>{
  assert.deepEqual(parse(['--help']),{help:true});
  assert.throws(()=>parse(['--target','production','--url','https://foo','--token','secret']));
  const lines=[];
  const code=await main(['--target','production'],line=>lines.push(line));
  assert.equal(code,1);
  assert.ok(lines.join('').includes('BLOCKED_PREFLIGHT'));
  assert.ok(!lines.join('').includes('process.env'));
});
