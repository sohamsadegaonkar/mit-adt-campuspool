'use strict';
// Only disposable LOCAL PostgreSQL. Never use staging/production here.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {PgIdempotencyStore,IdempotencyError}=require('./idempotency');
const {migrate}=require('./stage1-otp/migrate');

const connectionString=process.env.OTP_DATABASE_URL;
if(connectionString && !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname))
  throw Error('Idempotency integration tests refuse non-local PostgreSQL connections');

test('PostgreSQL serializes concurrent identical keys and rolls back effect + receipt',
  {skip:!connectionString?'requires disposable local PostgreSQL':false},async()=>{
    await migrate({connectionString,ssl:false});
    const pool=new Pool({connectionString,ssl:false,max:4,connectionTimeoutMillis:5000});
    const storeA=new PgIdempotencyStore(pool),storeB=new PgIdempotencyStore(pool);
    const actor=crypto.randomUUID(),otherActor=crypto.randomUUID();
    const key=crypto.randomUUID(),effectId=crypto.randomUUID();
    const route='POST /api/rides',body={a:1,other:{z:2,b:3}};
    let executions=0;
    const input={actor,route,key,body};
    try {
      await pool.query([
        'CREATE TABLE IF NOT EXISTS public.campus_test_idempotency_effects (',
        'id UUID PRIMARY KEY, hits INTEGER NOT NULL CHECK(hits >= 1))'
      ].join(' '));
      const work=async client=>{
        executions++;
        await client.query('SELECT pg_sleep(0.025)');
        const updated=await client.query([
          'INSERT INTO public.campus_test_idempotency_effects(id,hits) VALUES($1,1)',
          'ON CONFLICT(id) DO UPDATE SET hits=campus_test_idempotency_effects.hits+1',
          'RETURNING hits'
        ].join(' '),[effectId]);
        return {status:201,body:{success:true,effectId,hits:updated.rows[0].hits}};
      };
      const [first,second]=await Promise.all([
        storeA.run({...input,execute:work}),
        storeB.run({...input,body:{other:{b:3,z:2},a:1},execute:work})
      ]);
      assert.equal(executions,1,'Exactly one callback must execute for concurrently duplicated keys');
      assert.equal(Number(first.replayed)+Number(second.replayed),1);
      assert.equal(first.status,201);assert.equal(second.status,201);
      assert.deepEqual(first.body,second.body);
      const check=await pool.query('SELECT hits FROM public.campus_test_idempotency_effects WHERE id=$1',[effectId]);
      assert.equal(check.rows[0].hits,1,'One committed DB business effect');
      await assert.rejects(storeA.run({...input,body:{a:2},execute:work}),
        e=>e instanceof IdempotencyError && e.code==='IDEMPOTENCY_KEY_REUSED');
      assert.equal(executions,1);

      const rollbackId=crypto.randomUUID(),rollbackKey=crypto.randomUUID();
      await assert.rejects(storeA.run({...input,key:rollbackKey,execute:async client=>{
        await client.query('INSERT INTO public.campus_test_idempotency_effects(id,hits) VALUES($1,1)',[rollbackId]);
        throw Error('Simulated failure after SQL write');
      }}),/Simulated failure/);
      const after=await pool.query('SELECT hits FROM public.campus_test_idempotency_effects WHERE id=$1',[rollbackId]);
      assert.equal(after.rows.length,0,'Failed business effect rolled back');
      const hash=crypto.createHash('sha256').update('campus-user:'+actor).digest('hex');
      const receipt=await pool.query('SELECT 1 FROM public.campus_idempotency_keys WHERE actor_hash=$1 AND request_key=$2',[hash,rollbackKey]);
      assert.equal(receipt.rows.length,0,'Failed key reservation rolled back');

      const separate=await storeB.run({...input,actor:otherActor,execute:async()=>({
        status:201,body:{success:true,differentActor:true}
      })});
      assert.equal(separate.replayed,false);
      assert.equal(separate.body.differentActor,true);

      // Authorized staging backend role can query the table; anon/authenticated
      // are denied direct SQL table rights by the migration.
      const grants=await pool.query([
        'SELECT has_table_privilege($1,$2,\'SELECT\') AS can_read'
      ].join(' '),['campuspool_staging_app','public.campus_idempotency_keys']);
      assert.equal(grants.rows[0].can_read,true);
      const rls=await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.campus_idempotency_keys'::regclass");
      assert.equal(rls.rows[0].relrowsecurity,true);
    }finally{
      await pool.query('DELETE FROM public.campus_test_idempotency_effects WHERE id=ANY($1::uuid[])',
        [[effectId]]).catch(()=>{});
      await pool.query('DROP TABLE IF EXISTS public.campus_test_idempotency_effects').catch(()=>{});
      const hashes=[actor,otherActor].map(a=>crypto.createHash('sha256').update('campus-user:'+a).digest('hex'));
      await pool.query('DELETE FROM public.campus_idempotency_keys WHERE actor_hash=ANY($1::text[])',[hashes]).catch(()=>{});
      await pool.end();
    }
  });
