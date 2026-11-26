'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const https=require('node:https');
const {spawn,execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const db=new URL(process.env.OTP_DATABASE_URL||'http://invalid');
if(process.env.QA_DISPOSABLE_REGISTRATION!=='YES'||db.hostname!=='127.0.0.1'||
   db.pathname!=='/campuspool_registration_browser_test'||
   !process.env.REGISTRATION_FIXTURE_DIR)
  throw Error('Registration browser tests require disposable loopback database');
const dir=process.env.REGISTRATION_FIXTURE_DIR;
const origin='https://127.0.0.1:4199',upstream=4198;
(async()=>{
  const pool=new Pool({connectionString:db.href});
  try{
    for(const filename of ['001_otp.sql','002_users_sessions.sql','003_supabase_private_tables.sql','004_audit_user_index.sql','005_staging_backend_role.sql','015_pending_registration.sql'])
      await pool.query(fs.readFileSync(path.join(__dirname,'..','stage1-otp','migrations',filename),'utf8'));
  }finally{await pool.end();}
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const key=path.join(dir,'tls.key'),cert=path.join(dir,'tls.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,
    '-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const child=spawn(process.execPath,['-r',path.join(__dirname,'registration-provider-fixture.cjs'),'server.js'],{
    env:{...process.env,PORT:String(upstream),NODE_ENV:'production',APP_ENV:'staging',
      ENABLE_CLUSTER:'false',AUTH_OTP_BACKEND:'postgres',RIDES_BACKEND:'sqlite',
      MOBILITY_MATCHING_ENABLED:'false',OTP_DB_SSL:'false',ALLOW_DEV_OTP:'false',
      OTP_HMAC_KEY:'synthetic-registration-browser-hmac-not-live',
      OTP_SECRET:'synthetic-registration-browser-otp-not-live',
      STAGING_BASIC_AUTH_PASSWORD:'synthetic-registration-browser-basic-not-live',
      REGISTRATION_RESUME_ENABLED:'true',REGISTRATION_RETENTION_SECONDS:'3600',
      REGISTRATION_ORIGIN:origin,DATABASE_PATH:path.join(dir,'synthetic.sqlite'),
      EMAIL_PROVIDER:'disabled',SMS_PROVIDER:'disabled',PLACES_AUTOCOMPLETE_ENABLED:'false'},
    stdio:['ignore','inherit','inherit']
  });
  const proxy=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
    const forward=http.request({hostname:'127.0.0.1',port:upstream,method:req.method,path:req.url,
      headers:{...req.headers,host:'127.0.0.1:4199'}},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    forward.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.pipe(forward);
  });
  child.on('exit',code=>{proxy.close();process.exit(code||1);});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{child.kill('SIGTERM');proxy.close(()=>process.exit(0));});
  proxy.listen(4199,'127.0.0.1');
})().catch(error=>{console.error('Registration fixture startup failed:',error.code||error.message);process.exitCode=1;});
