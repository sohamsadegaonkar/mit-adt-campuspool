'use strict';
const {Pool}=require('pg');
// Optional maintenance job. Run daily via a scheduler; it is NOT auto-scheduled.
async function prune({
  connectionString=process.env.OTP_DATABASE_URL,
  ssl=process.env.OTP_DB_SSL==='true'
}={}) {
  if(!connectionString)throw Error('OTP_DATABASE_URL required');
  const pool=new Pool({connectionString,ssl:ssl?{rejectUnauthorized:true}:undefined,
    max:1,connectionTimeoutMillis:5000});
  try {
    const oldChallenges=await pool.query([
      'DELETE FROM otp_challenges WHERE expires_at < now() - interval',
      "'24 hours' AND (proof_expires_at IS NULL OR proof_expires_at < now() - interval '24 hours')"
    ].join(' '));
    const oldBuckets=await pool.query(
      "DELETE FROM otp_rate_buckets WHERE expires_at < now() - interval '24 hours'");
    const expiredReceipts=await pool.query(
      'DELETE FROM public.campus_idempotency_keys WHERE expires_at<=now()');
    console.log('[OTP] Expired records pruned:',{
      challenges:oldChallenges.rowCount,rateBuckets:oldBuckets.rowCount,
      idempotencyReceipts:expiredReceipts.rowCount});
  } finally { await pool.end(); }
}
if(require.main===module)prune().catch(error=>{
  console.error('[OTP] Cleanup failed:',error.code||'DATABASE_ERROR');
  process.exitCode=1;
});
module.exports={prune};
