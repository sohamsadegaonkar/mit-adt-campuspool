'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assess,PROOF}=require('./scripts/assess-cloud-worker-critical');
const base={
  Results:[{Target:'campuspool-backup-security:ci (debian 12.15)',Class:'os-pkgs',
  Vulnerabilities:[{VulnerabilityID:'CVE-2023-45853',PkgName:'zlib1g',
    InstalledVersion:'1:1.2.13.dfsg-1',Severity:'CRITICAL'},
    {VulnerabilityID:'CVE-2026-TEST',PkgName:'test-pkg',Severity:'HIGH'}]}]
};
const clone=()=>JSON.parse(JSON.stringify(base));
test('only vendor-confirmed Bookworm zlib MiniZip match can be classified with evidence',()=>{
 const result=assess(clone(),PROOF);
 assert.equal(result.status,'ONE_CRITICAL_SCANNER_MATCH_NOT_AFFECTED_BY_VENDOR_BUILD');
 assert.equal(result.rawCritical,1);
 assert.equal(result.highRemaining,1);
});
test('the critical assessment fails closed on missing binary proof',()=>{
 assert.throws(()=>assess(clone(),''),/MINIZIP_ABSENCE_IMAGE_VERIFICATION_REQUIRED/);
});
test('another critical CVE cannot be excused by the zlib evidence',()=>{
 const r=clone();r.Results[0].Vulnerabilities.push({VulnerabilityID:'CVE-OTHER',
   PkgName:'another',Severity:'CRITICAL'});
 assert.throws(()=>assess(r,PROOF),/ADDITIONAL_CRITICAL_FINDING_BLOCKED/);
});
test('different package, version, OS or scanner classification are blocked',()=>{
 for(const [field,value] of [
  ['PkgName','libminizip1'],['InstalledVersion','2.0.0'],
  ['VulnerabilityID','CVE-NOT-THE-SAME']
 ]){
  const r=clone();r.Results[0].Vulnerabilities[0][field]=value;
  assert.throws(()=>assess(r,PROOF),/CRITICAL_NOT_COVERED/);
 }
 const r=clone();r.Results[0].Target='debian 13.7';
 assert.throws(()=>assess(r,PROOF),/CRITICAL_NOT_COVERED/);
});
test('truly zero critical is reported without any exception',()=>{
 const r=clone();r.Results[0].Vulnerabilities.shift();
 assert.equal(assess(r,'').status,'NO_CRITICAL_IN_RAW_SCAN');
});
test('corrupt and missing scan format fail closed',()=>{
 assert.throws(()=>assess({},PROOF),/TRIVY_REPORT_MISSING/);
});
