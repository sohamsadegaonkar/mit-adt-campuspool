'use strict';
// Cloud-only PostgreSQL secret/TLS guard. No network, no secret logging.
const fs=require('node:fs');
const path=require('node:path');
const {X509Certificate,createHash}=require('node:crypto');
// Independently verified public staging CA; certificate rotation requires reviewed code change.
const STAGING_CA_SHA256='807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';

function safeRegularFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))return null;
  try{
    // Disallow symlinks: never allow a job operator to redirect a trust/secret path.
    const lstat=fs.lstatSync(file);
    if(!lstat.isFile()||lstat.isSymbolicLink())return null;
    if(fs.realpathSync(file)!==file)return null;
    if(lstat.size<=0||lstat.size>131072||(lstat.mode&0o022)!==0)return null;
    return lstat;
  }catch{return null;}
}

function validCaFileAgainstFingerprint(file,expectedFingerprint){
  if(!/^[A-F0-9]{64}$/.test(expectedFingerprint||''))return false;
  const st=safeRegularFile(file);
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
function validCaFile(file){return validCaFileAgainstFingerprint(file,STAGING_CA_SHA256);}

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
