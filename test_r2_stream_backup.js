'use strict';
// All test processes are synthetic: no Cloudflare, R2 or real database access.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PassThrough}=require('node:stream');
const {EventEmitter}=require('node:events');
const {
  validate,redactChildEnv,limitedEnv,backup,objectKey,args
}=require('./scripts/r2-stream-backup');

const REF='tnitksrlntrdxbvznxzf';
const fake={
  PGUSER:'postgres.'+REF,
  PGHOST:'aws-0-ap-southeast-1.pooler.supabase.com',
  PGPORT:'5432',PGDATABASE:'postgres',PGSSLMODE:'verify-full',
  PGPASSWORD:'NEVER_PRINT_THIS',
  R2_BACKUP_BUCKET:'campuspool-staging-backups',
  R2_BACKUP_REMOTE:'campuspoolr2',
  AGE_RECIPIENT:'age1'+'a'.repeat(58),
  RCLONE_CONFIG_CAMPUSPOOLR2_TYPE:'s3',
  RCLONE_CONFIG_CAMPUSPOOLR2_PROVIDER:'Cloudflare',
  RCLONE_CONFIG_CAMPUSPOOLR2_ENDPOINT:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',
  RCLONE_CONFIG_CAMPUSPOOLR2_ACCESS_KEY_ID:'FAKE_ACCESS',
  RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY:'SECRET_PRIVATE',
  R2_PRIVATE_BUCKET_CONFIRMED:'YES',
  R2_EXECUTE_CONFIRMED:'YES'
};
function fakeSpawner({tamper=false,uploadFailure=false}={}){
  let stored;const calls=[];
  function spawn(program,argv,opts){
    calls.push({program,args:argv,env:opts.env});
    const c=new EventEmitter();
    c.stdout=new PassThrough();c.stdin=new PassThrough();
    if(program==='pg_dump'){
      process.nextTick(()=>{
        c.stdout.end(Buffer.from('PGDMP_PRIVATE_STUDENT_ROWS'+'.'.repeat(90)));
        c.emit('close',0,null);
      });
    }else if(program==='age'){
      const pieces=[];
      c.stdin.on('data',v=>pieces.push(v));
      c.stdin.on('end',()=>{
        c.stdout.end(Buffer.concat([Buffer.from('ENCRYPTED_TEST_ONLY:'),...pieces]));
        c.emit('close',0,null);
      });
    }else if(program==='rclone' && argv[0]==='rcat'){
      const pieces=[];
      c.stdin.on('data',v=>pieces.push(v));
      c.stdin.on('end',()=>{
        stored=Buffer.concat(pieces);
        c.stdout.end();c.emit('close',uploadFailure?1:0,null);
      });
    }else if(program==='rclone' && argv[0]==='cat'){
      process.nextTick(()=>{
        const bytes=tamper?Buffer.from(stored.toString()+'X'):stored;
        c.stdout.end(bytes);c.emit('close',0,null);
      });
    }else throw Error('Unrecognized command: '+program);
    return c;
  }
  return {spawn,calls,getStored:()=>stored};
}
test('strict staging source, verified TLS, R2 bucket, private ACL and credentials',()=>{
  assert.deepEqual(validate(fake).violations,[]);
  for(const edit of [
    {PGUSER:'postgres.other'},
    {PGHOST:'localhost'},
    {PGHOST:'fake.pooler.supabase.com.attacker.test'},
    {PGSSLMODE:'require'},
    {PGPASSWORD:''},
    {R2_BACKUP_BUCKET:'somebody-elses-bucket'},
    {R2_BACKUP_REMOTE:'wrong'},
    {RCLONE_CONFIG_CAMPUSPOOLR2_ENDPOINT:'https://example.com'},
    {RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY:''},
    {RCLONE_CONFIG_CAMPUSPOOLR2_ACL:'public-read'},
    {R2_PRIVATE_BUCKET_CONFIRMED:''}
  ])assert.equal(validate({...fake,...edit}).ready,false);
  assert.doesNotMatch(JSON.stringify(validate({...fake,PGPASSWORD:''})),
    /NEVER_PRINT_THIS|SECRET_PRIVATE/);
});
test('no source URLs or private AGE identity inherited into child environment',()=>{
  const out=redactChildEnv({...fake,STAGING_DB_URL:'PRIVATE_URL',
    RESTORE_DB_URL:'PRIVATE_RESTORE_URL',AGE_IDENTITY:'PRIVATE_KEY'});
  for(const key of ['STAGING_DB_URL','RESTORE_DB_URL','AGE_IDENTITY'])
    assert.equal(out[key],undefined);
  assert.equal(out.PGPASSWORD,fake.PGPASSWORD);
});
test('each child receives only its own private credentials',()=>{
  const db=limitedEnv(fake,'pg'),age=limitedEnv(fake,'age'),cloud=limitedEnv(fake,'rclone');
  assert.equal(db.PGPASSWORD,fake.PGPASSWORD);
  assert.equal(db.RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY,undefined);
  assert.equal(age.PGPASSWORD,undefined);
  assert.equal(age.RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY,undefined);
  assert.equal(cloud.PGPASSWORD,undefined);
  assert.equal(cloud.RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY,
    fake.RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY);
  assert.throws(()=>limitedEnv(fake,'untrusted'),/UNKNOWN_CHILD_ROLE/);
});
test('unique per-run cloud object names never use predictable static location',()=>{
  const key=objectKey(new Date('2026-11-04T12:00:00Z'),
    Buffer.from('01'.repeat(16),'hex'));
  assert.equal(key,'staging/2026-11-04T12-00-00-000Z-'+
    '01010101010101010101010101010101.pgdump.age');
  assert.throws(()=>args([]),/USAGE/);
  assert.equal(args(['--preflight']),'--preflight');
  assert.equal(args(['--execute']),'--execute');
});
test('fake source->AGE->R2 streaming then ciphertext read-back succeeds',async()=>{
  const mock=fakeSpawner();
  const result=await backup(fake,{spawnImpl:mock.spawn,
    clock:new Date('2026-11-04T12:00:00Z'),random:Buffer.alloc(16,3)});
  assert.equal(result.status,'CIPHERTEXT_ROUNDTRIP_VERIFIED_RESTORE_NOT_TESTED');
  assert.ok(mock.getStored().toString().startsWith('ENCRYPTED_TEST_ONLY:'));
  assert.equal(result.ciphertextSHA256,
    crypto.createHash('sha256').update(mock.getStored()).digest('hex'));
  const dump=mock.calls.find(c=>c.program==='pg_dump');
  assert.deepEqual(dump.args,['--format=custom','--schema=public',
    '--schema=supabase_migrations','--no-password','--file=-']);
  assert.ok(!dump.args.some(x=>x.includes('SECRET')||x.includes('PASSWORD')));
  assert.equal(mock.calls.filter(c=>c.program==='rclone').length,2);
  assert.ok(mock.calls.filter(c=>c.program==='rclone').every(c=>c.args.includes('/dev/null')));
  assert.equal(mock.calls.some(c=>c.args.includes('--clean')),false);
});
test('missing operator consent and cloud corruption both fail closed',async()=>{
  await assert.rejects(backup({...fake,R2_EXECUTE_CONFIRMED:''},
    {spawnImpl:fakeSpawner().spawn}),/EXECUTE_NOT_AUTHORIZED/);
  await assert.rejects(backup(fake,
    {spawnImpl:fakeSpawner({tamper:true}).spawn}),/R2_READBACK_CHECKSUM_MISMATCH/);
  await assert.rejects(backup(fake,
    {spawnImpl:fakeSpawner({uploadFailure:true}).spawn}),/STREAMING_UPLOAD_FAILED/);
});
