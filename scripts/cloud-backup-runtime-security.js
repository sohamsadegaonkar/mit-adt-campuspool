'use strict';
// Cloud-only PostgreSQL secret/TLS guard. No network, no secret logging.
const fs=require('node:fs');
const path=require('node:path');
const {X509Certificate,createHash}=require('node:crypto');
// Independently verified public staging CA; certificate rotation requires reviewed code change.
const STAGING_CA_SHA256='807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';

// A projected Kubernetes/Container Apps Secret mount may expose "ca.pem" as
// a symlink to ..data/ca.pem. Only that exact CA location may resolve to a
// regular file INSIDE the same mount; PostgreSQL passfiles must never do so.
function safeRegularFile(file,{projectedCaMount=null}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))return null;
  try{
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size<=0||stat.size>131072||
       (stat.mode&0o022)!==0)return null;
    const resolved=fs.realpathSync(file);
    if(resolved!==file){
      if(typeof projectedCaMount!=='string'||
         !path.isAbsolute(projectedCaMount)||
         file!==path.join(projectedCaMount,'ca.pem'))return null;
      // Never follow an operator-controlled mount root or an out-of-mount
      // symlink. The fingerprint below is still the final trust decision.
      if(fs.realpathSync(projectedCaMount)!==projectedCaMount)return null;
      if(!resolved.startsWith(projectedCaMount+path.sep)||
         path.basename(resolved)!=='ca.pem')return null;
    }
    return stat;
  }catch{return null;}
}

function validCaFileAgainstFingerprint(file,expectedFingerprint,options={}){
  if(!/^[A-F0-9]{64}$/.test(expectedFingerprint||''))return false;
  const st=safeRegularFile(file,options);
  if(!st)return false;
  try{
    const pem=fs.readFileSync(file,'utf8');
    const blocks=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if(blocks?.length!==1||pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())return false;
    const now=Date.now();
    return blocks.every(block=>{
      const cert=new X509Certificate(block);
      return cert.ca && Date.parse(cert.validFrom)<=now && Date.parse(cert.validTo)>now &&
        createHash('sha256').update(cert.raw).digest('hex').toUpperCase()===expectedFingerprint;
    });
  }catch{return false;}
}

// Runtime uses only the compiled-in pin, never an environment/CLI override.
function validCaFile(file){
  return validCaFileAgainstFingerprint(file,STAGING_CA_SHA256,{
    projectedCaMount:'/mnt/staging-ca'
  });
}

function validCloudPassFile(file,env){
  const st=safeRegularFile(file);
  if(!st||st.size>4096||(st.mode&0o077)!==0||
     typeof process.getuid!=='function'||st.uid!==process.getuid()||
     !file.startsWith('/dev/shm/'))return false;
  try{
    const type=fs.statfsSync(file).type;
    if(type!==0x01021994)return false; // Linux TMPFS_MAGIC; no plaintext on persisted rootfs.
    const txt=fs.readFileSync(file,'utf8');
    const lines=txt.trimEnd().split('\n');
    if(lines.length!==1)return false;
    const match=/^([^:\r\n]+):([^:\r\n]+):([^:\r\n]+):([^:\r\n]+):([^\r\n]+)$/.exec(lines[0]);
    if(!match)return false;
    return match[1]===env.PGHOST && match[2]===env.PGPORT &&
      match[3]===env.PGDATABASE && match[4]===env.PGUSER;
  }catch{return false;}
}
module.exports={STAGING_CA_SHA256,validCaFile,validCaFileAgainstFingerprint,validCloudPassFile};
