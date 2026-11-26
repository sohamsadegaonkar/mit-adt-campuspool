'use strict';
// Internal PostgreSQL foundation for issue #80. No HTTP routes are enabled.
// bindIssuedChallenge and recordVerifiedChallenge are trusted transaction hooks;
// never expose either as a public endpoint or accept challenge IDs from browsers.
const crypto=require('node:crypto');
const {normalize,OtpError}=require('./pg-store');
const {publicUser}=require('./identity');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const columns={
  email:{contact:'email',challenge:'email_challenge_id',verified:'email_verified_at',purpose:'signup_email'},
  sms:{contact:'phone',challenge:'phone_challenge_id',verified:'phone_verified_at',purpose:'signup_phone'}
};
function channelSpec(channel){
  if(!Object.hasOwn(columns,channel))throw new OtpError('INVALID_CHANNEL');
  return columns[channel];
}
function resumeHash(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new OtpError('REGISTRATION_UNAVAILABLE',403);
  return hash(value);
}
function state(row){
  return {email:row.email,phone:row.phone,emailVerified:!!row.email_verified_at,
    phoneVerified:!!row.phone_verified_at,expiresAt:row.expires_at};
}
function profile(name,dept){
  if(typeof name!=='string'||name.trim().length<2||name.length>100||/[<>\u0000-\u001f]/.test(name)||
     typeof dept!=='string'||!dept.trim()||dept.length>100||/[<>\u0000-\u001f]/.test(dept))
    throw new OtpError('INVALID_PROFILE');
}
class RegistrationDrafts{
  constructor(store,identity,{ttlSeconds}={}){
    if(!Number.isInteger(ttlSeconds)||ttlSeconds<300||ttlSeconds>604800)
      throw Error('Explicit approved registration retention required (300–604800 seconds)');
    this.store=store;this.identity=identity;this.ttlSeconds=ttlSeconds;
  }
  async start({email,phone}){
    const e=normalize('email',email),p=normalize('sms',phone),secret=token();
    const result=await this.store.pool.query(
      "INSERT INTO campus_pending_registrations(id,resume_hash,email,phone,expires_at) VALUES($1,$2,$3,$4,now()+($5::int*interval '1 second')) RETURNING *",
      [crypto.randomUUID(),hash(secret),e,p,this.ttlSeconds]);
    return {resumeToken:secret,state:state(result.rows[0])};
  }
  async _lock(client,resumeToken){
    const r=await client.query('SELECT * FROM campus_pending_registrations WHERE resume_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[resumeHash(resumeToken)]);
    if(!r.rows.length)throw new OtpError('REGISTRATION_UNAVAILABLE',403);
    return r.rows[0];
  }
  async status(resumeToken){
    return this.store.tx(async client=>state(await this._lock(client,resumeToken)));
  }
  async changeContacts(resumeToken,{email,phone}){
    const e=normalize('email',email),p=normalize('sms',phone);
    return this.store.tx(async client=>{
      const draft=await this._lock(client,resumeToken);
      const result=await client.query(
        'UPDATE campus_pending_registrations SET email=$2,phone=$3,'+
        'email_verified_at=CASE WHEN email=$2 THEN email_verified_at ELSE NULL END,'+
        'email_challenge_id=CASE WHEN email=$2 THEN email_challenge_id ELSE NULL END,'+
        'phone_verified_at=CASE WHEN phone=$3 THEN phone_verified_at ELSE NULL END,'+
        'phone_challenge_id=CASE WHEN phone=$3 THEN phone_challenge_id ELSE NULL END WHERE id=$1 RETURNING *',
        [draft.id,e,p]);
      return state(result.rows[0]);
    });
  }
  // Called within OTP issuance transaction, after locking the challenge.
  async bindIssuedChallenge(client,{resumeToken,channel,target,challengeId}){
    const spec=channelSpec(channel),normalized=normalize(channel,target);
    const challenge=await client.query(
      "SELECT id FROM otp_challenges WHERE id=$1 AND purpose=$2 AND channel=$3 AND target_hash=$4 AND state='pending' FOR UPDATE",
      [challengeId,spec.purpose,channel,this.store.targetDigest(channel,normalized)]);
    if(challenge.rows.length!==1)throw new OtpError('REGISTRATION_UNAVAILABLE',403);
    const draft=await this._lock(client,resumeToken);
    if(draft[spec.contact]!==normalized||draft[spec.verified])throw new OtpError('REGISTRATION_UNAVAILABLE',403);
    await client.query('UPDATE campus_pending_registrations SET '+spec.challenge+'=$2 WHERE id=$1',[draft.id,challengeId]);
  }
  // Called after successful OTP validation in the SAME transaction. Consumes
  // the short-lived proof; it cannot then be used by legacy registration.
  async recordVerifiedChallenge(client,{resumeToken,channel,target,challengeId}){
    const spec=channelSpec(channel),normalized=normalize(channel,target);
    const challenge=await client.query(
      "SELECT id FROM otp_challenges WHERE id=$1 AND purpose=$2 AND channel=$3 AND target_hash=$4 AND state='verified' AND proof_expires_at>now() AND proof_consumed_at IS NULL FOR UPDATE",
      [challengeId,spec.purpose,channel,this.store.targetDigest(channel,normalized)]);
    if(challenge.rows.length!==1)throw new OtpError('REGISTRATION_UNAVAILABLE',403);
    const draft=await this._lock(client,resumeToken);
    if(draft[spec.contact]!==normalized||draft[spec.challenge]!==challengeId||draft[spec.verified])
      throw new OtpError('REGISTRATION_UNAVAILABLE',403);
    const result=await client.query('UPDATE campus_pending_registrations SET '+spec.verified+'=now() WHERE id=$1 RETURNING *',[draft.id]);
    await client.query('UPDATE otp_challenges SET proof_consumed_at=now(),updated_at=now() WHERE id=$1',[challengeId]);
    return state(result.rows[0]);
  }
  async finalize(resumeToken,{name,dept}){
    profile(name,dept);
    return this.store.tx(async client=>{
      const draft=await this._lock(client,resumeToken);
      if(!draft.email_verified_at||!draft.phone_verified_at)throw new OtpError('VERIFICATION_REQUIRED',403);
      let result;
      try{
        result=await client.query('INSERT INTO campus_users(id,name,email,phone,dept,is_verified,verified_at) VALUES($1,$2,$3,$4,$5,true,now()) RETURNING *',
          [crypto.randomUUID(),name.trim(),draft.email,draft.phone,dept.trim()]);
      }catch(error){
        if(error.code==='23505')throw new OtpError('ACCOUNT_ALREADY_EXISTS',409);
        throw error;
      }
      const user=publicUser(result.rows[0]);
      const sessionToken=await this.identity._createSession(client,user.id);
      await client.query("INSERT INTO campus_identity_audit(user_id,event_type) VALUES($1,'registered')",[user.id]);
      await client.query('UPDATE campus_pending_registrations SET consumed_at=now() WHERE id=$1',[draft.id]);
      return {user,token:sessionToken};
    });
  }
  async purgeExpired(limit=100){
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid purge limit');
    const result=await this.store.pool.query(
      'WITH expired AS (SELECT id FROM campus_pending_registrations WHERE expires_at<=now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM campus_pending_registrations d USING expired WHERE d.id=expired.id',[limit]);
    return result.rowCount;
  }
}
module.exports={RegistrationDrafts};
