// Security smoke tests operate only on a temporary SQLite database and local server.
// Run: npm run test:security
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const SQLiteCampusDatabase = require('./database');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', err => err ? reject(err) : resolve()));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startServer(port, dbPath) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      OTP_SECRET: crypto.randomBytes(32).toString('hex'),
      ENABLE_CLUSTER: 'false',
      CLUSTER_WORKERS: '1',
      DATABASE_PATH: dbPath,
      TRUSTED_PROXY_ADDRESSES: '',
      CORS_ALLOWED_ORIGINS: '',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1',
      SMTP_PASS: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local server startup timed out: '+output.slice(-1000))), 12000);
    const inspect = chunk => {
      output += String(chunk);
      if (output.includes('active on port')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('Server exited before ready: '+code+' '+output.slice(-1200)));
    });
  });
  await ready;
  return child;
}

test('CampusPool pre-deploy security smoke tests (isolated local database)', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-security-'));
  const dbPath = path.join(dir, 'security-test.db');
  const port = await freePort();
  let child;
  let localDB;
  const base = 'http://127.0.0.1:'+port;
  try {
    child = await startServer(port, dbPath);
    localDB = new SQLiteCampusDatabase(dbPath);

    await t.test('Health and basic public asset', async () => {
      const [health, index] = await Promise.all([fetch(base+'/healthz'), fetch(base+'/')]);
      assert.equal(health.status, 200);
      assert.equal(index.status, 200);
      assert.match(await index.text(), /CampusPool/i);
    });

    await t.test('Unknown files, secrets, backend source and APIs never return SPA HTML', async () => {
      for (const pathname of ['/server.js','/database.js','/.env.production','/campuspool.db','/unlisted-file.js']) {
        const res = await fetch(base+pathname);
        assert.equal(res.status, 404, pathname);
      }
    });

    await t.test('Disallowed cross-origin preflight and POST are rejected', async () => {
      const preflight = await fetch(base+'/api/rides', {
        method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' }
      });
      assert.equal(preflight.status, 403);
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
      const post = await fetch(base+'/api/rides', {
        method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(post.status, 403);
    });

    await t.test('Guests cannot read bookings, rides or change payment state', async () => {
      for (const target of ['/api/rides','/api/bookings','/api/my-rides','/api/user/settlement-status']) {
        assert.equal((await fetch(base+target)).status, 401, target);
      }
      const payment=await fetch(base+'/api/bookings/payment-status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(payment.status, 401);
    });

    await t.test('Production SMS endpoint fails closed (no fake delivery)', async () => {
      const res=await fetch(base+'/api/auth/send-phone-otp',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone:'9999999999'})
      });
      assert.equal(res.status,503);
      assert.equal((await res.json()).error,'SMS_PROVIDER_NOT_CONFIGURED');
    });

    await t.test('Malformed and oversized JSON are rejected', async () => {
      const bad=await fetch(base+'/api/auth/check-uniqueness',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{oops'
      });
      assert.equal(bad.status,400);
      const tooBig=await fetch(base+'/api/auth/check-uniqueness',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(66000)})
      });
      assert.equal(tooBig.status,413);
    });

    await t.test('Expiring verified tokens cannot be used after timeout', () => {
      localDB.saveOtp({
        id:crypto.randomUUID(),identifier:'someone@students.mituniversity.edu.in',
        type:'EMAIL',hashedOtp:'0'.repeat(64),attemptsLeft:5,
        expiresAt:Date.now()-5000,resendCooldownUntil:0,isVerified:true,
        token:'expired-token',createdAt:Date.now()-60000
      });
      assert.equal(localDB.findOtpByToken('someone@students.mituniversity.edu.in','expired-token'),null);
    });

    const person=localDB.createProfile({
      name:'Security Test Student',email:'security-test@students.mituniversity.edu.in',
      phone:'9876543210',dept:'Test Department'
    });
    const session=localDB.createSession(person.email);
    assert.ok(session && session.length>40);
    assert.equal(localDB.getSessionUser(session).email,person.email);
    const cookie={Cookie:'cp_session='+session};
    const identity=await fetch(base+'/api/auth/me',{headers:cookie});
    assert.equal(identity.status,200);
    const identityData=await identity.json();
    assert.equal(identityData.user.email,person.email);
    const csrf=identityData.csrfToken;
    assert.match(csrf,/^[a-f0-9]{64}$/);
    const authenticatedHeaders={...cookie,'X-CSRF-Token':csrf};
    await t.test('CSRF-protected mutations reject missing and invalid tokens', async () => {
      const invalid=await fetch(base+'/api/bookings/payment-status',{
        method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:'{}'
      });
      assert.equal(invalid.status,403);
      const invalidToken=await fetch(base+'/api/bookings/payment-status',{
        method:'POST',headers:{...cookie,'X-CSRF-Token':'0'.repeat(64),'Content-Type':'application/json'},body:'{}'
      });
      assert.equal(invalidToken.status,403);
    });

    await t.test('Verified sessions scope personal data to the account owner', async () => {
      const rides=await fetch(base+'/api/rides',{headers:cookie});
      assert.equal(rides.status,200);
      const own=await fetch(base+'/api/bookings?email='+encodeURIComponent(person.email),{headers:cookie});
      assert.equal(own.status,200);
      const other=await fetch(base+'/api/bookings?email=somebody@students.mituniversity.edu.in',{headers:cookie});
      assert.equal(other.status,403);
      const otherRides=await fetch(base+'/api/my-rides?email=somebody@students.mituniversity.edu.in',{headers:cookie});
      assert.equal(otherRides.status,403);
      const unknown=await fetch(base+'/api/not-real',{headers:cookie});
      assert.equal(unknown.status,404);
    });

    await t.test('Client-supplied owner email cannot create rides for other students', async () => {
      const rideFields={
        driverEmail:'other@students.mituniversity.edu.in',driverName:'Impersonated',
        vehicle:'Car',vehicleModel:'Swift',pickup:'Main Gate',destination:'Hadapsar',
        departureTime:'2026-11-05 17:30',seatsTotal:2,uberBenchmark:100,studentFare:60,driverPayout:54
      };
      const blocked=await fetch(base+'/api/rides',{
        method:'POST',headers:{...authenticatedHeaders,'Idempotency-Key':crypto.randomUUID(),
          'Content-Type':'application/json'},body:JSON.stringify(rideFields)
      });
      assert.equal(blocked.status,403);
      rideFields.driverEmail=person.email;
      const missingKey=await fetch(base+'/api/rides',{
        method:'POST',headers:{...authenticatedHeaders,'Content-Type':'application/json'},
        body:JSON.stringify(rideFields)
      });
      assert.equal(missingKey.status,428);
      assert.equal((await missingKey.json()).error,'IDEMPOTENCY_KEY_REQUIRED');
      const rideKey=crypto.randomUUID();
      const headers={...authenticatedHeaders,'Idempotency-Key':rideKey,'Content-Type':'application/json'};
      const created=await fetch(base+'/api/rides',{
        method:'POST',headers,body:JSON.stringify(rideFields)
      });
      assert.equal(created.status,201);
      const record=(await created.json()).ride;
      const retry=await fetch(base+'/api/rides',{
        method:'POST',headers,body:JSON.stringify(rideFields)
      });
      assert.equal(retry.status,201);
      assert.equal(retry.headers.get('Idempotency-Replayed'),'true');
      assert.equal((await retry.json()).ride.id,record.id);
      assert.equal(record.driverName,person.name);
      const wrongLocation=await fetch(base+'/api/rides/location',{
        method:'POST',headers:{...authenticatedHeaders,'Content-Type':'application/json'},
        body:JSON.stringify({rideId:record.id,lat:200,lng:74})
      });
      assert.equal(wrongLocation.status,400);
    });

    await t.test('Unverified payment and settlement claims cannot mark a transaction paid', async () => {
      const headers={...authenticatedHeaders,'Content-Type':'application/json'};
      for(const route of ['/api/bookings/payment-status','/api/driver/settle-commission']){
        const res=await fetch(base+route,{method:'POST',headers,body:JSON.stringify({bookingId:'made-up',driverEmail:person.email,amount:100,paymentStatus:'Paid'})});
        assert.equal(res.status,501);
      }
    });

    await t.test('Auth rate limit cannot be bypassed with forged X-Forwarded-For', async () => {
      let blocked=false;
      for(let i=0;i<15;i++){
        const res=await fetch(base+'/api/auth/login-request',{
          method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.'+(i+1)},
          body:JSON.stringify({identifier:'no-such-account@students.mituniversity.edu.in'})
        });
        if(res.status===429){blocked=true;break;}
      }
      assert.equal(blocked,true);
    });

    await t.test('Session logout revokes the cookie server-side', async () => {
      const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:authenticatedHeaders});
      assert.equal(logout.status,200);
      assert.equal(localDB.getSessionUser(session),null);
      assert.equal((await fetch(base+'/api/rides',{headers:cookie})).status,401);
    });

    await t.test('Expected DB indexes exist', () => {
      const rows=localDB.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name);
      for(const idx of ['idx_sessions_expiry','idx_bookings_passenger_created','idx_rides_driver_created','idx_rate_limits_reset']){
        assert.ok(rows.includes(idx),idx);
      }
    });

    await t.test('No committed environment file remains and Render uses secret inputs', () => {
      assert.equal(fs.existsSync(path.join(__dirname,'.env.production')),false);
      const yaml=fs.readFileSync(path.join(__dirname,'render.yaml'),'utf8');
      assert.match(yaml,/key: SMTP_PASS\s+sync: false/);
    });
  } finally {
    try { localDB?.db.close(); } catch {}
    if(child && !child.killed) child.kill('SIGTERM');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
