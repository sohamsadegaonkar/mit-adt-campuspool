'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {Writable}=require('node:stream');
const {ageCiphertextGuard}=require('./scripts/age-ciphertext-guard');

const HEADER='age-encryption.org/v1\n-> X25519 '+'A'.repeat(43)+'\n'+
  'B'.repeat(43)+'\n--- '+'C'.repeat(43)+'\n';
async function guard(chunks){
 const received=[];
 await pipeline(Readable.from(chunks),ageCiphertextGuard(),new Writable({
  write(part,_encoding,callback){received.push(Buffer.from(part));callback();}
 }));
 return Buffer.concat(received);
}
test('holds chunks until complete X25519/MAC envelope, then preserves all bytes',async()=>{
 const data=Buffer.concat([Buffer.from(HEADER,'ascii'),Buffer.from([0,255,33,20,0,3])]);
 const chunks=[data.subarray(0,1),data.subarray(1,8),data.subarray(8,90),
   data.subarray(90,125),data.subarray(125)];
 const actual=await guard(chunks);
 assert.deepEqual(actual,data);
});
test('rejects raw custom PostgreSQL archive rather than uploading plaintext',async()=>{
 await assert.rejects(()=>guard([Buffer.from('PGDMPSECRET_ROWS')]),
   /AGE_CIPHERTEXT_HEADER_INVALID/);
});
test('rejects valid version line without an X25519 recipient or MAC',async()=>{
 for(const invalid of [
  'age-encryption.org/v1\n',
  'age-encryption.org/v1\n-> scrypt abc\n--- '+'D'.repeat(43)+'\n',
  'age-encryption.org/v1\n-> X25519 '+'A'.repeat(43)+'\nINVALID\n',
  'age-encryption.org/v1\n-> X25519 '+'A'.repeat(43)+'\n--- WRONG\n'
 ]){
  await assert.rejects(()=>guard([Buffer.from(invalid)]),/AGE_CIPHERTEXT_HEADER_INVALID/);
 }
});
test('fails closed on oversized input without a complete header',async()=>{
 await assert.rejects(()=>guard([Buffer.from('age-encryption.org/v1\n'+'-'.repeat(17000))]),
    /AGE_CIPHERTEXT_HEADER_INVALID/);
});
