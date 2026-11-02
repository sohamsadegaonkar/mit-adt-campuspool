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
    const hardeningSql=fs.readFileSync(path.join(__dirname,'migrations','003_supabase_private_tables.sql'),'utf8');
    await pool.query(hardeningSql);
    const indexSql=fs.readFileSync(path.join(__dirname,'migrations','004_audit_user_index.sql'),'utf8');
    await pool.query(indexSql);
    const roleSql=fs.readFileSync(path.join(__dirname,'migrations','005_staging_backend_role.sql'),'utf8');
    await pool.query(roleSql);
    console.log('[OTP MIGRATION] Applied OTP, identity, and private-table security migrations');
  } finally {
    await pool.end();
  }
}
if(require.main===module)migrate().catch(error=>{
  console.error('[OTP MIGRATION] Failed:',error.code||'DATABASE_ERROR');
  process.exitCode=1;
});
module.exports={migrate};
