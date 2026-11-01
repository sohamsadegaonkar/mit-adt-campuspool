'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
async function migrate({
  connectionString=process.env.OTP_DATABASE_URL,
  ssl=process.env.OTP_DB_SSL==='true'
}={}) {
  if(!connectionString)throw Error('OTP_DATABASE_URL is required for migration');
  const pool=new Pool({connectionString,ssl:ssl?{rejectUnauthorized:true}:undefined,
    max:1,connectionTimeoutMillis:5000});
  try{
    const sql=fs.readFileSync(path.join(__dirname,'migrations','001_otp.sql'),'utf8');
    await pool.query(sql);
    const identitySql=fs.readFileSync(path.join(__dirname,'migrations','002_users_sessions.sql'),'utf8');
    await pool.query(identitySql);
    console.log('[OTP MIGRATION] Applied Stage 1 OTP + identity schemas');
  } finally {
    await pool.end();
  }
}
if(require.main===module)migrate().catch(error=>{
  console.error('[OTP MIGRATION] Failed:',error.code||'DATABASE_ERROR');
  process.exitCode=1;
});
module.exports={migrate};
