'use strict';
// Independently verify Alpine 3.23 zlib 1.3.2-r1 includes exact upstream fix.
// This is source/package provenance, not a runtime PoC or a CVE scanner waiver.
const https=require('node:https');
const crypto=require('node:crypto');
const BASE='https://raw.githubusercontent.com/alpinelinux/aports/3.23-stable/main/zlib/';
const PATCH_SHA512='878888308a51296470f05eca59a79212314d4c9a26c19bbf70c1cb1b8d25eb42e0cce5a001acbe287268aa215c854cb5a9990ff62b7aefa9de221803d172957e';
const UPSTREAM='df84af25dc1942490e1d1c899a07619152a46148';

function getFile(uri){
 return new Promise((resolve,reject)=>{
  https.get(uri,{timeout:15000,headers:{'User-Agent':'campuspool-source-provenance/1'}},res=>{
    if(res.statusCode!==200){res.resume();return reject(Error('SOURCE_HTTP_STATUS_INVALID'));}
    const chunks=[];let len=0;
    res.on('data',b=>{len+=b.length;if(len>100000){res.destroy(Error('SOURCE_TOO_LARGE'));return;}chunks.push(b);});
    res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error',reject);
  }).on('error',reject);
 });
}
async function main(){
 const [build,patch]=await Promise.all([getFile(BASE+'APKBUILD'),getFile(BASE+'CVE-2026-85091.patch')]);
 if(!/^pkgver=1\.3\.2$/m.test(build)||!/^pkgrel=1$/m.test(build)||
    !build.includes('CVE-2026-85091.patch')||!build.includes('1.3.2-r1:'))
   throw Error('ALPINE_PATCH_PACKAGE_VERSION_CHANGED');
 const declared=build.match(/^([0-9a-f]{128})\s+CVE-2026-85091\.patch$/m);
 if(!declared||declared[1]!==PATCH_SHA512)throw Error('ALPINE_APKBUILD_PATCH_HASH_CHANGED');
 const sha=crypto.createHash('sha512').update(patch).digest('hex');
 if(sha!==PATCH_SHA512)throw Error('ALPINE_PATCH_BYTES_DID_NOT_MATCH');
 if(!patch.startsWith('From '+UPSTREAM+' ') ||
    !patch.includes('Subject: [PATCH] Fix buffer overflow bug in non-blocking gzwrite.')||
    !patch.includes('This addresses CVE-2026-85091.')||
    !patch.includes('+                state->strm.avail_in = 0;')||
    !patch.includes('+                state->strm.next_in = state->in;'))
   throw Error('UPSTREAM_ZLIB_PATCH_ID_OR_FIX_SEMANTICS_CHANGED');
 process.stdout.write('ALPINE_ZLIB_SOURCE_PROVENANCE_PASS version=1.3.2-r1 upstream='+UPSTREAM+' sha512='+sha+'\n');
 process.stdout.write('CVE_2026_76844_SAME_PATCH_EVIDENCE_SOURCE_ONLY_NOT_RUNTIME_POC\n');
}
if(require.main===module){
 main().catch(e=>{process.stderr.write('ZLIB_PROVENANCE_BLOCKED '+e.message+'\n');process.exitCode=1;});
}
module.exports={getFile,main};
