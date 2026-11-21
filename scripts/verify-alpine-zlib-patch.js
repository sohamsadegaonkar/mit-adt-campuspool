'use strict';
// Alpine 3.23 zlib 1.4-r0 upstream source provenance, not runtime CVE proof.
// Fail closed on Alpine package revision, pinned source checksum, upstream tag,
// or exact Git blob changes. Never waive an image vulnerability-scan failure.
const https=require('node:https');
const crypto=require('node:crypto');

const ALPINE='https://raw.githubusercontent.com/alpinelinux/aports/3.23-stable/main/zlib/APKBUILD';
const UPSTREAM='https://raw.githubusercontent.com/madler/zlib/v1.4/';
const TAR_SHA512='13f02285da85956ff722d814695b96807aff7a511ebf4b6d98cf708c353920666093cc18b6653cd7992c8e75c103f7b4baf2de3a105c2db9dcd62bab2c940859';
const GZWRITE_GIT_BLOB='32560fe0b026f5573fa30e07646ae902805d83be';
const CHANGELOG_GIT_BLOB='228a03afa1d76a84e123979e0ab3df66ccc322dd';

function getFile(uri){
 return new Promise((resolve,reject)=>{
  https.get(uri,{timeout:15000,headers:{'User-Agent':'campuspool-source-provenance/2'}},res=>{
    if(res.statusCode!==200){res.resume();return reject(Error('SOURCE_HTTP_STATUS_INVALID'));}
    const chunks=[];let len=0;
    res.on('data',b=>{len+=b.length;if(len>150000){res.destroy(Error('SOURCE_TOO_LARGE'));return;}chunks.push(b);});
    res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error',reject);
  }).on('error',reject);
 });
}

function gitBlobSha1(text){
 const bytes=Buffer.from(text,'utf8');
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
}

function verifySources(build,changelog,gzwrite){
 // Alpine's 3.23-stable version superseded the 1.3.2-r1 patch file with
 // zlib-1.4.tar.gz. A 404 on the removed patch is not a security finding.
 if(!/^pkgname=zlib$/m.test(build) || !/^pkgver=1\.4$/m.test(build) ||
    !/^pkgrel=0$/m.test(build) ||
    !/^source="https:\/\/zlib\.net\/fossils\/zlib-\$pkgver\.tar\.gz"$/m.test(build) ||
    !/^#\s+1\.4-r0:$/m.test(build) ||
    !/^#\s+- CVE-2026-4738$/m.test(build) ||
    !/^#\s+1\.3\.2-r1:$/m.test(build) ||
    !/^#\s+- CVE-2026-85091$/m.test(build))
   throw Error('ALPINE_ZLIB_1_4_SECURITY_VERSION_NOT_VERIFIED');
 const declared=build.match(/^([0-9a-f]{128})\s+zlib-1\.4\.tar\.gz$/m);
 if(!declared || declared[1]!==TAR_SHA512)
   throw Error('ALPINE_ZLIB_SOURCE_TARBALL_SHA512_CHANGED');
 // Tagged upstream v1.4 ChangeLog explicitly names this vulnerability. Both
 // files are pinned by full Git blob IDs; unexpected tag/source drift fails.
 if(gitBlobSha1(changelog)!==CHANGELOG_GIT_BLOB ||
    !changelog.includes('Changes in 1.4 (4 Nov 2026)') ||
    !changelog.includes('Fix gzwrite() buffer overflow (CVE-2026-85091)'))
   throw Error('UPSTREAM_ZLIB_1_4_CHANGELOG_NOT_VERIFIED');
 if(gitBlobSha1(gzwrite)!==GZWRITE_GIT_BLOB ||
    !gzwrite.includes('local int gz_vacate(gz_statep state)') ||
    !gzwrite.includes('strm->next_in + strm->avail_in <= state->in + state->size') ||
    !gzwrite.includes('if (strm->avail_in == 0)') ||
    !gzwrite.includes('memmove(state->in, strm->next_in, strm->avail_in);'))
   throw Error('UPSTREAM_ZLIB_1_4_FIX_SOURCE_NOT_VERIFIED');
 return {
    version:'1.4-r0',
    tarSha512:TAR_SHA512,
    upstreamGzwriteBlob:GZWRITE_GIT_BLOB
 };
}

async function main(){
 const [build,changelog,gzwrite]=await Promise.all([
   getFile(ALPINE),
   getFile(UPSTREAM+'ChangeLog'),
   getFile(UPSTREAM+'gzwrite.c')
 ]);
 const evidence=verifySources(build,changelog,gzwrite);
 process.stdout.write('ALPINE_ZLIB_SOURCE_PROVENANCE_PASS version='+evidence.version+
     ' archive_sha512='+evidence.tarSha512+
     ' upstream_gzwrite_blob='+evidence.upstreamGzwriteBlob+'\n');
 process.stdout.write('CVE_2026_85091_UPSTREAM_1_4_SOURCE_VERIFIED_NOT_RUNTIME_POC\n');
 process.stdout.write('NO_VULNERABILITY_SCANNER_WAIVER_PERFORMED=YES\n');
}
if(require.main===module){
 main().catch(e=>{process.stderr.write('ZLIB_PROVENANCE_BLOCKED '+e.message+'\n');process.exitCode=1;});
}
module.exports={getFile,gitBlobSha1,verifySources,main};
