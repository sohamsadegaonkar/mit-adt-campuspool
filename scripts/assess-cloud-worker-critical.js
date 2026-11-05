'use strict';
// Narrow, auditable analysis of one Debian Bookworm zlib/MiniZip scanner finding.
// Never modify raw Trivy JSON or waive another vulnerability.
const fs=require('node:fs');
const EXPECTED_CVE='CVE-2023-45853';
const EXPECTED_PKG='zlib1g';
const EXPECTED_VERSION='1:1.2.13.dfsg-1';
const PROOF='BOOKWORM_ZLIB_MINIZIP_NOT_BUILT_PASS';

function assess(report,proof){
  if(!report||!Array.isArray(report.Results))
    throw Error('TRIVY_REPORT_MISSING');
  const hits=report.Results.flatMap(r=>(r.Vulnerabilities||[]).map(v=>({
    ...v,classification:r.Class||'',target:r.Target||''
  })));
  const critical=hits.filter(x=>x.Severity==='CRITICAL');
  if(!critical.length)return {status:'NO_CRITICAL_IN_RAW_SCAN',highRemaining:hits.filter(x=>x.Severity==='HIGH').length};
  if(critical.length!==1)throw Error('ADDITIONAL_CRITICAL_FINDING_BLOCKED');
  const v=critical[0];
  if(v.VulnerabilityID!==EXPECTED_CVE||v.PkgName!==EXPECTED_PKG||
    v.InstalledVersion!==EXPECTED_VERSION||v.classification!=='os-pkgs'||
    !/\bdebian 12\./.test(v.target))
    throw Error('CRITICAL_NOT_COVERED_BY_NARROW_DEBIAN_EVIDENCE');
  if(proof.trim()!==PROOF)
    throw Error('MINIZIP_ABSENCE_IMAGE_VERIFICATION_REQUIRED');
  return {
    status:'ONE_CRITICAL_SCANNER_MATCH_NOT_AFFECTED_BY_VENDOR_BUILD',
    cve:EXPECTED_CVE,
    package:EXPECTED_PKG,
    installedVersion:EXPECTED_VERSION,
    vendorAdvisory:'https://security-tracker.debian.org/tracker/CVE-2023-45853',
    rawCritical:critical.length,
    highRemaining:hits.filter(x=>x.Severity==='HIGH').length
  };
}

if(require.main===module){
  try{
    const result=assess(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),
      fs.readFileSync(process.argv[3],'utf8'));
    process.stdout.write('TARGETED_CRITICAL_ASSESSMENT '+JSON.stringify(result)+'\n');
    process.stdout.write('RAW_TRIVY_REPORT_PRESERVED=YES; HIGH_SEVERITY_RELEASE_GATE_UNCHANGED\n');
  }catch(e){
    process.stderr.write('CRITICAL_ASSESSMENT_BLOCKED '+e.message+'\n');
    process.exitCode=1;
  }
}
module.exports={assess,PROOF};
