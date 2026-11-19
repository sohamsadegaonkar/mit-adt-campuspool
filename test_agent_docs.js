'use strict';
// Exercise the actual checker in temporary, isolated Git histories. No network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const root=__dirname;
const docs=['AGENTS.md','docs/agents/README.md','docs/agents/MINIMUM_COMPLEXITY.md',
  'docs/agents/STATUS.md','docs/agents/NEXT_STEPS.md','docs/agents/ARCHITECTURE_MAP.md',
  'docs/agents/DECISIONS.md','docs/agents/tasks/TEMPLATE.md'];
const task='docs/agents/tasks/2026-11-20-gate-fixture.md';
const headings=['Goal and acceptance criteria','Current state','Plan','Progress log','Verification','Next steps'];
const small='## Minimum complexity review\n\n- **Level:** small\n- **Existing / smallest:** Reuse existing guard.\n- **Decision:** One validation check at current boundary.\n- **Validation:** Run affected regression.\n';
const full=small.replace('Level:** small','Level:** significant')+
  '- **Conventional alternative:** Add separate validator.\n- **First-principles alternative:** Reuse boundary invariant.\n- **Tradeoffs:** Avoid dependency; preserve rollback.\n- **Evidence:** Source baseline inspected; timings not measured.\n';
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campuspool-agent-docs-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(file,content)=>{const p=path.join(dir,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);};
  const append=(file,value)=>fs.appendFileSync(path.join(dir,file),value);
  git('init','-q');git('config','user.email','ci@example.invalid');git('config','user.name','CI fixture');
  for(const file of docs)put(file,fs.readFileSync(path.join(root,file),'utf8'));
  put('app.js','const old = true;\n');
  git('add','.');git('commit','-qm','base');
  const base=git('rev-parse','HEAD');
  function record(review){
    append('docs/agents/STATUS.md','\nFixture status.\n');
    append('docs/agents/NEXT_STEPS.md','\nFixture next.\n');
    put(task,headings.map(h=>'## '+h+'\nFixture content.').join('\n\n')+'\n\n'+review);
  }
  function commit(){git('add','-A');git('commit','-qm','head');return git('rev-parse','HEAD');}
  function run(b,h){
    const env={...process.env};delete env.PR_BASE_SHA;delete env.PR_HEAD_SHA;
    if(b)env.PR_BASE_SHA=b;if(h)env.PR_HEAD_SHA=h;
    const r=spawnSync(process.execPath,[path.join(root,'scripts/check-agent-docs.js')],{cwd:dir,env,encoding:'utf8'});
    assert.ifError(r.error);return {status:r.status,out:r.stdout+r.stderr};
  }
  return {dir,git,put,append,base,record,commit,run};
}
test('baseline and documentation-only changes pass',t=>{
  const f=fixture(t);assert.equal(f.run().status,0);
  f.append('docs/agents/README.md','\nDoc-only.\n');
  assert.equal(f.run(f.base,f.commit()).status,0);
});
test('implementation without task or review fails',t=>{
  const f=fixture(t);f.put('app.js','const changed = true;\n');
  let r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/unique/);
  f.record('');r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/Missing ## Minimum complexity review/);
});
test('small valid record passes',t=>{
  const f=fixture(t);f.put('app.js','const changed = true;\n');f.record(small);
  assert.equal(f.run(f.base,f.commit()).status,0);
});
test('blank, duplicate and placeholder fields fail',t=>{
  const f=fixture(t);f.put('app.js','const changed = true;\n');
  f.record(small.replace('One validation check at current boundary.','TODO').replace('Run affected regression.',''));
  let r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/Decision/);assert.match(r.out,/Validation/);
  f.record(small+'- **Decision:** Duplicated.\n');r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/Decision/);
});
test('significant paths cannot use small review; full review passes',t=>{
  const f=fixture(t);f.put('package.json','{}\n');f.record(small);
  let r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/requires significant/);
  f.record(full);r=f.run(f.base,f.commit());assert.equal(r.status,0,r.out);
});
test('voluntary significant review must include all fields',t=>{
  const f=fixture(t);f.put('app.js','const changed = true;\n');
  f.record(full.replace(/- \*\*Evidence:\*\*[^\n]*\n/,''));
  const r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/Evidence/);
});
test('deletion-only implementation still requires review',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.dir,'app.js'));
  let r=f.run(f.base,f.commit());assert.notEqual(r.status,0);assert.match(r.out,/unique/);
  f.record(small);r=f.run(f.base,f.commit());assert.equal(r.status,0,r.out);
});
test('divergent base change is not incorrectly charged to PR',t=>{
  const f=fixture(t);
  f.git('checkout','-qb','feature');f.put('app.js','const changed = true;\n');f.record(small);const head=f.commit();
  f.git('checkout','-qb','new-base',f.base);f.put('package.json','{}\n');const base=f.commit();
  f.git('checkout','-q','feature');const r=f.run(base,head);assert.equal(r.status,0,r.out);
});
test('missing SHA pair fails closed',t=>{
  const f=fixture(t);const r=f.run(f.base);assert.notEqual(r.status,0);assert.match(r.out,/provided together/);
});
