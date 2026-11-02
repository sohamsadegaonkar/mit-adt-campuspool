'use strict';
// Shared PostgreSQL OTP store. Code/recipient secrets never enter the database.
const crypto = require('node:crypto');
const { Pool } = require('pg');
const TTL_SECONDS=300, COOLDOWN_SECONDS=60, PROOF_SECONDS=600, MAX_ATTEMPTS=5;
const PURPOSES=new Set(['login','signup_email','signup_phone']);

class OtpError extends Error {
  constructor(code,status=400,retryAfter=null) {
    super(code); this.code=code; this.status=status; this.retryAfter=retryAfter;
  }
}
function normalize(channel,value) {
  if(typeof value!=='string') throw new OtpError('INVALID_IDENTIFIER');
  if(channel==='email') {
    const x=value.trim().toLowerCase();
    if(x.length>254 || !/^[a-z0-9._%+-]+@(students\.)?mituniversity\.edu\.in$/.test(x)) throw new OtpError('INVALID_EMAIL');
    return x;
  }
  if(channel==='sms') {
    const digits=value.replace(/\D/g,'');
    const x=digits.length===12 && digits.startsWith('91')?digits.slice(2):digits;
    if(!/^[6-9][0-9]{9}$/.test(x)) throw new OtpError('INVALID_PHONE');
    return x;
  }
  throw new OtpError('INVALID_CHANNEL');
}
function checkPurpose(purpose,channel) {
  if(!PURPOSES.has(purpose) || (purpose==='signup_phone') !== (channel==='sms')) throw new OtpError('INVALID_PURPOSE');
}
function retrySeconds(date) { return Math.max(1,Math.ceil((new Date(date).getTime()-Date.now())/1000)); }

class PgOtpStore {
  constructor({connectionString=process.env.OTP_DATABASE_URL,hmacKey=process.env.OTP_HMAC_KEY,
               ssl=process.env.OTP_DB_SSL==='true',pool,maxConnections=5}={}) {
    if(typeof hmacKey!=='string'||hmacKey.length<32) throw Error('OTP_HMAC_KEY must be a private random secret (32+ characters)');
    if(!pool&&!connectionString) throw Error('OTP_DATABASE_URL must be configured for PostgreSQL OTP');
    this.key=hmacKey;
    this.pool=pool||new Pool({connectionString,ssl:ssl?{rejectUnauthorized:true}:undefined,
      max:maxConnections,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
    this.ownsPool=!pool;
  }
  digest(label,data) {
    return crypto.createHmac('sha256',this.key).update(label).update(':').update(String(data)).digest('hex');
  }
  targetDigest(channel,target) {return this.digest('identity',channel+':'+target);}
  codeDigest(id,purpose,channel,targetHash,code) {
    return this.digest('otp',[id,purpose,channel,targetHash,code].join(':'));
  }
  async ready() {
    await this.pool.query('SELECT 1 FROM otp_challenges LIMIT 0');
    await this.pool.query('SELECT 1 FROM otp_rate_buckets LIMIT 0');
  }
  async close() {if(this.ownsPool) await this.pool.end();}
  async tx(fn) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');const result=await fn(client);
      await client.query('COMMIT');return result;
    } catch(e) {try {await client.query('ROLLBACK');} catch(_){} throw e;}
    finally {client.release();}
  }
  async rate(client,label,key,limit,windowSeconds) {
    const bucket=this.digest('rate:'+label,key);
    const sql=[
      'INSERT INTO otp_rate_buckets (bucket_key,attempts,expires_at)',
      "VALUES ($1,1,now()+($2::int * interval '1 second'))",
      'ON CONFLICT (bucket_key) DO UPDATE SET',
      'attempts=CASE WHEN otp_rate_buckets.expires_at<=now() THEN 1 ELSE otp_rate_buckets.attempts+1 END,',
      "expires_at=CASE WHEN otp_rate_buckets.expires_at<=now() THEN now()+($2::int * interval '1 second')",
      'ELSE otp_rate_buckets.expires_at END RETURNING attempts,expires_at'
    ].join(' ');
    const r=await client.query(sql,[bucket,windowSeconds]);
    if(r.rows[0].attempts>limit) throw new OtpError('RATE_LIMITED',429,retrySeconds(r.rows[0].expires_at));
  }
  // Public login requests consume shared rate buckets whether or not an
  // account exists. This prevents unknown identifiers bypassing throttling.
  async throttleLoginLookup({identifier,ip}) {
    const value = String(identifier || '').trim().toLowerCase();
    if (value.length < 3 || value.length > 254) throw new OtpError('INVALID_IDENTIFIER');
    await this.tx(async client => {
      await this.rate(client, 'login-lookup-ip', ip || 'unknown', 12, 600);
      await this.rate(client, 'login-lookup-target', this.digest('login-target',value), 4, 600);
      // Identical cooldown for registered and unregistered identifiers.
      await this.rate(client, 'login-lookup-cooldown', this.digest('login-target',value), 1, 60);
    });
  }

  async issue({purpose,channel,target,ip,deliver}) {
    checkPurpose(purpose,channel);
    const normalized=normalize(channel,target);
    if(typeof deliver!=='function') throw Error('Delivery callback required');
    const targetHash=this.targetDigest(channel,normalized);
    const id=crypto.randomUUID();
    const code=crypto.randomInt(100000,1000000).toString();
    const hashed=this.codeDigest(id,purpose,channel,targetHash,code);
    // Count even rejected resends; otherwise cooldown can bypass IP throttling.
    await this.tx(async client=>{
      await this.rate(client,'send-ip',ip||'unknown',10,60);
      await this.rate(client,'send-target',targetHash,4,600);
    });
    await this.tx(async client=>{
      const sql=[
        'INSERT INTO otp_challenges',
        '(id,purpose,channel,target_hash,code_hmac,state,expires_at,resend_at)',
        "VALUES ($1::uuid,$2,$3,$4,$5,'pending',",
        "now()+($6::int*interval '1 second'),now()+($7::int*interval '1 second'))",
        'ON CONFLICT (purpose,channel,target_hash) DO UPDATE SET',
        'id=EXCLUDED.id,code_hmac=EXCLUDED.code_hmac,state=EXCLUDED.state,',
        'expires_at=EXCLUDED.expires_at,resend_at=EXCLUDED.resend_at,',
        'attempt_count=0,verified_at=NULL,proof_hash=NULL,proof_expires_at=NULL,',
        'proof_consumed_at=NULL,updated_at=now()',
        'WHERE otp_challenges.resend_at<=now() RETURNING id'
      ].join(' ');
      const r=await client.query(sql,[id,purpose,channel,targetHash,hashed,TTL_SECONDS,COOLDOWN_SECONDS]);
      if(r.rows.length!==1) throw new OtpError('RESEND_COOLDOWN',429,COOLDOWN_SECONDS);
    });
    // Provider I/O must happen outside SQL locks; pending codes cannot verify.
    try {
      const result=await deliver({target:normalized,code,purpose,channel});
      if(!result?.accepted) throw Error('PROVIDER_REJECTED');
    } catch(_) {
      await this.pool.query("UPDATE otp_challenges SET state='failed',updated_at=now() WHERE id=$1 AND state='pending'",[id]);
      throw new OtpError('DELIVERY_UNAVAILABLE',503);
    }
    const active=await this.pool.query(
      "UPDATE otp_challenges SET state='active',updated_at=now() WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING id",[id]);
    if(!active.rowCount) throw new OtpError('DELIVERY_EXPIRED',503);
    return {ok:true,expiresInSeconds:TTL_SECONDS,resendAfterSeconds:COOLDOWN_SECONDS};
  }
  async verify({purpose,channel,target,code,ip}) {
    checkPurpose(purpose,channel);
    const normalized=normalize(channel,target);
    if(typeof code!=='string'||!/^[0-9]{6}$/.test(code)) throw new OtpError('INVALID_OTP_FORMAT');
    const targetHash=this.targetDigest(channel,normalized);
    // Persist abuse counters even when a code is expired, locked or invalid.
    await this.tx(async client=>{
      await this.rate(client,'verify-ip',ip||'unknown',30,60);
      await this.rate(client,'verify-target',targetHash,15,600);
    });
    return this.tx(async client=>{
      const r=await client.query(
        'SELECT id,code_hmac,state,attempt_count,expires_at FROM otp_challenges WHERE purpose=$1 AND channel=$2 AND target_hash=$3 FOR UPDATE',
        [purpose,channel,targetHash]);
      if(!r.rows.length) throw new OtpError('NO_OTP_REQUESTED');
      const c=r.rows[0];
      if(c.state==='verified') throw new OtpError('OTP_ALREADY_USED');
      if(c.state==='locked'||c.attempt_count>=MAX_ATTEMPTS) throw new OtpError('OTP_LOCKED',403);
      if(c.state!=='active') throw new OtpError('OTP_UNAVAILABLE');
      if(new Date(c.expires_at).getTime()<=Date.now()) throw new OtpError('OTP_EXPIRED');
      const expected=this.codeDigest(c.id,purpose,channel,targetHash,code);
      const valid=crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(c.code_hmac,'hex'));
      if(!valid) {
        const attempts=c.attempt_count+1;
        await client.query("UPDATE otp_challenges SET attempt_count=$2::integer,state=CASE WHEN $2::integer >= $3::integer THEN 'locked' ELSE 'active' END,updated_at=now() WHERE id=$1",
          [c.id,attempts,MAX_ATTEMPTS]);
        // Return a failed result rather than throwing: failed-attempt update must COMMIT.
        return {ok:false,error:attempts>=MAX_ATTEMPTS?'OTP_LOCKED':'INVALID_OTP',
          attemptsRemaining:Math.max(0,MAX_ATTEMPTS-attempts)};
      }
      const proof=crypto.randomBytes(32).toString('base64url');
      const proofHash=crypto.createHash('sha256').update(proof).digest('hex');
      await client.query([
        "UPDATE otp_challenges SET state='verified',verified_at=now(),",
        "proof_hash=$2,proof_expires_at=now()+($3::int * interval '1 second'),updated_at=now() WHERE id=$1"
      ].join(' '),[c.id,proofHash,PROOF_SECONDS]);
      return {ok:true,proof};
    });
  }
  async consumeRegistration({email,emailProof,phone,phoneProof}) {
    const e=normalize('email',email),p=normalize('sms',phone);
    const hashProof=token=>{
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new OtpError('INVALID_PROOF',403);
      return crypto.createHash('sha256').update(token).digest('hex');
    };
    const params=[this.targetDigest('email',e),hashProof(emailProof),
      this.targetDigest('sms',p),hashProof(phoneProof)];
    return this.tx(async client=>{
      const r=await client.query([
        'SELECT id FROM otp_challenges WHERE',
        "((purpose='signup_email' AND channel='email' AND target_hash=$1 AND proof_hash=$2)",
        "OR (purpose='signup_phone' AND channel='sms' AND target_hash=$3 AND proof_hash=$4))",
        "AND state='verified' AND proof_expires_at>now() AND proof_consumed_at IS NULL",
        'ORDER BY purpose FOR UPDATE'
      ].join(' '),params);
      if(r.rows.length!==2) throw new OtpError('VERIFICATION_REQUIRED',403);
      await client.query(
        'UPDATE otp_challenges SET proof_consumed_at=now(),updated_at=now() WHERE id=ANY($1::uuid[])',
        [r.rows.map(x=>x.id)]);
      return true;
    });
  }
}
module.exports={PgOtpStore,OtpError,normalize,TTL_SECONDS,COOLDOWN_SECONDS,PROOF_SECONDS,MAX_ATTEMPTS};
