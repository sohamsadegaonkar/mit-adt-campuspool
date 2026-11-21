'use strict';
// Dependency-injected operator state machine. No Azure adapter in this module.
// Do not wire to live Azure before scope, exact identities/RBAC, budget and separately authorized approvals are revalidated.
function makeOperator(compare,historyGuard){
 const ctx={api:"2026-01-01",job:"campuspool-staging-backup-job"};
 const prior=[{name:"campuspool-staging-backup-job-ziik3b8",status:"Succeeded"}];
 const terminal=["Succeeded","Failed","Stopped"];
 function fail(code){throw Error(code)}
 const clone=x=>JSON.parse(JSON.stringify(x));
 const writable=s=>{const template=clone(s.template);delete template.containers[0].resources.ephemeralStorage;return {properties:{template}}};
 function candidate(b){const t=clone(b);t.template.containers[0].args=["--check-tls"];t.template.containers[0].env.push({name:"AZURE_TLS_CHECK_APPROVED",value:"YES"});return t}
 function build(b){if(compare(b,b,ctx).state!=="VERIFIED"||JSON.stringify(b.template.containers[0].args)!=='["--preflight"]')fail("INVALID_BASELINE");const t=candidate(b);if(compare(t,t,ctx).state!=="VERIFIED")fail("INVALID_CANDIDATE");return {base:b,tls:t,apply:writable(t),rollback:writable(b)}}
 function run(io,baseline,{maxPoll=18,maxRunPoll=180}={}){
  const p=build(baseline);let phase="BEFORE_PATCH";
  const verify=(s)=>{if(compare(s,io.snapshot(),ctx).state!=="VERIFIED")fail("LIVE_GUARD_BLOCK")};
  const hist=(expected=prior)=>{if(!historyGuard(io.history(),expected))fail("HISTORY_GUARD_BLOCK")};
  function poll(target,source){for(let i=0;i<maxPoll;i++){const now=io.snapshot();const v=compare(target,now,ctx);if(v.state==="VERIFIED")return;if(v.state!=="PENDING"&&!["VERIFIED","PENDING"].includes(compare(source,now,ctx).state))fail("UNEXPECTED_READBACK_DRIFT");io.log("READBACK_PENDING");io.wait()}fail("READBACK_TIMEOUT")}
  function patch(body,target,source){io.patch(body);poll(target,source)}
  function restore(expected){phase="RESTORE_PENDING";verify(p.tls);hist(expected);patch(p.rollback,p.base,p.tls);verify(p.base);hist(expected);phase="RESTORED";io.log("PREFLIGHT_CONFIGURATION_RESTORED=YES")}
  try{
   verify(p.base);hist();
   if(!io.approve("APPLY_TLS_ONLY_AND_RESTORE"))return {state:"DECLINED",phase};
   verify(p.base);hist();phase="PATCH_PENDING";patch(p.apply,p.tls,p.base);verify(p.tls);hist();phase="TLS_CONFIGURED";
   if(!io.approve("START_ONE_TLS_ONLY")){restore(prior);return {state:"DECLINED_RESTORED",phase}}
   verify(p.tls);hist();phase="START_OUTCOME_UNKNOWN";
   const run=io.start();if(typeof run!=="string"||!/^campuspool-staging-backup-job-[a-z0-9]+$/.test(run)||run===prior[0].name)fail("START_ID_UNVERIFIED");
   phase="RUN_PENDING";let status;
   for(let i=0;i<maxRunPoll;i++){const h=io.history();if(!Array.isArray(h)||h.length<1||h.length>2||!h.some(x=>x.name===prior[0].name&&x.properties?.status==="Succeeded")||new Set(h.map(x=>x.name)).size!==h.length||h.some(x=>![prior[0].name,run].includes(x.name)))fail("UNEXPECTED_EXECUTION_HISTORY");status=h.find(x=>x.name===run)?.properties?.status;if(terminal.includes(status))break;if(status!==undefined&&!["Running","Pending","Processing","Starting","Queued","Unknown"].includes(status))fail("UNEXPECTED_RUN_STATE");io.wait()}
   if(!terminal.includes(status))fail("RUN_NOT_TERMINAL");
   const expected=[...prior,{name:run,status}];hist(expected);restore(expected);return {state:"RESTORED",phase,run,status}
  }catch(e){return {state:"BLOCK",phase,reason:typeof e.message==="string"&&/^[A-Z_]+$/.test(e.message)?e.message:"OPERATION_OUTCOME_UNCERTAIN"}}
 }
 return {build,run,prior,ctx}
}
function operatorTests(make){
 const cp=x=>JSON.parse(JSON.stringify(x));
 // mock comparator exercises orchestration, not Azure schema; separate predicate suite covers schema.
 const cmp=(e,a)=>JSON.stringify(e)===JSON.stringify(a)?{state:"VERIFIED"}:JSON.stringify(e)===JSON.stringify({...a,provisioningState:"Succeeded"})&&a.provisioningState==="Updating"?{state:"PENDING"}:{state:"BLOCK"};
 const hg=(a,e)=>a.length===e.length&&new Set(a.map(x=>x.name)).size===a.length&&e.every(x=>a.some(y=>x.name===y.name&&x.status===y.properties.status));
 const op=make(cmp,hg),base={provisioningState:"Succeeded",template:{containers:[{args:["--preflight"],env:[],resources:{cpu:0.5}}]}};
 let count=0;
 function test(name,options,expected){
  let s=cp(base),h=op.prior.map(x=>({name:x.name,properties:{status:x.status}})),patches=0,starts=0,polls=0,queued=null;
  const io={snapshot:()=>{if(queued&&++polls>=2){s=queued;queued=null}return cp(s)},history:()=>cp(h),approve:t=>!options.decline||options.decline!==t,patch:b=>{patches++;if(options.patchError)throw Error("PATCH_UNKNOWN");const target={...s,template:cp(b.properties.template),provisioningState:"Succeeded"};if(options.drift){target.template.containers[0].resources.cpu=5;s=target}else if(options.timeout){s={...target,provisioningState:"Updating"}}else if(options.pending){s={...target,provisioningState:"Updating"};queued=target;polls=0}else s=target},start:()=>{starts++;if(options.startError)throw Error("START_UNKNOWN");const name="campuspool-staging-backup-job-test1";h.push({name,properties:{status:options.running?"Running":options.failed?"Failed":"Succeeded"}});if(options.extra)h.push({name:"unexpected",properties:{status:"Succeeded"}});return name},wait:()=>{},log:()=>{}};
  if(options.history)h.push({name:"unexpected",properties:{status:"Succeeded"}});
  if(options.baselineDrift)s.template.containers[0].resources.cpu=1;
  const v=op.run(io,base,{maxPoll:3,maxRunPoll:3});
  if(v.state!==expected[0]||patches!==expected[1]||starts!==expected[2])throw Error("TEST_FAILED_"+name);
  if(v.state.includes("RESTORED")&&JSON.stringify(s)!==JSON.stringify(base))throw Error("RESTORE_NOT_EXACT");
  count++;
 }
 test("success",{},["RESTORED",2,1]);test("decline_apply",{decline:"APPLY_TLS_ONLY_AND_RESTORE"},["DECLINED",0,0]);test("decline_start",{decline:"START_ONE_TLS_ONLY"},["DECLINED_RESTORED",2,0]);test("pending",{pending:true},["RESTORED",2,1]);test("drift",{drift:true},["BLOCK",1,0]);test("timeout",{timeout:true},["BLOCK",1,0]);test("patch_unknown",{patchError:true},["BLOCK",1,0]);test("start_unknown",{startError:true},["BLOCK",1,1]);test("run_pending",{running:true},["BLOCK",1,1]);test("terminal_failure",{failed:true},["RESTORED",2,1]);test("extra_execution",{extra:true},["BLOCK",1,1]);test("history_drift",{history:true},["BLOCK",0,0]);test("baseline_drift",{baselineDrift:true},["BLOCK",0,0]);return count
}
module.exports={makeOperator,operatorTests};
if(require.main===module){if(process.argv.length===3&&process.argv[2]==='--self-test'){try{console.log('MOCKED_ORCHESTRATION_PASS='+operatorTests(makeOperator));}catch{console.error('BLOCK MOCKED_TEST_FAILED');process.exitCode=1;}}else{console.error('Offline state machine only; use --self-test');process.exitCode=2;}}
