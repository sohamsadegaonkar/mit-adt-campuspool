'use strict';
const crypto=require('node:crypto');
const {normalize,OtpError}=require('./pg-store');
const SESSION_MS=7*24*60*60*1000;
function sha(token){return crypto.createHash('sha256').update(token).digest('hex');}
function publicUser(row){
  if(!row)return null;
  return {id:row.id,name:row.name,email:row.email,phone:row.phone,dept:row.dept,
    isVerified:row.is_verified,createdAt:row.created_at};
}
class PgIdentity {
  constructor(store){this.store=store;this.pool=store.pool;}
  async getProfileByEmail(email){
    if(typeof email!=='string')return null;
    const {rows}=await this.pool.query('SELECT * FROM campus_users WHERE email=$1',[email.trim().toLowerCase()]);
    return publicUser(rows[0]);
  }
  async getProfileByIdentifier(identifier){
    if(typeof identifier!=='string')return null;
    const value=identifier.trim().toLowerCase();
    const phone=value.replace(/\D/g,'').slice(-10);
    const {rows}=await this.pool.query('SELECT * FROM campus_users WHERE email=$1 OR phone=$2 LIMIT 1',[value,phone]);
    return publicUser(rows[0]);
  }
  async checkUniqueness(name,email,phone){
    const {rows}=await this.pool.query('SELECT 1 FROM campus_users WHERE email=$1 OR phone=$2 LIMIT 1',
      [normalize('email',email),normalize('sms',phone)]);
    return {unique:rows.length===0};
  }
  async phoneExists(phone){
    const {rows}=await this.pool.query('SELECT 1 FROM campus_users WHERE phone=$1 LIMIT 1',[normalize('sms',phone)]);
    return rows.length>0;
  }
  async _createSession(client,userId){
    const token=crypto.randomBytes(32).toString('base64url');
    await client.query(
      "INSERT INTO campus_sessions(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [sha(token),userId]);
    return token;
  }
  async sessionForEmail(email){
    const user=await this.getProfileByEmail(email);
    if(!user||!user.isVerified)return null;
    return this.store.tx(async client=>{
      const token=await this._createSession(client,user.id);
      await client.query("INSERT INTO campus_identity_audit(user_id,event_type) VALUES($1,'login')",[user.id]);
      return token;
    });
  }
  async getSessionUser(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    const {rows}=await this.pool.query([
      'SELECT u.* FROM campus_sessions s JOIN campus_users u ON u.id=s.user_id',
      'WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.is_verified=true'
    ].join(' '),[sha(token)]);
    return publicUser(rows[0]);
  }
  async revokeSession(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return;
    await this.store.tx(async client=>{
      const r=await client.query(
        'UPDATE campus_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING user_id',
        [sha(token)]);
      if(r.rows.length)await client.query("INSERT INTO campus_identity_audit(user_id,event_type) VALUES($1,'logout')",[r.rows[0].user_id]);
    });
  }
  // A PostgreSQL-only transaction. Atomic with both OTP proof redemptions.
  async register({name,email,phone,dept,emailProof,phoneProof}){
    const e=normalize('email',email),p=normalize('sms',phone);
    if(typeof name!=='string'||name.trim().length<2||name.length>100||/[<>\u0000-\u001f]/.test(name)||
       typeof dept!=='string'||!dept.trim()||dept.length>100||/[<>\u0000-\u001f]/.test(dept)){
      throw new OtpError('INVALID_PROFILE',400);
    }
    function proofHash(proof){
      if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof))throw new OtpError('INVALID_PROOF',403);
      return sha(proof);
    }
    const params=[
      this.store.targetDigest('email',e),proofHash(emailProof),
      this.store.targetDigest('sms',p),proofHash(phoneProof)
    ];
    return this.store.tx(async client=>{
      const {rows}=await client.query([
        'SELECT id FROM otp_challenges WHERE',
        "((purpose='signup_email' AND channel='email' AND target_hash=$1 AND proof_hash=$2)",
        "OR (purpose='signup_phone' AND channel='sms' AND target_hash=$3 AND proof_hash=$4))",
        "AND state='verified' AND proof_expires_at>now() AND proof_consumed_at IS NULL",
        'ORDER BY purpose FOR UPDATE'
      ].join(' '),params);
      if(rows.length!==2)throw new OtpError('VERIFICATION_REQUIRED',403);
      let result;
      try{
        result=await client.query([
          'INSERT INTO campus_users(id,name,email,phone,dept,is_verified,verified_at)',
          'VALUES($1,$2,$3,$4,$5,true,now()) RETURNING *'
        ].join(' '),[crypto.randomUUID(),name.trim(),e,p,dept.trim()]);
      }catch(err){
        if(err.code==='23505')throw new OtpError('ACCOUNT_ALREADY_EXISTS',409);
        throw err;
      }
      const user=publicUser(result.rows[0]);
      await client.query('UPDATE otp_challenges SET proof_consumed_at=now(),updated_at=now() WHERE id=ANY($1::uuid[])',
        [rows.map(x=>x.id)]);
      const token=await this._createSession(client,user.id);
      await client.query("INSERT INTO campus_identity_audit(user_id,event_type) VALUES($1,'registered')",[user.id]);
      return {user,token};
    });
  }
}
module.exports={PgIdentity,publicUser};
