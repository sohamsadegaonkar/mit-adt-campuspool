'use strict';
// Check the structural age v1 envelope before any bytes reach Azure Blob.
// This does not replace decrypting ciphertext or a real independent restore.
const {Transform}=require('node:stream');
const MAGIC=Buffer.from('age-encryption.org/v1\n','ascii');
const MAX_HEADER=16384;
const HEADER_MAC=/\n--- [A-Za-z0-9+/]{43}\n/;
const X25519_STANZA=/\n-> X25519 [A-Za-z0-9+/]{43}\n/;

function ageCiphertextGuard(){
  let buffered=Buffer.alloc(0),verified=false;
  return new Transform({
    transform(chunk,_encoding,callback){
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      if(verified)return callback(null,bytes);
      const prefix=bytes.subarray(0,Math.max(0,MAX_HEADER+1-buffered.length));
      const inspect=Buffer.concat([buffered,prefix]);
      if(inspect.length>=MAGIC.length &&
         !inspect.subarray(0,MAGIC.length).equals(MAGIC))
        return callback(Error('AGE_CIPHERTEXT_HEADER_INVALID'));
      if(inspect.length<MAGIC.length &&
         !MAGIC.subarray(0,inspect.length).equals(inspect))
        return callback(Error('AGE_CIPHERTEXT_HEADER_INVALID'));
      const text=inspect.toString('latin1');
      const mac=HEADER_MAC.exec(text);
      if(mac){
        const header=text.slice(0,mac.index+mac[0].length);
        if(!X25519_STANZA.test(header))
          return callback(Error('AGE_CIPHERTEXT_HEADER_INVALID'));
        verified=true;
        return callback(null,Buffer.concat([buffered,bytes]));
      }
      if(inspect.length>MAX_HEADER)
        return callback(Error('AGE_CIPHERTEXT_HEADER_INVALID'));
      buffered=inspect;
      callback();
    },
    flush(callback){
      callback(verified?undefined:Error('AGE_CIPHERTEXT_HEADER_INVALID'));
    }
  });
}
module.exports={ageCiphertextGuard};
