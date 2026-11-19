'use strict';
// Offline readback predicate only. No Azure, filesystem writes, DB or job operations.
// Caller must independently verify live resource ID, scope, RBAC, baseline and history.
function compare(expected,actual,context){
  const invalid={state:"BLOCK",reason:"INVALID_CONTEXT_OR_BASELINE"};
  if(context?.api!=="2026-01-01"||context?.job!=="campuspool-staging-backup-job")return invalid;
  const path=["template","containers",0,"resources","ephemeralStorage"];
  const own=(o,k)=>o!==null&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,k);
  const eq=(a,b)=>{
    if(a===b)return true;
    if(a===null||b===null||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
    const ak=Object.keys(a),bk=Object.keys(b);
    return ak.length===bk.length&&ak.every(k=>own(b,k)&&eq(a[k],b[k]));
  };
  const valid=s=>{
    const c=s?.template?.containers?.[0],cfg=s?.configuration,env=c?.env;
    if(!c||s.template.containers.length!==1||!Array.isArray(env)||!cfg||!c.resources||s.identity?.type!=="UserAssigned"||cfg.triggerType!=="Manual"||cfg.replicaRetryLimit!==0||cfg.manualTriggerConfig?.parallelism!==1||cfg.manualTriggerConfig?.replicaCompletionCount!==1)return false;
    if(c.name!=="backup-worker"||c.image!=="ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:694e39c24b89c91dfea8419ed669a70a9a62cef18d99038a87e84225e5468ce8"||(c.command??[]).length!==0||(s.template.initContainers??[]).length!==0)return false;
    const names=env.map(e=>e?.name);
    if(new Set(names).size!==names.length||names.some(n=>typeof n!=="string"||["PGPASSWORD","PGPASSFILE","AZURE_EXPORT_APPROVED"].includes(n)))return false;
    const direct=(n,v)=>env.some(e=>e.name===n&&e.value===v&&!own(e,"secretRef"));
    if(!direct("PGSSLMODE","verify-full")||!direct("PGHOST","aws-0-ap-southeast-1.pooler.supabase.com")||!direct("PGUSER","postgres.tnitksrlntrdxbvznxzf")||!direct("PGPORT","5432")||!direct("PGDATABASE","postgres")||!direct("AZURE_AUTH_MODE","managed-identity")||!direct("PGSSLROOTCERT","/mnt/staging-ca/ca.pem"))return false;
    if(!c.volumeMounts?.some(m=>m.volumeName==="staging-pg-ca"&&m.mountPath==="/mnt/staging-ca")||!s.template.volumes?.some(v=>v.name==="staging-pg-ca"&&v.storageType==="Secret"&&v.secrets?.some(t=>t.secretRef==="staging-pg-root-ca"&&t.path==="ca.pem")))return false;
    const ids=cfg.identitySettings;
    if(!Array.isArray(ids)||ids.length!==2||!ids.some(x=>x.lifecycle==="None"&&typeof x.identity==="string"&&x.identity.toLowerCase().endsWith("/campuspool-ghcr-vault-reader"))||!ids.some(x=>x.lifecycle==="Main"&&typeof x.identity==="string"&&x.identity.toLowerCase().endsWith("/campuspool-staging-backup-data-id")))return false;
    return eq(c.args,["--preflight"])?!names.includes("AZURE_TLS_CHECK_APPROVED"):eq(c.args,["--check-tls"])&&direct("AZURE_TLS_CHECK_APPROVED","YES");
  };
  if(!valid(expected)||expected.provisioningState!=="Succeeded")return invalid;
  if(!actual||typeof actual!=="object")return {state:"BLOCK",reason:"INVALID_READBACK"};
  const alternate=JSON.parse(JSON.stringify(expected));
  let parent=alternate;
  for(const k of path.slice(0,-1))parent=parent[k];
  const had=own(parent,path[path.length-1]);delete parent[path[path.length-1]];
  const match=s=>eq(s,expected)?"EXACT":had&&eq(s,alternate)?"READONLY_STORAGE_OMISSION":null;
  const m=match(actual);
  if(m)return {state:"VERIFIED",reason:m};
  if(["Updating","InProgress","Accepted","Creating"].includes(actual.provisioningState)){
    const copy={...actual,provisioningState:"Succeeded"};
    if(match(copy))return {state:"PENDING",reason:"PROVISIONING_NOT_TERMINAL"};
  }
  return {state:"BLOCK",reason:"UNEXPECTED_CONFIGURATION_OR_STATE"};
}
function historyGuard(history,expected){
  if(!Array.isArray(history)||!Array.isArray(expected)||history.length!==expected.length)return false;
  const names=new Set(history.map(x=>x?.name));
  return names.size===history.length&&new Set(expected.map(x=>x?.name)).size===expected.length&&expected.every(x=>typeof x?.name==="string"&&["Succeeded","Failed","Stopped"].includes(x.status)&&history.some(y=>y.name===x.name&&y.properties?.status===x.status));
}
function selfTest(compare,historyGuard){
  const ctx={api:"2026-01-01",job:"campuspool-staging-backup-job"};
  const e={provisioningState:"Succeeded",identity:{type:"UserAssigned"},configuration:{triggerType:"Manual",replicaRetryLimit:0,manualTriggerConfig:{parallelism:1,replicaCompletionCount:1},identitySettings:[{identity:"/synthetic/campuspool-ghcr-vault-reader",lifecycle:"None"},{identity:"/synthetic/campuspool-staging-backup-data-id",lifecycle:"Main"}]},template:{containers:[{name:"backup-worker",image:"ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:694e39c24b89c91dfea8419ed669a70a9a62cef18d99038a87e84225e5468ce8",args:["--preflight"],resources:{cpu:0.5,memory:"1Gi",ephemeralStorage:"2Gi"},env:Object.entries({PGSSLMODE:"verify-full",PGHOST:"aws-0-ap-southeast-1.pooler.supabase.com",PGUSER:"postgres.tnitksrlntrdxbvznxzf",PGPORT:"5432",PGDATABASE:"postgres",AZURE_AUTH_MODE:"managed-identity",PGSSLROOTCERT:"/mnt/staging-ca/ca.pem"}).map(([name,value])=>({name,value})),volumeMounts:[{volumeName:"staging-pg-ca",mountPath:"/mnt/staging-ca"}]}],volumes:[{name:"staging-pg-ca",storageType:"Secret",secrets:[{secretRef:"staging-pg-root-ca",path:"ca.pem"}]}]}};
  const clone=x=>JSON.parse(JSON.stringify(x));let count=0;
  const check=(name,actual,want)=>{if(actual!==want)throw Error("TEST_FAILED "+name);count++};
  const test=(name,change,want)=>{const a=clone(e);change(a,a.template.containers[0]);check(name,compare(e,a,ctx).state,want)};
  test("exact",()=>{},"VERIFIED");test("omission",(a,c)=>delete c.resources.ephemeralStorage,"VERIFIED");
  test("changed storage",(a,c)=>c.resources.ephemeralStorage="3Gi","BLOCK");test("extra",(a,c)=>c.resources.extra=true,"BLOCK");
  test("CA",(a,c)=>c.volumeMounts=[],"BLOCK");test("identity",a=>a.configuration.identitySettings.reverse(),"BLOCK");
  test("image",(a,c)=>c.image="other","BLOCK");test("env",(a,c)=>c.env.reverse(),"BLOCK");
  test("CPU",(a,c)=>c.resources.cpu=1,"BLOCK");test("memory",(a,c)=>c.resources.memory="2Gi","BLOCK");
  test("trigger",a=>a.configuration.triggerType="Schedule","BLOCK");test("retry",a=>a.configuration.replicaRetryLimit=1,"BLOCK");
  test("export",(a,c)=>c.env.push({name:"AZURE_EXPORT_APPROVED",value:"YES"}),"BLOCK");
  test("pending",a=>a.provisioningState="Updating","PENDING");test("pending drift",(a,c)=>{a.provisioningState="Updating";c.image="other"},"BLOCK");
  test("failed provisioning",a=>a.provisioningState="Failed","BLOCK");
  test("bad approval",(a,c)=>c.env.push({name:"AZURE_TLS_CHECK_APPROVED",value:"YES"}),"BLOCK");
  check("wrong API",compare(e,e,{...ctx,api:"2025-01-01"}).state,"BLOCK");
  const tls=clone(e);tls.template.containers[0].args=["--check-tls"];tls.template.containers[0].env.push({name:"AZURE_TLS_CHECK_APPROVED",value:"YES"});
  check("TLS candidate",compare(tls,tls,ctx).state,"VERIFIED");check("preflight not TLS",compare(tls,e,ctx).state,"BLOCK");
  const no=clone(e);delete no.template.containers[0].resources.ephemeralStorage;check("unexpected added storage",compare(no,e,ctx).state,"BLOCK");
  const wanted=[{name:"old",status:"Succeeded"}],actual=[{name:"old",properties:{status:"Succeeded"}}];
  check("history",historyGuard(actual,wanted),true);check("duplicate",historyGuard([...actual,...actual],wanted),false);
  check("running",historyGuard([{name:"old",properties:{status:"Running"}}],wanted),false);
  check("different",historyGuard([{name:"new",properties:{status:"Succeeded"}}],wanted),false);
  return count;
}
module.exports={compare,historyGuard,selfTest};
if(require.main===module){try{const fs=require('node:fs');const a=process.argv.slice(2);if(a.length===1&&a[0]==='--self-test'){console.log('SYNTHETIC_PREDICATES_PASS='+selfTest(compare,historyGuard));}else if(a.length===2){const result=compare(JSON.parse(fs.readFileSync(a[0],'utf8')),JSON.parse(fs.readFileSync(a[1],'utf8')),{api:'2026-01-01',job:'campuspool-staging-backup-job'});console.log(result.state+' '+result.reason);process.exitCode=result.state==='VERIFIED'?0:result.state==='PENDING'?3:1;}else{console.error('Usage: node azure-job-readback-guard.js --self-test | expected.json actual.json');process.exitCode=2;}}catch{console.error('BLOCK INVALID_INPUT_OR_TEST_FAILURE');process.exitCode=1;}}
