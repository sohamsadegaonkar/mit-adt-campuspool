// =========================================================================
// MIT ADT CampusPool - Production Backend Server
// Real-Time SMTP Email OTP, SMS Gateway & ACID Persistent Database
// Enforces Strict Uniqueness on Student Name, Email, and Mobile Number
// =========================================================================

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const smsProvider = require('./sms-provider');
const { PgIdempotencyStore, SqliteIdempotencyStore, IdempotencyError } = require('./idempotency');
// Only these authenticated mutations can return a bounded, read-only receipt
// when the standard per-IP mutation rate limit has already been exhausted.
const IDEMPOTENT_MUTATION_PATHS = new Set([
  '/api/rides', '/api/bookings', '/api/rides/cancel', '/api/rides/journey',
  '/api/bookings/cancel', '/api/mobility/intents',
  '/api/mobility/intents/cancel'
]);
const AUTH_OTP_BACKEND = process.env.AUTH_OTP_BACKEND || 'sqlite';
if (!['sqlite', 'postgres'].includes(AUTH_OTP_BACKEND)) throw new Error('AUTH_OTP_BACKEND must be sqlite or postgres');
// Opt-in only. Production/staging stay on the legacy Rides backend unless
// their separate environments explicitly enable PostgreSQL for Rides.
const RIDES_BACKEND = process.env.RIDES_BACKEND || 'sqlite';
if (!['sqlite', 'postgres'].includes(RIDES_BACKEND)) throw new Error('RIDES_BACKEND must be sqlite or postgres');
if (RIDES_BACKEND === 'postgres' && AUTH_OTP_BACKEND !== 'postgres')
  throw new Error('PostgreSQL Rides requires PostgreSQL identity backend');
// Optional pilot policy: only verified PostgreSQL rides routes, not OTP,
// GPS, billable providers, public APIs or legacy SQLite identity.
const RIDES_JOURNEY_ENABLED_VALUE=process.env.RIDES_JOURNEY_ENABLED||'false';
if(!['true','false'].includes(RIDES_JOURNEY_ENABLED_VALUE))throw Error('RIDES_JOURNEY_ENABLED must be true or false');
const RIDES_JOURNEY_ENABLED=RIDES_JOURNEY_ENABLED_VALUE==='true';
if(RIDES_JOURNEY_ENABLED && RIDES_BACKEND!=='postgres')throw Error('Journey lifecycle requires PostgreSQL Rides');
const BOARDING_PIN_ENABLED_VALUE=process.env.BOARDING_PIN_ENABLED||'false';
if(!['true','false'].includes(BOARDING_PIN_ENABLED_VALUE))throw Error('BOARDING_PIN_ENABLED must be true or false');
const BOARDING_PIN_ENABLED=BOARDING_PIN_ENABLED_VALUE==='true';
if(BOARDING_PIN_ENABLED && (!RIDES_JOURNEY_ENABLED||RIDES_BACKEND!=='postgres'))
  throw Error('Boarding PIN requires PostgreSQL rides and journey reporting');
const FREE_RIDES_PILOT_VALUE=process.env.FREE_RIDES_PILOT||'false';
if(!['true','false'].includes(FREE_RIDES_PILOT_VALUE))throw Error('FREE_RIDES_PILOT must be true or false');
const FREE_RIDES_PILOT=FREE_RIDES_PILOT_VALUE==='true';
if(FREE_RIDES_PILOT && RIDES_BACKEND!=='postgres')throw Error('Free rides pilot requires PostgreSQL Rides');
const CAMPUS_WIFI_FAIRNESS = process.env.CAMPUS_WIFI_FAIRNESS === 'true';
if (CAMPUS_WIFI_FAIRNESS && RIDES_BACKEND !== 'postgres')
  throw new Error('Campus Wi-Fi fairness requires PostgreSQL Rides');
const FAIR_READ_PATHS = new Set(['/api/rides','/api/bookings','/api/my-rides','/api/user/settlement-status']);
const FAIR_WRITE_PATHS = new Set(['/api/rides','/api/bookings','/api/rides/cancel','/api/bookings/cancel','/api/rides/journey','/api/bookings/boarding-pin','/api/bookings/verify-boarding-pin']);
const MOBILITY_MATCHING_ENABLED = process.env.MOBILITY_MATCHING_ENABLED === 'true';
if(FREE_RIDES_PILOT && MOBILITY_MATCHING_ENABLED)throw Error('Free rides pilot requires mobility matching disabled');
// Cost-bearing Places calls stay OFF without an explicitly approved server flag.
const PLACES_AUTOCOMPLETE_ENABLED = process.env.PLACES_AUTOCOMPLETE_ENABLED === 'true';
const { createPlacesClient, PlacesError, validInput, validToken, validPlaceId, parseDailyCap } = require('./places-autocomplete');
const PLACES_CLIENT = PLACES_AUTOCOMPLETE_ENABLED
  ? createPlacesClient({apiKey: process.env.GOOGLE_PLACES_API_KEY})
  : null;
const PLACES_DAILY_CAP = PLACES_AUTOCOMPLETE_ENABLED
  ? parseDailyCap(process.env.PLACES_DAILY_CAP ?? '250')
  : 0;
if (MOBILITY_MATCHING_ENABLED && RIDES_BACKEND !== 'postgres')
  throw new Error('Mobility matching requires PostgreSQL Rides and identity');
const { PgOtpStore, PgPoolBusyError } = AUTH_OTP_BACKEND === 'postgres' ? require('./stage1-otp/pg-store') : { PgOtpStore: null, PgPoolBusyError: null };
const { handlePgAuth } = AUTH_OTP_BACKEND === 'postgres' ? require('./stage1-otp/auth-routes') : { handlePgAuth: null };
const {PgIdentity} = AUTH_OTP_BACKEND === 'postgres' ? require('./stage1-otp/identity') : {PgIdentity:null};
const {PgRidesStore,RidesError} = RIDES_BACKEND === 'postgres'
  ? require('./stage1-otp/rides-store') : {PgRidesStore:null,RidesError:null};
const {PgMobilityStore,MobilityError} = MOBILITY_MATCHING_ENABLED
  ? require('./stage1-otp/mobility-store') : {PgMobilityStore:null,MobilityError:null};

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'campuspool_database.json');
const ENV_FILE = path.join(__dirname, '.env.production');

// -------------------------------------------------------------------------
// Load Environment Variables from .env.production
// -------------------------------------------------------------------------
const envConfig = {};
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      envConfig[k] = process.env[k] || v;
    }
  }
}

const SMTP_HOST = envConfig.SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(envConfig.SMTP_PORT || process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = (envConfig.SMTP_SECURE || process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER = envConfig.SMTP_USER || process.env.SMTP_USER || '';
const SMTP_PASS = envConfig.SMTP_PASS || process.env.SMTP_PASS || '';
const SMTP_FROM = envConfig.SMTP_FROM || process.env.SMTP_FROM || 'MIT ADT CampusPool <no-reply@students.mituniversity.edu.in>';
const OTP_SECRET = process.env.OTP_SECRET || envConfig.OTP_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_DEV_OTP = !IS_PRODUCTION && process.env.ALLOW_DEV_OTP === 'true';
// The fingerprint rejects a known historical compromised key without repeating
// that plaintext secret in new commits. Owners must rotate the actual key.
const LEAKED_OTP_SECRET_SHA256 = '5fb097213f66224b532793a99a1b6d30d5a7af86d8ba8a9874b661a2484c8382';
const otpIsLeaked = OTP_SECRET && crypto.createHash('sha256').update(OTP_SECRET).digest('hex') === LEAKED_OTP_SECRET_SHA256;
if (IS_PRODUCTION && (!OTP_SECRET || OTP_SECRET.length < 32 || otpIsLeaked)) {
  throw new Error('OTP_SECRET must be configured as a strong private environment variable');
}
const ALLOWED_CORS_ORIGINS = new Set((process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
const TRUSTED_PROXY_ADDRESSES = new Set((process.env.TRUSTED_PROXY_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean));
const STAGING_ONLY = process.env.APP_ENV === 'staging';
const STAGING_BASIC_AUTH_PASSWORD = process.env.STAGING_BASIC_AUTH_PASSWORD || '';
if (STAGING_ONLY && STAGING_BASIC_AUTH_PASSWORD.length < 20) {
  throw new Error('Staging requires a strong STAGING_BASIC_AUTH_PASSWORD (at least 20 characters)');
}
function constantTimeMatch(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}
function validStagingBasicAuth(header) {
  if (!header || !header.startsWith('Basic ') || header.length > 512) return false;
  let plain;
  try { plain = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  return constantTimeMatch(plain, 'staging:' + STAGING_BASIC_AUTH_PASSWORD);
}

// -------------------------------------------------------------------------
// Built-in Multi-Worker Cluster Load Balancer Configuration
// -------------------------------------------------------------------------
const cluster = require('cluster');
const os = require('os');

// Force Round-Robin scheduling across all platforms (Linux, macOS, Windows)
if (cluster.schedulingPolicy !== undefined) {
  cluster.schedulingPolicy = cluster.SCHED_RR;
}

const ENABLE_CLUSTER = (process.env.ENABLE_CLUSTER !== 'false') && (process.env.CLUSTER_WORKERS !== '1');
const WORKERS_COUNT = parseInt(process.env.CLUSTER_WORKERS || process.env.WEB_CONCURRENCY, 10) || Math.min(4, Math.max(2, os.cpus().length || 2));

function runClusterMaster() {
  console.log(`========================================================`);
  console.log(` 🚀 MIT ADT CampusPool - Multi-Worker Cluster Load Balancer`);
  console.log(` Master PID: ${process.pid} | Total CPU Cores: ${os.cpus().length}`);
  console.log(` Scheduling Policy: Round-Robin (cluster.SCHED_RR)`);
  console.log(` Target Port: ${PORT} (0.0.0.0)`);
  console.log(` Launching ${WORKERS_COUNT} concurrent worker processes...`);
  console.log(`========================================================`);

  // Pre-initialize SQLite once in master so tables & migrations are ready before workers boot
  try {
    const SQLiteCampusDatabase = require('./database');
    new SQLiteCampusDatabase();
  } catch (err) {
    console.warn('[LOAD BALANCER] Master DB bootstrap notice:', err.message);
  }

  const workers = new Map();
  for (let i = 0; i < WORKERS_COUNT; i++) {
    const worker = cluster.fork({ WORKER_INDEX: i + 1 });
    workers.set(worker.id, worker);
  }

  cluster.on('online', (worker) => {
    console.log(`  ⚡ [LB Worker #${worker.id}] ONLINE (PID: ${worker.process.pid}) - Ready for requests`);
  });

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`  ⚠️ [LB Worker #${worker.id}] EXITED (PID: ${worker.process.pid}, code: ${code}). Auto-recovering...`);
    workers.delete(worker.id);
    const newWorker = cluster.fork();
    workers.set(newWorker.id, newWorker);
  });

  function shutdown() {
    console.log('\n[LOAD BALANCER] Terminating cluster workers gracefully...');
    for (const [, worker] of workers.entries()) {
      try { worker.kill('SIGTERM'); } catch (e) {}
    }
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (ENABLE_CLUSTER && cluster.isPrimary) {
  runClusterMaster();
} else {
  startWorkerServer();
}

function startWorkerServer() {
// -------------------------------------------------------------------------
// Embedded SQLite Relational Database Engine (better-sqlite3)
// Real SQL Tables, WAL Journaling, Foreign Keys & ACID Transactions
// -------------------------------------------------------------------------
const SQLiteCampusDatabase = require('./database');
const db = new SQLiteCampusDatabase();
// Expired GPS rows are inaccessible immediately, then removed by bounded periodic cleanup.
function pruneGps(){try{db.pruneLiveLocations();}catch(_){console.warn(JSON.stringify({event:'gps_cleanup_failed'}));}}
pruneGps();
const gpsCleanupTimer=setInterval(pruneGps,30000);gpsCleanupTimer.unref();
const pgOtpStore = AUTH_OTP_BACKEND === 'postgres' ? new PgOtpStore() : null;
const pgIdentity = pgOtpStore ? new PgIdentity(pgOtpStore) : null;
const pgRidesStore = RIDES_BACKEND === 'postgres'
  ? new PgRidesStore({pool:pgOtpStore.pool,freePilot:FREE_RIDES_PILOT,journeyEnabled:RIDES_JOURNEY_ENABLED,boardingPinEnabled:BOARDING_PIN_ENABLED,boardingPinKey:OTP_SECRET}) : null;
const pgMobilityStore = MOBILITY_MATCHING_ENABLED
  ? new PgMobilityStore({pool:pgOtpStore.pool}) : null;
const pgIdempotency = pgRidesStore ? new PgIdempotencyStore(pgOtpStore.pool) : null;
const sqliteIdempotency = !pgRidesStore ? new SqliteIdempotencyStore(db.db) : null;

// -------------------------------------------------------------------------
// Native Multi-Channel Email Dispatcher (HTTPS REST APIs + TLS SMTP Sockets)
// Bypasses cloud platform firewall blocks (e.g. Render Free Tier Port 465 block)
// -------------------------------------------------------------------------
async function sendViaResend(apiKey, { to, subject, htmlContent }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: 'MIT ADT CampusPool <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: htmlContent
    });
    const req = https.request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ delivered: true, provider: 'Resend-HTTPS-443' });
        } else {
          reject(new Error(`Resend Error [${res.statusCode}]: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendViaBrevo(apiKey, { to, subject, htmlContent }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: 'MIT ADT CampusPool', email: SMTP_USER || 'sadegaonkarsg@gmail.com' },
      to: [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    });
    const req = https.request('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ delivered: true, provider: 'Brevo-HTTPS-443' });
        } else {
          reject(new Error(`Brevo Error [${res.statusCode}]: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendSmtpSocket({ to, subject, htmlContent, textContent }) {
  return new Promise((resolve, reject) => {
    // Check if real SMTP credentials are provided or still placeholder
    const isPlaceholder = !SMTP_PASS || SMTP_PASS.includes('your_') || SMTP_PASS === 'your_16_character_app_password';
    if (!SMTP_USER || isPlaceholder) {
      return resolve({ delivered: false, simulated: true, reason: 'PLACEHOLDER_CREDENTIALS' });
    }

    const host = SMTP_HOST;
    const port = SMTP_PORT;

    console.log(`[SMTP] Connecting to ${host}:${port} for ${to}...`);

    const options = {
      host: host,
      port: port,
      rejectUnauthorized: false
    };

    const client = tls.connect(options, () => {
      // Handle TLS SMTP handshake
      let stage = 0;
      let buffer = '';

      function send(cmd) {
        client.write(cmd + '\r\n');
      }

      client.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop(); // keep remainder

        for (const line of lines) {
          const code = line.slice(0, 3);
          if (line[3] === '-') continue; // multiline response

          if (code === '220' && stage === 0) {
            stage = 1;
            send(`EHLO ${host}`);
          } else if (code === '250' && stage === 1) {
            stage = 2;
            send('AUTH LOGIN');
          } else if (code === '334' && stage === 2) {
            stage = 3;
            send(Buffer.from(SMTP_USER).toString('base64'));
          } else if (code === '334' && stage === 3) {
            stage = 4;
            send(Buffer.from(SMTP_PASS).toString('base64'));
          } else if (code === '235' && stage === 4) {
            stage = 5;
            send(`MAIL FROM:<${SMTP_USER}>`);
          } else if (code === '250' && stage === 5) {
            stage = 6;
            send(`RCPT TO:<${to}>`);
          } else if (code === '250' && stage === 6) {
            stage = 7;
            send('DATA');
          } else if (code === '354' && stage === 7) {
            stage = 8;
            const message = [
              `From: ${SMTP_FROM}`,
              `To: ${to}`,
              `Subject: ${subject}`,
              'MIME-Version: 1.0',
              'Content-Type: text/html; charset=UTF-8',
              '',
              htmlContent,
              '.'
            ].join('\r\n');
            send(message);
          } else if (code === '250' && stage === 8) {
            stage = 9;
            send('QUIT');
            client.end();
            resolve({ delivered: true, provider: 'Gmail-TLS-SMTP-465' });
          } else if (parseInt(code, 10) >= 400) {
            client.end();
            reject(new Error(`SMTP Error [${code}]: ${line}`));
          }
        }
      });
    });

    client.on('error', (err) => {
      console.warn('[SMTP Connection Error]:', err.message);
      reject(err);
    });

    client.setTimeout(6000, () => {
      client.destroy();
      reject(new Error('SMTP Connection Timeout'));
    });
  });
}

async function dispatchEmail({ to, subject, htmlContent, textContent }) {
  // 1. Check HTTPS REST APIs first if keys configured (Port 443 - Never Blocked)
  const resendKey = process.env.RESEND_API_KEY || envConfig.RESEND_API_KEY;
  if (resendKey && !resendKey.includes('your_')) {
    try {
      return await sendViaResend(resendKey, { to, subject, htmlContent });
    } catch (e) {
      console.warn('[EMAIL-DISPATCH] Resend HTTPS failed, trying next:', e.message);
    }
  }

  const brevoKey = process.env.BREVO_API_KEY || envConfig.BREVO_API_KEY;
  if (brevoKey && !brevoKey.includes('your_')) {
    try {
      return await sendViaBrevo(brevoKey, { to, subject, htmlContent });
    } catch (e) {
      console.warn('[EMAIL-DISPATCH] Brevo HTTPS failed, trying next:', e.message);
    }
  }

  // 2. Direct TLS Socket (Port 465)
  return await sendSmtpSocket({ to, subject, htmlContent, textContent });
}

// -------------------------------------------------------------------------
// Cryptographic Token and OTP Utilities
// -------------------------------------------------------------------------
function generateOtpCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(identifier, otp) {
  return crypto.createHmac('sha256', OTP_SECRET).update(`${identifier}:${otp}`).digest('hex');
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// -------------------------------------------------------------------------
// In-Memory Multi-Tier Caching Engine
// 1. Static Asset Cache: In-memory buffers, MIME types & strong ETags
// 2. Rides API Micro-Cache: 5s TTL with write-through invalidation
// 3. Real-Time GPS Tracking Cache: Sub-millisecond coordinates
// -------------------------------------------------------------------------
const staticFileCache = new Map();
// GPS has no worker-local coordinate cache; shared SQLite lease is authoritative.

let ridesCache = {
  jsonString: null,
  etag: null,
  version: 0,
  expiresAt: 0
};

function invalidateRidesCache() {
  ridesCache.jsonString = null;
  ridesCache.etag = null;
  ridesCache.version = -1;
  ridesCache.expiresAt = 0;
}

// -------------------------------------------------------------------------
// HTTP Server & Router
// -------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';
  const method = req.method.toUpperCase();
  if (STAGING_ONLY && pathname !== '/healthz' && !validStagingBasicAuth(req.headers.authorization)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="CampusPool staging", charset="UTF-8"',
      'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8'
    });
    return res.end('Staging access restricted');
  }
  res.on('finish', () => {
    // Structured operational logging: path only, no query parameters or credentials.
    const durationMs = Date.now() - startedAt;
    console.log(JSON.stringify({ event: 'http_request', method, path: pathname, status: res.statusCode, durationMs }));
    if (res.statusCode >= 500) console.warn(JSON.stringify({ event: 'server_error_alert', path: pathname, status: res.statusCode }));
  });

  // Same-origin by default. Cross-origin requests need an explicit allowlist.
  // Do not trust X-Forwarded-Host or accept arbitrary CORS origins.
  const origin = req.headers.origin;
  let sameOrigin = false;
  if (origin) {
    try {
      const incoming = new URL(origin);
      sameOrigin = incoming.protocol === (IS_PRODUCTION ? 'https:' : 'http:') && incoming.host === req.headers.host;
    } catch { sameOrigin = false; }
  }
  const allowedOrigin = origin && (sameOrigin || ALLOWED_CORS_ORIGINS.has(origin));
  res.setHeader('Vary', 'Origin');
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key');
  res.setHeader('Access-Control-Expose-Headers', 'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, Idempotency-Replayed');
  if (origin && !allowedOrigin) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ success: false, error: 'CORS_ORIGIN_DENIED' }));
  }
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Security & Load Balancer Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; img-src 'self' https: data: blob:; font-src 'self' https: data:; frame-src 'self' https://maps.google.com https://www.google.com;");
  res.setHeader('X-Load-Balancer', 'Node-Cluster-Round-Robin');
  res.setHeader('X-Worker-Pid', String(process.pid));
  res.setHeader('X-Worker-Id', cluster.worker ? String(cluster.worker.id) : '1');

  // Client IP Detection Helper (Supports Proxies & Normalization)
  function getClientIp() {
    const remote = req.socket?.remoteAddress || 'unknown';
    // Forwarded IP headers are untrusted unless the TCP peer is a configured reverse proxy.
    if (TRUSTED_PROXY_ADDRESSES.has(remote)) {
      const forwarded = req.headers['x-forwarded-for'];
      const candidate = forwarded && forwarded.split(',')[0].trim();
      if (candidate && require('net').isIP(candidate)) return candidate;
    }
    return remote === '::1' || remote === '::ffff:127.0.0.1' ? '127.0.0.1' : remote;
  }

  // Tiered Rate Limiting Policy Resolver
  function resolveRateLimitPolicy() {
    if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
      return null; // Static assets served from memory cache without DB lookup
    }

    // Billable Google Places endpoints use a tighter per-IP limit.
    if (pathname === '/api/places/suggest') {
      return { tier: 'PLACES_SUGGEST', limit: 18, windowMs: 60000 };
    }
    if (pathname === '/api/places/resolve') {
      return { tier: 'PLACES_RESOLVE', limit: 8, windowMs: 60000 };
    }

    // Tier 1: Strict Auth Gateways (10 req / min)
    if (
      pathname === '/api/auth/send-email-otp' ||
      pathname === '/api/auth/send-phone-otp' ||
      pathname === '/api/auth/login-request'
    ) {
      return { tier: 'AUTH_STRICT', limit: 10, windowMs: 60000 };
    }

    // Tier 2: Auth Verification & Registration (25 req / min)
    if (
      pathname === '/api/auth/verify-email-otp' ||
      pathname === '/api/auth/verify-phone-otp' ||
      pathname === '/api/auth/register' ||
      pathname === '/api/auth/check-uniqueness'
    ) {
      return { tier: 'AUTH_VERIFY', limit: 25, windowMs: 60000 };
    }

    // Tier 3: Real-Time GPS Tracking & Breadcrumbs (180 req / min)
    if (
      pathname === '/api/rides/location' ||
      pathname === '/api/bookings/passenger-location'
    ) {
      return { tier: 'GPS_REALTIME', limit: 180, windowMs: 60000 };
    }

    // Tier 4: System Telemetry & Cluster Health (300 req / min)
    if (
      pathname === '/api/health' ||
      pathname === '/api/lb-status' ||
      pathname === '/healthz'
    ) {
      return { tier: 'SYSTEM_TELEMETRY', limit: 300, windowMs: 60000 };
    }

    // Tier 5: State Mutations - Rides & Bookings (60 req / min)
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      return { tier: 'MUTATION', limit: 60, windowMs: 60000 };
    }

    // Tier 6: General API Reads & Polling (120 req / min)
    return { tier: 'API_READ', limit: 120, windowMs: 60000 };
  }

  // Reuse the existing SQLite counter across workers on the same DB file.
  // Never choose an actor from a cookie, body, email or forwarded header.
  const rateLimitPolicy = resolveRateLimitPolicy();
  const clientIp = getClientIp();
  const fairRoute = CAMPUS_WIFI_FAIRNESS && (
    (method === 'GET' && FAIR_READ_PATHS.has(pathname)) ||
    (method === 'POST' && FAIR_WRITE_PATHS.has(pathname)));
  let throttledIdempotencyReplay = null;
  function setRateLimitHeaders(result,tier) {
    for(const prefix of ['RateLimit-','X-RateLimit-']){
      res.setHeader(prefix+'Limit',String(result.limit));
      res.setHeader(prefix+'Remaining',String(result.remaining));
      res.setHeader(prefix+'Reset',String(result.resetSeconds));
    }
    res.setHeader('X-RateLimit-Tier',tier);
  }
  function sendRateLimit(tier,retryAfter) {
    res.setHeader('Retry-After',String(retryAfter));
    return sendJson(429,{success:false,error:'RATE_LIMIT_EXCEEDED',tier,retryAfter,
      message:'Too many requests. Please wait '+retryAfter+'s before retrying.'});
  }
  function admitRateLimit(policy,key,{allowReplay=true}={}) {
    const result=db.checkRateLimit(key,policy.limit,policy.windowMs);
    setRateLimitHeaders(result,policy.tier);
    if(result.allowed)return true;
    let retryAfter=result.resetSeconds;
    if(allowReplay && method==='POST' && IDEMPOTENT_MUTATION_PATHS.has(pathname) &&
        typeof req.headers['idempotency-key']==='string' && req.headers['idempotency-key'].length>=16){
      const replayBudget=db.checkRateLimit('rl:IDEMPOTENCY_REPLAY:'+clientIp,12,60000);
      if(replayBudget.allowed){
        throttledIdempotencyReplay={tier:policy.tier,retryAfter};
        return true;
      }
      retryAfter=Math.max(retryAfter,replayBudget.resetSeconds);
    }
    sendRateLimit(policy.tier,retryAfter);
    return false;
  }
  if(rateLimitPolicy){
    if(fairRoute){
      // Hard IP ceiling BEFORE costly session validation; no replay exception
      // to this ceiling. Initial pilot cap is 5x the old per-IP allowance.
      const aggregate={...rateLimitPolicy,tier:'CAMPUS_IP_'+rateLimitPolicy.tier,limit:rateLimitPolicy.limit*5};
      if(!admitRateLimit(aggregate,'rl:'+aggregate.tier+':'+clientIp,{allowReplay:false}))return;
      // Missing/malformed cookies use existing anonymous IP cap and never
      // allocate an actor bucket. Plausible tokens are checked below.
      if(!readSessionToken() && !admitRateLimit(rateLimitPolicy,'rl:'+rateLimitPolicy.tier+':'+clientIp,{allowReplay:false}))return;
    }else if(!admitRateLimit(rateLimitPolicy,'rl:'+rateLimitPolicy.tier+':'+clientIp))return;
  }

  // Parse JSON Body Helper
  async function parseBody() {
    const limitBytes = 64 * 1024;
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > limitBytes) {
        const err = new Error('JSON body exceeds 64 KB');
        err.httpStatus = 413;
        throw err;
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return {};
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      const err = new Error('Malformed JSON body');
      err.httpStatus = 400;
      throw err;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('JSON object required');
      err.httpStatus = 400;
      throw err;
    }
    return parsed;
  }

  function sendJson(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  // Explicit projections prevent discovery and historic receipts from
  // exposing counterparty contact or unverified payment identifiers.
  function pick(value,fields){
    return Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
  }
  function discoveryRide(ride){
    return pick(ride,['id','driverName','dept','vehicle','vehicleModel','pickup','destination',
      'departureTime','seatsTotal','seatsLeft','uberBenchmark','studentFare','driverPayout','paymentMode','journeyStage','departedAt','pickupAt','arrivedAt','createdAt']);
  }
  function ownerRide(ride){
    const result=discoveryRide(ride);
    if(isSelf(ride.driverEmail))result.driverEmail=ride.driverEmail;
    return result;
  }
  function historicalBooking(booking){
    const result=pick(booking,['bookingId','rideId','passengerName','driverName','dept',
      'vehicleModel','pickup','destination','departureTime','studentFare','paymentStatus','paymentMode','journeyStage','departedAt','pickupAt','arrivedAt','boardedAt','createdAt']);
    if(isSelf(booking.passengerEmail))result.passengerEmail=booking.passengerEmail;
    return result;
  }
  function activeParticipantBooking(booking){
    const result=historicalBooking(booking);
    if(isSelf(booking.passengerEmail) && booking.journeyStage!=='arrived' && typeof booking.driverPhone==='string')
      result.driverPhone=booking.driverPhone;
    return result;
  }
  function safeSettlement(status){
    return {...status,...(Array.isArray(status.pendingBookings)
      ? {pendingBookings:status.pendingBookings.map(historicalBooking)} : {}),
      ...(Array.isArray(status.unpaidBookings)
      ? {unpaidBookings:status.unpaidBookings.map(historicalBooking)} : {}),
      ...(status.unpaidBooking ? {unpaidBooking:historicalBooking(status.unpaidBooking)} : {})};
  }
  function receiptBody(route,body){
    if(route==='/api/rides' && body?.ride)return {...body,ride:ownerRide(body.ride)};
    if(route==='/api/bookings' && body?.booking)return {...body,booking:historicalBooking(body.booking)};
    if(route==='/api/rides/journey' && body?.ride)return {...body,ride:ownerRide(body.ride)};
    return body;
  }
  function safeLiveLocation(loc,driver){
    return loc ? pick(loc,driver
      ? ['rideId','lat','lng','speed','heading','accuracy','capturedAt','updatedAt','expiresAt']
      : ['bookingId','lat','lng','accuracy','capturedAt','updatedAt','expiresAt']) : null;
  }

  class MutationRejection extends Error {
    constructor(status, body) { super('MUTATION_REJECTED'); this.status = status; this.body = body; }
  }
  function rejectMutation(status, body) { throw new MutationRejection(status, body); }
  async function executeIdempotentMutation(route, body, execute) {
    const store = pgIdempotency || sqliteIdempotency;
    try {
      const receipt = await store.run({
        actor: pgRidesStore ? authenticatedUser?.id : authenticatedUser?.email,
        route: 'POST ' + route,
        key: req.headers['idempotency-key'],
        body,
        execute
      });
      if (receipt.replayed) res.setHeader('Idempotency-Replayed', 'true');
      return sendJson(receipt.status, receiptBody(route,receipt.body));
    } catch (error) {
      if (error instanceof IdempotencyError)
        return sendJson(error.status, { success: false, error: error.code });
      if (error instanceof MutationRejection)
        return sendJson(error.status, error.body);
      throw error;
    }
  }

  function readSessionToken() {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)cp_session=([A-Za-z0-9_-]{43})(?:;|$)/);
    return match ? match[1] : null;
  }
  function setSessionCookie(userEmail) {
    const token = db.createSession(userEmail);
    if (!token) return false;
    res.setHeader('Set-Cookie', 'cp_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800' + (IS_PRODUCTION ? '; Secure' : ''));
    return true;
  }
  function setPostgresCookie(token) {
    if(!token)return false;
    res.setHeader('Set-Cookie', 'cp_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+(IS_PRODUCTION?'; Secure':''));
    return true;
  }
  const sessionToken = readSessionToken();
  const authenticatedUser = pgIdentity ? await pgIdentity.getSessionUser(sessionToken) : db.getSessionUser(sessionToken);
  if(fairRoute && sessionToken){
    if(authenticatedUser){
      // A stable verified user UUID shares its budget across sessions/IPs.
      // Hash the UUID so the existing limiter stores no raw actor identifier.
      const actor=crypto.createHash('sha256').update('campus-rate:v1:'+authenticatedUser.id).digest('hex');
      const policy={...rateLimitPolicy,tier:'CAMPUS_USER_'+rateLimitPolicy.tier};
      if(!admitRateLimit(policy,'rl:'+policy.tier+':'+actor))return;
    }else{
      // Forged/revoked/expired tokens never receive an actor bucket, and
      // cannot probe receipts. The pre-auth IP ceiling already bounded DB work.
      if(!admitRateLimit(rateLimitPolicy,'rl:'+rateLimitPolicy.tier+':'+clientIp,{allowReplay:false}))return;
    }
  }
  // CSRF token is tied to a server-issued session, never persisted in a browser storage.
  function csrfForSession(token) {
    return crypto.createHmac('sha256', OTP_SECRET).update('csrf:v1:' + token).digest('hex');
  }
  function authenticatedMutationAllowed() {
    if (!sessionToken || !authenticatedUser) return false;
    const provided = req.headers['x-csrf-token'];
    return typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided)
      && constantTimeMatch(provided, csrfForSession(sessionToken));
  }
  const publicApiRoute = pathname.startsWith('/api/auth/') || pathname === '/api/health' ||
    pathname === '/api/lb-status' || pathname === '/healthz' ||
    pathname === '/api/places/suggest' || pathname === '/api/places/resolve';
  if (pathname.startsWith('/api/') && !publicApiRoute && !authenticatedUser) {
    return sendJson(401, { success: false, error: 'AUTH_REQUIRED', message: 'Sign in with your verified campus account.' });
  }
  // The destination picker is a public, read-only, explicitly capped service.
  // It never stores queries/coordinates, never exposes Google credentials, and
  // remains disabled unless the owner configures key, quota and billing.
  if (method === 'POST' && (pathname === '/api/places/suggest' ||
                            pathname === '/api/places/resolve')) {
    if (!PLACES_CLIENT) {
      return sendJson(503, {success:false,error:'LOCATION_SEARCH_NOT_CONFIGURED'});
    }
    try {
      // A JSON body avoids putting typed destinations and session tokens
      // into browser / reverse-proxy URL logs. Cross-origin JSON requires
      // preflight, and the server's same-origin CORS policy applies.
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        return sendJson(415,{success:false,error:'JSON_REQUIRED'});
      }
      const query = await parseBody();
      const token = validToken(query.sessionToken);
      if (pathname === '/api/places/suggest') validInput(query.q);
      else validPlaceId(query.id);

      // Secondary budget controls in addition to shared per-IP rate limits.
      // Production must ALSO configure a Google Cloud quota/billing budget,
      // particularly when deployed as multiple independent DB replicas.
      const perIpDay = db.checkRateLimit(
        'places:perip:day:' + getClientIp(), 80, 24 * 60 * 60 * 1000);
      if (!perIpDay.allowed) {
        res.setHeader('Retry-After', String(perIpDay.resetSeconds));
        return sendJson(429, {success:false,error:'LOCATION_SEARCH_RATE_LIMIT'});
      }
      const globalDay = db.checkRateLimit(
        'places:global:day', PLACES_DAILY_CAP, 24 * 60 * 60 * 1000);
      if (!globalDay.allowed) {
        res.setHeader('Retry-After', String(globalDay.resetSeconds));
        return sendJson(429, {success:false,error:'LOCATION_SEARCH_DAILY_LIMIT'});
      }
      if (pathname === '/api/places/suggest') {
        const suggestions = await PLACES_CLIENT.suggest({input:query.q,sessionToken:token});
        return sendJson(200, {success:true,suggestions,provider:'google'});
      }
      const place = await PLACES_CLIENT.resolve({placeId:query.id,sessionToken:token});
      return sendJson(200, {success:true,place,provider:'google'});
    } catch (err) {
      const safeStatus = err instanceof PlacesError ? err.status : 503;
      const safeCode = err instanceof PlacesError ? err.code : 'LOCATION_PROVIDER_UNAVAILABLE';
      return sendJson(safeStatus,{success:false,error:safeCode});
    }
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    if (!authenticatedUser) {
      return sendJson(401, { success: false, error: 'AUTH_REQUIRED' });
    }
    return sendJson(200, { success: true, user: authenticatedUser, csrfToken: csrfForSession(sessionToken), freeRidesPilot:FREE_RIDES_PILOT,journeyEnabled:RIDES_JOURNEY_ENABLED,boardingPinEnabled:BOARDING_PIN_ENABLED });
  }
  if (pathname.startsWith('/api/') && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')
    && authenticatedUser && (!pathname.startsWith('/api/auth/') || pathname === '/api/auth/logout')
    && !authenticatedMutationAllowed()) {
    return sendJson(403, { success: false, error: 'CSRF_REQUIRED', message: 'Refresh your session and try again.' });
  }
  // A throttled request may *only* replay a committed receipt. This block
  // runs after verified session and CSRF checks, before any mutation handler.
  if (throttledIdempotencyReplay) {
    try {
      const body = await parseBody();
      const receipt = await (pgIdempotency || sqliteIdempotency).findCompleted({
        actor: pgRidesStore ? authenticatedUser.id : authenticatedUser.email,
        route: 'POST ' + pathname,
        key: req.headers['idempotency-key'],
        body
      });
      if (receipt) {
        res.setHeader('Idempotency-Replayed', 'true');
        return sendJson(receipt.status, receiptBody(pathname,receipt.body));
      }
    } catch (error) {
      if (error instanceof IdempotencyError) {
        return sendJson(error.status, { success: false, error: error.code });
      }
      throw error;
    }
    res.setHeader('Retry-After', String(throttledIdempotencyReplay.retryAfter));
    return sendJson(429, {
      success: false, error: 'RATE_LIMIT_EXCEEDED',
      tier: throttledIdempotencyReplay.tier,
      message: 'Mutation rate limit reached. Retry with the same key after Retry-After.',
      retryAfter: throttledIdempotencyReplay.retryAfter
    });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = readSessionToken();
    if (token) {
      if(pgIdentity)await pgIdentity.revokeSession(token);
      else db.revokeSession(token);
    }
    res.setHeader('Set-Cookie', 'cp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (IS_PRODUCTION ? '; Secure' : ''));
    return sendJson(200, { success: true });
  }
  function isSelf(email) {
    return authenticatedUser && typeof email === 'string' && authenticatedUser.email.toLowerCase() === email.trim().toLowerCase();
  }
  function validLocation(lat, lng) {
    return lat !== null && lng !== null && lat !== '' && lng !== '' &&
      Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
      Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
  }
  function validText(value, max) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
      !/[<>\u0000-\u001f]/.test(value);
  }

  // -----------------------------------------------------------------------
  // REST API: /api/health & /api/lb-status (Cluster Load Balancer Telemetry)
  // -----------------------------------------------------------------------
  if (method === 'GET' && (pathname === '/api/health' || pathname === '/api/lb-status' || pathname === '/healthz')) {
    const mem = process.memoryUsage();
    return sendJson(200, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      loadBalancer: {
        type: 'Node.js Multi-Worker Cluster Load Balancer',
        algorithm: 'Round-Robin (cluster.SCHED_RR)',
        workerPid: process.pid,
        workerId: cluster.worker ? cluster.worker.id : 1,
        totalWorkers: WORKERS_COUNT,
        cpuCores: os.cpus().length,
        isClustered: Boolean(cluster.isWorker)
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsageMb: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024)
        }
      },
      database: {
        engine: 'SQLite3 (better-sqlite3)',
        journalMode: 'WAL',
        concurrency: 'Multi-Process Safe (busy_timeout=5000ms)'
      },
      caching: {
        staticFilesCached: staticFileCache.size,
        ridesMicroCacheTtlSeconds: 5,
        isRidesCacheWarm: Boolean(ridesCache.jsonString && Date.now() < ridesCache.expiresAt),
        gpsCacheSize: 0
      },
      rateLimiting: {
        engine: 'Distributed SQLite WAL Shared Rate Limiter',
        algorithm: 'Fixed Window Counter with Retry-After',
        status: 'active',
        tiers: {
          AUTH_STRICT: { limit: 10, windowSeconds: 60 },
          AUTH_VERIFY: { limit: 25, windowSeconds: 60 },
          MUTATION: { limit: 60, windowSeconds: 60 },
          GPS_REALTIME: { limit: 180, windowSeconds: 60 },
          API_READ: { limit: 120, windowSeconds: 60 },
          SYSTEM_TELEMETRY: { limit: 300, windowSeconds: 60 }
        }
      }
    });
  }

  // Stage 1 PostgreSQL OTP is opt-in. Legacy SQLite rides and profiles are
  // preserved until their independent, tested migration is approved.
  // When enabled, these six auth routes fail closed to the PG-backed service.
  if (pgOtpStore && await handlePgAuth({
    pathname, method, parseBody, sendJson, db, setSessionCookie, getClientIp,
    store: pgOtpStore,identity:pgIdentity,setPostgresCookie
  })) return;

  // -----------------------------------------------------------------------
  // REST API: /api/auth/check-uniqueness
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/check-uniqueness') {
    const body = await parseBody();
    const check = pgIdentity ? await pgIdentity.checkUniqueness(body.name, body.email, body.phone) : db.checkUniqueness(body.name, body.email, body.phone);
    if (!check.unique) return sendJson(409, { success: false, error: check.error || 'NOT_UNIQUE' });
    if (check.isExistingUser) return sendJson(200, { success: true, isExistingUser: true, message: 'An account already exists. Please sign in.' });
    return sendJson(200, { success: true, message: 'Credentials are ready for verification.' });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/login-request (Dedicated Instant Sign-In for Existing Users)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/login-request') {
    const body = await parseBody();
    const identifier = (body.identifier || '').trim();

    if (!identifier) {
      return sendJson(400, { success: false, message: 'Please enter your registered email or mobile number.' });
    }

    const user = db.getProfileByIdentifier(identifier);
    if (!user) {
      return sendJson(404, {
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'No registered account found with this email or mobile. Please switch to the Register tab to create your campus profile.'
      });
    }

    // Rate-limit check (45 seconds cooldown)
    const existing = db.findOtp(user.email, 'EMAIL');
    if (existing && existing.resendCooldownUntil > Date.now()) {
      const waitSec = Math.ceil((existing.resendCooldownUntil - Date.now()) / 1000);
      return sendJson(429, {
        success: false,
        error: 'RATE_LIMIT',
        message: `Please wait ${waitSec}s before requesting a new sign-in code.`
      });
    }

    // Generate 6-Digit Cryptographic OTP
    const otp = generateOtpCode();
    const hashed = hashOtp(user.email, otp);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const cooldownUntil = Date.now() + 45 * 1000;

    db.cleanExpiredOtps(user.email);

    const otpRecord = {
      id: crypto.randomUUID(),
      identifier: user.email,
      type: 'EMAIL',
      hashedOtp: hashed,
      attemptsLeft: 5,
      expiresAt: expiresAt,
      resendCooldownUntil: cooldownUntil,
      isVerified: false,
      token: null,
      createdAt: Date.now()
    };

    db.saveOtp(otpRecord);

    const emailSubject = `MIT ADT CampusPool: ${otp} is your Sign-In code`;
    const emailHtml = `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:540px;margin:0 auto;background:#090d16;color:#f8fafc;padding:32px;border-radius:16px;border:1px solid #1e293b;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#f59e0b);padding:8px 16px;border-radius:8px;font-weight:900;color:#020617;font-size:18px;">
            MIT ADT CampusPool
          </div>
          <h2 style="font-size:20px;font-weight:800;color:#ffffff;margin-top:16px;">Student Sign-In Verification</h2>
          <p style="font-size:13px;color:#94a3b8;margin:0;">Welcome back, ${user.name}!</p>
        </div>
        <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px;">Your 6-digit campus sign-in code is:</p>
          <div style="font-size:36px;font-family:monospace;font-weight:900;letter-spacing:8px;color:#818cf8;background:#1e1b4b;padding:12px;border-radius:8px;border:1px solid #4f46e5;display:inline-block;">
            ${otp}
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:12px;">Valid for 10 minutes. Enter this code to sign in.</p>
        </div>
      </div>
    `;

    console.log('[SIGN-IN-OTP] One-time code generated for email sign-in (redacted)');

    let emailStatus = { delivered: false };
    try {
      emailStatus = await dispatchEmail({
        to: user.email,
        subject: emailSubject,
        htmlContent: emailHtml,
        textContent: `MIT ADT CampusPool: Your sign-in code is ${otp}. Valid for 10 minutes.`
      });
      if (emailStatus.delivered) {
        console.log(`[SIGN-IN-OTP] ✅ Email successfully delivered to ${user.email} (via ${emailStatus.provider || 'SMTP'})`);
      }
    } catch (err) {
      console.warn(`[SIGN-IN-OTP] ⚠️ Email dispatch warning: ${err.message}`);
    }

    const isRealDelivery = emailStatus.delivered === true;
    if (IS_PRODUCTION && !isRealDelivery) {
      return sendJson(503, { success: false, error: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'Email verification is temporarily unavailable. Please try later.' });
    }

    return sendJson(200, {
      success: true,
      message: `Sign-in verification code dispatched to ${user.email}.`,
      email: user.email,
      name: user.name,
      phone: user.phone,
      deliveredToInbox: isRealDelivery,
      devOtpHint: ALLOW_DEV_OTP && !isRealDelivery ? otp : undefined
    });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/send-email-otp
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/send-email-otp') {
    const body = await parseBody();
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();

    // 1. Enforce strict MIT ADT institutional email domain policy
    const isInstitutional = /^[a-zA-Z0-9._%+-]+@(students\.)?mituniversity\.edu\.in$/i.test(email);
    if (!isInstitutional) {
      return sendJson(400, {
        success: false,
        field: 'email',
        error: 'INVALID_DOMAIN',
        message: 'Only @students.mituniversity.edu.in or @mituniversity.edu.in institutional email addresses are permitted. Invalid institutional domain.'
      });
    }

    // 2. Check Uniqueness & Allow Returning User Login
    const uniqueCheck = db.checkUniqueness(name, email, phone);
    if (!uniqueCheck.unique) {
      return sendJson(409, { success: false, ...uniqueCheck });
    }

    // 3. Clean up expired OTPs for this email
    db.cleanExpiredOtps(email);

    // 4. Rate-limit check (45 seconds cooldown)
    const existing = db.findOtp(email, 'EMAIL');
    if (existing && existing.resendCooldownUntil > Date.now()) {
      const waitSec = Math.ceil((existing.resendCooldownUntil - Date.now()) / 1000);
      return sendJson(429, {
        success: false,
        error: 'RATE_LIMIT',
        message: `Please wait ${waitSec}s before requesting a new verification code.`
      });
    }

    // 5. Generate 6-Digit Cryptographic OTP
    const otp = generateOtpCode();
    const hashed = hashOtp(email, otp);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    const cooldownUntil = Date.now() + 45 * 1000;  // 45 seconds

    const otpRecord = {
      id: crypto.randomUUID(),
      identifier: email,
      type: 'EMAIL',
      hashedOtp: hashed,
      attemptsLeft: 5,
      expiresAt: expiresAt,
      resendCooldownUntil: cooldownUntil,
      isVerified: false,
      token: null,
      createdAt: Date.now()
    };

    db.saveOtp(otpRecord);

    // 6. Build Branded HTML Email
    const emailSubject = `MIT ADT CampusPool: ${otp} is your verification code`;
    const emailHtml = `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:540px;margin:0 auto;background:#090d16;color:#f8fafc;padding:32px;border-radius:16px;border:1px solid #1e293b;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#f59e0b);padding:8px 16px;border-radius:8px;font-weight:900;color:#020617;font-size:18px;">
            MIT ADT CampusPool
          </div>
          <h2 style="font-size:20px;font-weight:800;color:#ffffff;margin-top:16px;">Student Commute Verification</h2>
          <p style="font-size:13px;color:#94a3b8;margin:0;">Loni Kalbhor • Solapur Highway Corridor (NH 65)</p>
        </div>
        <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px;">Your 6-digit university verification code is:</p>
          <div style="font-size:36px;font-family:monospace;font-weight:900;letter-spacing:8px;color:#818cf8;background:#1e1b4b;padding:12px;border-radius:8px;border:1px solid #4f46e5;display:inline-block;">
            ${otp}
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:12px;">Valid for 10 minutes. Enter this code on the verification screen.</p>
        </div>
        <p style="font-size:11px;color:#64748b;line-height:1.5;margin:0;">
          <strong>Security Notice:</strong> Only verified @students.mituniversity.edu.in students can board at Gates 1–4. Never share this code with anyone. CampusPool admins will never ask for your code.
        </p>
      </div>
    `;

    let emailStatus = { delivered: false, simulated: false };
    try {
      emailStatus = await dispatchEmail({
        to: email,
        subject: emailSubject,
        htmlContent: emailHtml,
        textContent: `Your MIT ADT CampusPool verification code is ${otp}. Valid for 10 minutes.`
      });
      if (emailStatus.delivered) {
        console.log(`[AUTH-EMAIL-SENT] ✅ Email successfully delivered to ${email} (via ${emailStatus.provider || 'SMTP'})`);
      }
    } catch (err) {
      console.warn(`[AUTH-EMAIL-DISPATCH-WARNING] Email dispatch to ${email} failed: ${err.message}`);
      emailStatus.delivered = false;
      emailStatus.error = err.message;
    }

    // Avoid emitting OTP values or personal identifiers in application logs.
    console.log('[AUTH-EMAIL] Verification delivery attempt complete; delivered=' + Boolean(emailStatus.delivered));

    const isRealDelivery = emailStatus.delivered === true;
    if (IS_PRODUCTION && !isRealDelivery) {
      return sendJson(503, { success: false, error: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'Email verification is temporarily unavailable. Please try later.' });
    }

    return sendJson(200, {
      success: true,
      isLogin: !!uniqueCheck.isExistingUser,
      existingUser: uniqueCheck.user || null,
      deliveredToInbox: isRealDelivery,
      message: 'A 6-digit verification code has been sent to your university inbox.',
      expiresInSeconds: 600,
      devOtpHint: ALLOW_DEV_OTP && !isRealDelivery ? otp : undefined
    });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/verify-email-otp
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/verify-email-otp') {
    const body = await parseBody();
    const email = (body.email || '').trim().toLowerCase();
    const enteredOtp = (body.otp || '').trim();

    const record = db.findOtp(email, 'EMAIL');
    if (!record) {
      return sendJson(400, {
        success: false,
        error: 'NO_OTP_REQUESTED',
        message: 'No active verification code found for this email. Please request a new code.'
      });
    }

    if (Date.now() > record.expiresAt) {
      return sendJson(400, {
        success: false,
        error: 'OTP_EXPIRED',
        message: 'Verification code has expired. Please request a fresh code.'
      });
    }

    if (record.isVerified) {
      return sendJson(400, { success: false, error: 'OTP_ALREADY_USED', message: 'This code has already been verified. Request a new code.' });
    }

    if (record.attemptsLeft <= 0) {
      return sendJson(403, {
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many incorrect attempts. Please request a new verification code.'
      });
    }

    const expectedHash = hashOtp(email, enteredOtp);
    if (crypto.timingSafeEqual(Buffer.from(record.hashedOtp), Buffer.from(expectedHash))) {
      record.isVerified = true;
      record.token = generateVerificationToken();
      db.saveOtp(record);

      const existingUser = db.getProfileByEmail(email);
      if (existingUser && !setSessionCookie(existingUser.email)) {
        return sendJson(500, { success: false, error: 'SESSION_FAILED' });
      }

      return sendJson(200, {
        success: true,
        isLogin: !!existingUser,
        user: existingUser || null,
        message: existingUser ? `Welcome back, ${existingUser.name}!` : 'Email successfully verified!',
        emailToken: record.token
      });
    } else {
      record.attemptsLeft -= 1;
      db.saveOtp(record);
      return sendJson(400, {
        success: false,
        error: 'INVALID_OTP',
        message: `Incorrect verification code. ${record.attemptsLeft} attempts remaining.`
      });
    }
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/send-phone-otp
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/send-phone-otp') {
    if (!smsProvider.isConfigured()) {
      return sendJson(503, { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED',
        message: 'SMS verification is temporarily unavailable.' });
    }
    const body = await parseBody();
    const digits = typeof body.phone === 'string' ? body.phone.replace(/[^0-9]/g, '').slice(-10) : '';
    if (!/^[6-9][0-9]{9}$/.test(digits)) {
      return sendJson(400, { success: false, error: 'INVALID_PHONE', message: 'Enter a valid Indian mobile number.' });
    }
    const uniqueProfile = db.getProfiles().some(profile =>
      (profile.phone || '').replace(/[^0-9]/g, '').slice(-10) === digits
    );
    if (uniqueProfile) {
      return sendJson(409, { success: false, error: 'PHONE_ALREADY_REGISTERED',
        message: 'This mobile number is already registered.' });
    }
    const previous = db.findOtp(digits, 'PHONE');
    if (previous && previous.resendCooldownUntil > Date.now()) {
      return sendJson(429, { success: false, error: 'OTP_RESEND_COOLDOWN',
        retryAfter: Math.ceil((previous.resendCooldownUntil - Date.now()) / 1000) });
    }
    const otp = generateOtpCode();
    try {
      await smsProvider.sendOtpSms(digits, otp);
    } catch (error) {
      console.warn('[SMS] Provider rejected or could not accept OTP delivery');
      return sendJson(503, { success: false, error: 'SMS_DELIVERY_UNAVAILABLE',
        message: 'SMS delivery failed. Please try again later.' });
    }
    db.cleanExpiredOtps(digits);
    db.saveOtp({
      id: crypto.randomUUID(),
      identifier: digits,
      type: 'PHONE',
      hashedOtp: hashOtp(digits, otp),
      attemptsLeft: 5,
      expiresAt: Date.now() + 10 * 60 * 1000,
      resendCooldownUntil: Date.now() + 45 * 1000,
      isVerified: false,
      token: null,
      createdAt: Date.now()
    });
    return sendJson(200, { success: true,
      message: 'SMS verification code submitted for delivery.',
      expiresInSeconds: 600 });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/verify-phone-otp
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/verify-phone-otp') {
    const body = await parseBody();
    const cleanDigits = (body.phone || '').replace(/[^0-9]/g, '').slice(-10);
    const enteredOtp = typeof body.otp === 'string' ? body.otp.trim() : '';
    if (!/^[0-9]{6}$/.test(enteredOtp)) {
      return sendJson(400, { success: false, error: 'INVALID_OTP_FORMAT' });
    }

    const record = db.findOtp(cleanDigits, 'PHONE');
    if (!record) {
      return sendJson(400, { success: false, error: 'NO_OTP_REQUESTED', message: 'No active SMS code found for this mobile.' });
    }

    if (Date.now() > record.expiresAt) {
      return sendJson(400, { success: false, error: 'OTP_EXPIRED', message: 'SMS code expired. Request a new code.' });
    }
    if (record.isVerified || record.attemptsLeft <= 0) {
      return sendJson(403, { success: false, error: 'OTP_UNAVAILABLE', message: 'This verification code can no longer be used.' });
    }

    const expectedHash = hashOtp(cleanDigits, enteredOtp);
    if (crypto.timingSafeEqual(Buffer.from(record.hashedOtp), Buffer.from(expectedHash))) {
      record.isVerified = true;
      record.token = generateVerificationToken();
      db.saveOtp(record);

      return sendJson(200, {
        success: true,
        message: 'Mobile number verified!',
        phoneToken: record.token
      });
    } else {
      record.attemptsLeft -= 1;
      db.saveOtp(record);
      return sendJson(400, { success: false, error: 'INVALID_OTP', message: `Incorrect SMS code. ${record.attemptsLeft} attempts left.` });
    }
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/register
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await parseBody();
    const { name, email, phone, dept, emailToken, phoneToken } = body;
    const cleanDigits = (phone || '').replace(/[^0-9]/g, '').slice(-10);

    // Verify tokens were generated by successful server OTP verifications
    const emailRec = db.findOtpByToken(email, emailToken);
    const phoneRec = db.findOtpByToken(cleanDigits, phoneToken);

    if (!emailRec) {
      return sendJson(403, { success: false, error: 'UNVERIFIED_EMAIL', message: 'University email has not been verified.' });
    }

    if (!phoneRec) {
      return sendJson(403, { success: false, error: 'UNVERIFIED_PHONE', message: 'Mobile number has not been verified.' });
    }

    try {
      const profile = db.createProfile({ name, email, phone, dept });
      db.consumeVerificationTokens(emailToken, phoneToken);
      if (!setSessionCookie(profile.email)) {
        return sendJson(500, { success: false, error: 'SESSION_FAILED' });
      }
      return sendJson(201, {
        success: true,
        message: `Welcome ${profile.name}! Your student account is registered in the campus database.`,
        user: profile
      });
    } catch (err) {
      return sendJson(409, {
        success: false,
        error: 'DATABASE_CONSTRAINT_VIOLATION',
        message: err.message
      });
    }
  }

  // -----------------------------------------------------------------------
  // Demand-first mobility API is enabled only after schema verification.
  // It inherits both session authorization and CSRF checks from the router.
  if (pathname.startsWith('/api/mobility/')) {
    if (!pgMobilityStore) return sendJson(404,{success:false,error:'FEATURE_NOT_ENABLED'});
    try {
      // Expensive match search has a persistent shared PostgreSQL rate bucket.
      // Intent creation is throttled in the *same* transaction as its receipt:
      // replaying a committed key does not consume the student's quota.
      if (method==='GET' && pathname==='/api/mobility/matches') {
        await pgOtpStore.tx(client=>pgOtpStore.rate(
          client,'mobility-match-search',authenticatedUser.id,30,3600
        ));
      }
      if (method==='POST' && pathname==='/api/mobility/intents') {
        const body=await parseBody();
        return await executeIdempotentMutation(pathname,body,async client=>{
          await pgOtpStore.rate(client,'mobility-intent-create',authenticatedUser.id,8,3600);
          const intent=await pgMobilityStore.createIntent({
            studentUserId:authenticatedUser.id,pickup:body.pickup,dropoff:body.dropoff,
            earliestDeparture:body.earliestDeparture,latestDeparture:body.latestDeparture,client
          });
          return {status:201,body:{success:true,intent}};
        });
      }
      if (method==='GET' && pathname==='/api/mobility/intent') {
        const intent=await pgMobilityStore.getActiveIntent({studentUserId:authenticatedUser.id});
        res.setHeader('Cache-Control','no-store');
        return sendJson(200,{success:true,intent});
      }
      if (method==='GET' && pathname==='/api/mobility/matches') {
        const intentId=parsedUrl.query?.intentId;
        const matches=await pgMobilityStore.findCandidates({
          studentUserId:authenticatedUser.id,intentId,limit:10
        });
        res.setHeader('Cache-Control','no-store');
        return sendJson(200,{success:true,...matches});
      }
      if (method==='POST' && pathname==='/api/mobility/intents/cancel') {
        const body=await parseBody();
        return await executeIdempotentMutation(pathname,body,async client=>{
          const result=await pgMobilityStore.cancelIntent({
            studentUserId:authenticatedUser.id,intentId:body.intentId,client
          });
          return {status:200,body:result};
        });
      }
      return sendJson(404,{success:false,error:'NOT_FOUND'});
    } catch(error){
      if(PgPoolBusyError && error instanceof PgPoolBusyError) throw error;
      if(error?.code==='RATE_LIMITED'){
        return sendJson(429,{success:false,error:'RATE_LIMITED'});
      }
      const known=error instanceof MobilityError;
      if(!known)console.warn(JSON.stringify({event:'mobility_api_error',code:error.code||'DATABASE_ERROR'}));
      return sendJson(known?error.status:500,{success:false,
        error:known?error.code:'DATABASE_ERROR'});
    }
  }

  // REST API: /api/rides (List & Post) with 5s Micro-Caching & Conditional 304
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/rides') {
    if (pgRidesStore) {
      // PostgreSQL is the sole source in this mode; no SQLite-backed cache or
      // cluster-local version value can incorrectly serve old seat counts.
      const freshRides=(await pgRidesStore.getRides()).map(discoveryRide);
      const payload=JSON.stringify({success:true,rides:freshRides});
      const etag='W/"pg-'+crypto.createHash('sha256').update(payload).digest('hex').slice(0,20)+'"';
      if(req.headers['if-none-match']===etag){
        res.writeHead(304,{'ETag':etag,'Cache-Control':'no-store'});
        return res.end();
      }
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
        'ETag':etag,'Cache-Control':'no-store'});
      return res.end(payload);
    }
    const now = Date.now();
    const ifNoneMatch = req.headers['if-none-match'];
    let currentVersion = 1;
    try {
      currentVersion = db.getRidesVersion();
    } catch (e) {
      currentVersion = 1;
    }

    // Check if micro-cache is active and valid (both TTL and shared database version match)
    if (ridesCache.jsonString && ridesCache.version === currentVersion && now < ridesCache.expiresAt) {
      if (ifNoneMatch && ifNoneMatch === ridesCache.etag) {
        res.writeHead(304, {
          'ETag': ridesCache.etag,
          'Cache-Control': 'private, no-store',
          'X-Cache': 'HIT-304'
        });
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'ETag': ridesCache.etag,
        'Cache-Control': 'private, no-store',
        'X-Cache': 'HIT'
      });
      return res.end(ridesCache.jsonString);
    }

    // Cache Miss or Invalidation: Query Relational Database
    const freshRides = db.getRides().map(discoveryRide);
    const jsonStr = JSON.stringify({ success: true, rides: freshRides });
    const etag = `W/"v${currentVersion}-${crypto.createHash('md5').update(jsonStr).digest('hex').slice(0, 16)}"`;

    ridesCache = {
      jsonString: jsonStr,
      etag: etag,
      version: currentVersion,
      expiresAt: now + 5000 // 5 seconds micro-cache TTL
    };

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'private, no-store',
        'X-Cache': 'HIT-304'
      });
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'ETag': etag,
      'Cache-Control': 'private, no-store',
      'X-Cache': 'MISS'
    });
    return res.end(jsonStr);
  }

  if (method === 'POST' && pathname === '/api/rides') {
    const body = await parseBody();
    // Validation and settlement eligibility execute only for the *first*
    // successful key. A retry returns the original ride, even if state changes.
    return await executeIdempotentMutation(pathname,body,client=>{
      if (body.driverEmail && !isSelf(body.driverEmail)) {
        rejectMutation(403,{success:false,error:'NOT_RIDE_OWNER'});
      }
      if (!['Car', 'Bike'].includes(body.vehicle) || !validText(body.vehicleModel, 80) ||
          !validText(body.pickup, 120) || !validText(body.destination, 120) ||
          !validText(body.departureTime, 120) ||
          (body.note && !validText(body.note, 500)) ||
          !Number.isInteger(Number(body.seatsTotal)) || Number(body.seatsTotal) < 1 || Number(body.seatsTotal) > 4 ||
          ![body.uberBenchmark,body.studentFare,body.driverPayout].every(v =>
            Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 10000)) {
        rejectMutation(400,{success:false,error:'INVALID_RIDE',
          message:'Ride details must be valid, reasonably sized and contain no markup.'});
      }
      if (pgRidesStore && !pgMobilityStore &&
          ['pickupCoordinates','destinationCoordinates','departureAt'].some(k=>body[k]!==undefined)){
        rejectMutation(400,{success:false,error:'FEATURE_NOT_ENABLED'});
      }
      if(FREE_RIDES_PILOT && (body.studentFare!==0 || body.driverPayout!==0 || body.uberBenchmark!==0 || (body.upiId!==undefined && body.upiId!=='')))rejectMutation(400,{success:false,error:'FREE_PILOT_ZERO_FARE_REQUIRED',message:'Pilot rides are free; no fare, payout or commission.'});
      const finish = settlementCheck => {
        if (settlementCheck.hasUnsettledCommission) {
          rejectMutation(403, {
            success:false,error:'COMMISSION_SETTLEMENT_REQUIRED',
            message:`Commission Settlement Required: You have ₹${settlementCheck.commissionDue} in pending platform commission from a previous commute. Payment verification is unavailable; existing obligations require review.`,
            ...safeSettlement(settlementCheck)
          });
        }
        const cleanRide = {
          ...body,driverName:authenticatedUser.name,driverEmail:authenticatedUser.email,
          driverPhone:authenticatedUser.phone,dept:authenticatedUser.dept,
          seatsTotal:Number(body.seatsTotal),
          uberBenchmark:Number(body.uberBenchmark),studentFare:Number(body.studentFare),
          driverPayout:Number(body.driverPayout),note:body.note||'',upiId:''
        };
        if(pgRidesStore){
          return pgRidesStore.createRide({driverUserId:authenticatedUser.id,ride:cleanRide,client})
            .then(ride=>({status:201,body:{success:true,ride:ownerRide(ride)}}));
        }
        const ride=db.createRide(cleanRide);
        invalidateRidesCache();
        return {status:201,body:{success:true,ride:ownerRide(ride)}};
      };
      return pgRidesStore
        ? pgRidesStore.checkUserSettlementBlock(authenticatedUser.id,client).then(finish)
        : finish(db.checkUserSettlementBlock(authenticatedUser.email));
    });
  }

  // -----------------------------------------------------------------------
  // Driver-reported, persisted events — not GPS-verified travel claims.
  if(method==='POST' && pathname==='/api/rides/journey'){
    if(!RIDES_JOURNEY_ENABLED||!pgRidesStore)return sendJson(503,{success:false,error:'JOURNEY_NOT_ENABLED'});
    const body=await parseBody();
    if(!body||typeof body!=='object'||Array.isArray(body))return sendJson(400,{success:false,error:'INVALID_JOURNEY_ACTION'});
    try{
      return await executeIdempotentMutation(pathname,body,client=>
        pgRidesStore.advanceJourney({rideId:body.rideId,action:body.action,driverUserId:authenticatedUser.id,client})
          .then(ride=>({status:200,body:{success:true,ride:ownerRide(ride)}})));
    }catch(err){
      if(PgPoolBusyError && err instanceof PgPoolBusyError)throw err;
      return sendJson(err instanceof RidesError?err.status:500,
        {success:false,error:err instanceof RidesError?err.code:'DATABASE_ERROR'});
    }
  }

  // REST API: explicit short-lived GPS sharing, same existing endpoints.
  // Authorization is evaluated for every read and mutation. No demo writes.
  if((method==='GET'||method==='POST') &&
     (pathname==='/api/rides/location'||pathname==='/api/bookings/passenger-location')){
    const driver=pathname==='/api/rides/location';
    const field=driver?'rideId':'bookingId',type=driver?'ride':'passenger';
    const body=method==='POST'?await parseBody():parsedUrl.query;
    const id=body?.[field];
    if(typeof id!=='string'||!id||id.length>128)return sendJson(400,{success:false,error:'INVALID_GPS_ID'});
    if(method==='POST' && !['start','update','stop'].includes(body.action))
      return sendJson(400,{success:false,error:'GPS_ACTION_REQUIRED'});
    const actor=pgRidesStore?authenticatedUser.id:authenticatedUser.email;
    const store=pgRidesStore||db;
    const authorized=driver
      ? await (method==='GET'?store.isRideParticipant(id,actor):store.isRideDriver(id,actor))
      : await (method==='GET'?store.isBookingParticipant(id,actor):store.isBookingPassenger(id,actor));
    if(!authorized)return sendJson(403,{success:false,error:driver
      ? (method==='GET'?'NOT_RIDE_PARTICIPANT':'NOT_RIDE_OWNER')
      : (method==='GET'?'NOT_BOOKING_PARTICIPANT':'NOT_BOOKING_PASSENGER')});
    if(method==='GET')return sendJson(200,{success:true,location:safeLiveLocation(db.getLiveLocation(id,type),driver)});
    // Lease is bound to the actual authenticated session, not body identity.
    const leaseHash=token=>crypto.createHmac('sha256',sessionToken).update('gps:v2:'+token).digest('hex');
    if(body.action==='start'){
      const lease=crypto.randomBytes(32).toString('base64url');
      db.startLiveLocation(id,type,leaseHash(lease));
      return sendJson(200,{success:true,lease,ttlSeconds:60});
    }
    if(typeof body.lease!=='string'||!(/^[A-Za-z0-9_-]{43}$/).test(body.lease))
      return sendJson(400,{success:false,error:'GPS_LEASE_REQUIRED'});
    if(body.action==='stop'){
      // Stopping is idempotent and an old lease cannot stop a replacement.
      db.stopLiveLocation(id,type,leaseHash(body.lease));
      return sendJson(200,{success:true,location:null});
    }
    if(typeof body.lat!=='number'||typeof body.lng!=='number'||!validLocation(body.lat,body.lng)||
       !Number.isSafeInteger(body.capturedAt)||
       !Number.isFinite(body.accuracy)||body.accuracy<0||body.accuracy>10000||
       (driver && (!Number.isFinite(body.speed)||body.speed<0||body.speed>150||
         !Number.isFinite(body.heading)||body.heading<0||body.heading>=360)))
      return sendJson(400,{success:false,error:'INVALID_GPS_FIX'});
    const fix={[field]:id,lat:body.lat,lng:body.lng,accuracy:body.accuracy,capturedAt:body.capturedAt,
      ...(driver?{speed:body.speed,heading:body.heading}:{})};
    const result=db.updateLiveLocation(id,type,leaseHash(body.lease),fix);
    if(result.error)return sendJson(409,{success:false,error:result.error});
    return sendJson(200,{success:true,location:safeLiveLocation(result.location,driver)});
  }

  // -----------------------------------------------------------------------

  // The passenger creates/reads their own short-lived in-app PIN here.
  // Never use idempotency receipts for PIN issuance: receipts persist responses.
  // This endpoint returns a PIN only to the verified passenger, never drivers.
  if(method==='POST' && pathname==='/api/bookings/boarding-pin'){
    if(!BOARDING_PIN_ENABLED||!pgRidesStore)
      return sendJson(503,{success:false,error:'BOARDING_PIN_NOT_ENABLED'});
    const body=await parseBody();
    try{
      const issued=await pgRidesStore.issueBoardingPin({
        bookingId:body.bookingId,passengerUserId:authenticatedUser.id
      });
      return sendJson(200,issued);
    }catch(err){
      if(PgPoolBusyError && err instanceof PgPoolBusyError)throw err;
      const known=err instanceof RidesError;
      return sendJson(known?err.status:500,{success:false,
        error:known?err.code:'DATABASE_ERROR'});
    }
  }

  // Only the ride's authenticated driver can attest passenger boarding.
  // PIN is NEVER echoed back or written into idempotency response receipts.
  if(method==='POST' && pathname==='/api/bookings/verify-boarding-pin'){
    if(!BOARDING_PIN_ENABLED||!pgRidesStore)
      return sendJson(503,{success:false,error:'BOARDING_PIN_NOT_ENABLED'});
    const body=await parseBody();
    try{
      // The booking row itself is the one-time idempotency guard. A direct
      // transaction is required: a wrong PIN must commit its failed-attempt
      // counter, while generic success-only receipts reject 4xx outcomes.
      const result=await pgRidesStore.verifyBoardingPin({
        bookingId:body.bookingId,pin:body.pin,
        driverUserId:authenticatedUser.id
      });
      return sendJson(result.status,result.body);
    }catch(err){
      if(PgPoolBusyError && err instanceof PgPoolBusyError)throw err;
      const known=err instanceof RidesError;
      return sendJson(known?err.status:500,{success:false,
        error:known?err.code:'DATABASE_ERROR'});
    }
  }

  // REST API: /api/bookings (List, Filter by user & Create with Settlement Check)
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/bookings') {
    const userEmail = parsedUrl.query?.email;
    if (userEmail && !isSelf(userEmail)) return sendJson(403, { success: false, error: 'NOT_ALLOWED' });
    const bookings=pgRidesStore
      ? await pgRidesStore.getBookingsByUser(authenticatedUser.id)
      : db.getBookingsByUser(authenticatedUser.email);
    return sendJson(200, { success: true, bookings:bookings.map(activeParticipantBooking) });
  }

  if (method === 'GET' && pathname === '/api/my-rides') {
    const userEmail = parsedUrl.query?.email;
    if (userEmail && !isSelf(userEmail)) return sendJson(403, { success: false, error: 'NOT_ALLOWED' });
    const rides = pgRidesStore
      ? await pgRidesStore.getRidesByDriver(authenticatedUser.id)
      : db.getRidesByDriver(authenticatedUser.email);
    return sendJson(200, { success: true, rides:rides.map(ownerRide) });
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    const body=await parseBody();
    try {
      return await executeIdempotentMutation(pathname,body,client=>{
        if(body.passengerEmail && !isSelf(body.passengerEmail)){
          rejectMutation(403,{success:false,error:'NOT_ALLOWED'});
        }
        const finish=settlementCheck=>{
          if(settlementCheck.isBlocked){
            const errorMsg=settlementCheck.hasUnsettledCommission
              ? `Settlement Required: You have ₹${settlementCheck.commissionDue} in pending platform commission from a previous ride. Payment verification is unavailable; existing obligations require review.`
              : `Payment Settlement Required: You have an unpaid ride booking (₹${settlementCheck.pendingBookings[0].studentFare} with ${settlementCheck.pendingBookings[0].driverName}). Payment verification is unavailable; existing obligations require review.`;
            rejectMutation(403,{
              success:false,error:'SETTLEMENT_REQUIRED',message:errorMsg,...safeSettlement(settlementCheck)
            });
          }
          if(pgRidesStore){
            return pgRidesStore.bookRide({
              rideId:body.rideId,passengerUserId:authenticatedUser.id,client
            }).then(booking=>({status:201,body:{success:true,booking:historicalBooking(booking)}}));
          }
          const booking=db.bookRide({
            rideId:body.rideId,passengerEmail:authenticatedUser.email,
            passengerName:authenticatedUser.name
          });
          invalidateRidesCache();
          return {status:201,body:{success:true,booking:historicalBooking(booking)}};
        };
        return pgRidesStore
          ? client.query('SELECT id FROM public.campus_users WHERE id=$1::uuid FOR UPDATE',
              [authenticatedUser.id]).then(() =>
              pgRidesStore.checkUserSettlementBlock(authenticatedUser.id,client).then(finish))
          : finish(db.checkUserSettlementBlock(authenticatedUser.email));
      });
    }catch(err){
      if(PgPoolBusyError && err instanceof PgPoolBusyError) throw err;
      if(pgRidesStore){
        const known=err instanceof RidesError;
        return sendJson(known?err.status:500,{success:false,
          error:known?err.code:'DATABASE_ERROR',
          message:known?err.code:'Booking could not be completed.'});
      }
      const statusCode=err.message.includes('not found')?404:400;
      return sendJson(statusCode,{success:false,message:err.message});
    }
  }

  // -----------------------------------------------------------------------
  // REST API: /api/user/settlement-status (Check dues for driver/passenger)
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/user/settlement-status') {
    const email = parsedUrl.query?.email;
    if (email && !isSelf(email)) return sendJson(403, { success: false, error: 'NOT_ALLOWED' });
    const status = pgRidesStore
      ? await pgRidesStore.checkUserSettlementBlock(authenticatedUser.id)
      : db.checkUserSettlementBlock(authenticatedUser.email);
    return sendJson(200, { success: true, ...safeSettlement(status) });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/driver/settle-commission (ACID Settle 10% Platform Commission)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/driver/settle-commission') {
    // A user click or client-provided UPI reference is not bank/payment-provider proof.
    return sendJson(501, { success: false, error: 'PAYMENT_VERIFICATION_REQUIRED',
      message: 'Settlement recording is disabled until a verified payment-provider callback is integrated.' });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/bookings/payment-status (Update UPI payment status)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/bookings/payment-status') {
    return sendJson(501, { success: false, error: 'PAYMENT_VERIFICATION_REQUIRED',
      message: 'Payment confirmation requires a verified payment-provider callback.' });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/bookings/cancel (Cancel booking & restore seat count)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/bookings/cancel') {
    const body = await parseBody();
    if (!body.bookingId) {
      return sendJson(400, { success: false, message: 'Booking ID required.' });
    }
    try {
      return await executeIdempotentMutation(pathname,body,client=>{
        if(pgRidesStore){
          return pgRidesStore.cancelBooking({
            bookingId:body.bookingId,passengerUserId:authenticatedUser.id,client
          }).then(result=>({status:200,body:{
            success:true,message:'Booking canceled and seat restored.',...result
          }}));
        }
        const result=db.cancelBooking(body.bookingId,authenticatedUser.email);
        invalidateRidesCache();
        return {status:200,body:{
          success:true,message:'Booking canceled and seat restored.',...result
        }};
      });
    } catch (err) {
      if(PgPoolBusyError && err instanceof PgPoolBusyError) throw err;
      if(pgRidesStore){
        const known=err instanceof RidesError;
        return sendJson(known?err.status:500,{success:false,
          error:known?err.code:'DATABASE_ERROR',
          message:known?err.code:'Cancellation could not be completed.'});
      }
      return sendJson(400, { success: false, message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // REST API: /api/rides/cancel (Cancel offered ride)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/rides/cancel') {
    const body = await parseBody();
    if (!body.rideId) {
      return sendJson(400, { success: false, message: 'Ride ID required.' });
    }
    try {
      return await executeIdempotentMutation(pathname,body,client=>{
        if(pgRidesStore){
          return pgRidesStore.cancelRide({
            rideId:body.rideId,driverUserId:authenticatedUser.id,client
          }).then(result=>({status:200,body:{
            success:true,message:'Offered ride canceled.',...result
          }}));
        }
        const result=db.cancelRide(body.rideId,authenticatedUser.email);
        invalidateRidesCache();
        return {status:200,body:{
          success:true,message:'Offered ride canceled.',...result
        }};
      });
    } catch (err) {
      if(PgPoolBusyError && err instanceof PgPoolBusyError) throw err;
      if(pgRidesStore){
        const known=err instanceof RidesError;
        return sendJson(known?err.status:500,{success:false,
          error:known?err.code:'DATABASE_ERROR',
          message:known?err.code:'Cancellation could not be completed.'});
      }
      return sendJson(400, { success: false, message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // Static File Serving (Security Hardened & In-Memory Cached with ETags)
  // -----------------------------------------------------------------------
  if (pathname.startsWith('/api/') || pathname === '/api') {
    return sendJson(404, { success: false, error: 'NOT_FOUND', message: 'Unknown API endpoint' });
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }
  // Explicit public asset allowlist blocks source code, runtime databases, secrets,
  // traversal and unrecognized paths (instead of returning index.html with HTTP 200).
  const publicAssets = new Set(['/', '/index.html', '/campuspool.css', '/mobility-ui.js', '/campuspool-icon.svg', '/manifest.webmanifest', '/sw.js', '/404.html', '/503.html']);
  if (!publicAssets.has(pathname)) {
    const html = fs.readFileSync(path.join(__dirname, '404.html'));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
    return res.end(method === 'HEAD' ? undefined : html);
  }
  const filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname.slice(1));

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';
  const cacheControl = (isHtml || pathname === '/mobility-ui.js')
    ? 'public, no-cache, must-revalidate'
    : 'public, max-age=604800, stale-while-revalidate=86400';

  let cached = staticFileCache.get(filePath);

  if (!cached) {
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('md5').update(content).digest('hex');
      const etag = `"${stats.size.toString(16)}-${hash.slice(0, 16)}"`;
      cached = {
        content,
        contentType,
        etag,
        mtime: stats.mtime.toUTCString(),
        cacheControl
      };
      staticFileCache.set(filePath, cached);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File Not Found');
    }
  }

  // Handle Conditional GET (If-None-Match -> HTTP 304 Not Modified)
  const clientEtag = req.headers['if-none-match'];
  if (clientEtag && (clientEtag === cached.etag || clientEtag === `W/${cached.etag}`)) {
    res.writeHead(304, {
      'ETag': cached.etag,
      'Cache-Control': cached.cacheControl,
      'X-Cache': 'HIT-304'
    });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': cached.contentType,
    'Content-Length': cached.content.length,
    'ETag': cached.etag,
    'Last-Modified': cached.mtime,
    'Cache-Control': cached.cacheControl,
    'X-Cache': 'HIT'
  });
  if (method === 'HEAD') return res.end();
  res.end(cached.content);
  } catch (err) {
    if (PgPoolBusyError && err instanceof PgPoolBusyError && !res.headersSent) {
      // De-phase retries without a queue, timer or automatic mutation replay.
      const retryAfter = crypto.randomInt(2, 5);
      console.warn(JSON.stringify({event:'db_pool_busy',status:503}));
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store','Retry-After':String(retryAfter)});
      return res.end(JSON.stringify({success:false,error:'DB_POOL_BUSY',retryAfter,
        message:'Oops, a campus traffic jam! Try the same action again in '+retryAfter+' seconds.'}));
    }
    const status = err && [400, 413].includes(err.httpStatus) ? err.httpStatus : 500;
    console.error(JSON.stringify({ event: 'request_failed', status, reason: status === 500 ? 'INTERNAL_ERROR' : err.message }));
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: false, error: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR', message: status === 500 ? 'An internal error occurred' : err.message }));
    } else {
      res.end();
    }
  }
});
  server.requestTimeout = 15000;
  server.headersTimeout = 16000;

  const startServer = async () => {
    if (pgOtpStore) { await pgOtpStore.ready(); await pgIdentity.pool.query('SELECT 1 FROM campus_users LIMIT 0'); await pgIdentity.pool.query('SELECT 1 FROM campus_sessions LIMIT 0'); }
    if (pgRidesStore) { await pgRidesStore.ready(); await pgIdempotency.ready(); }
    if (pgMobilityStore) await pgMobilityStore.ready();
    server.listen(PORT, '0.0.0.0', () => {
    const workerLabel = cluster.isWorker ? `Worker #${cluster.worker.id} (PID: ${process.pid})` : `Standalone Server (PID: ${process.pid})`;
    console.log(`[HTTP SERVER] ${workerLabel} active on port ${PORT}`);
  });
  };
  startServer().catch(error => {
    // Never log connection strings, credentials, or full error objects.
    const endpointKind = (() => {
      try {
        const host = new URL(process.env.OTP_DATABASE_URL || '').hostname;
        if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) return 'supabase-direct-ipv6';
        if (/\.pooler\.supabase\.com$/i.test(host)) return 'supabase-session-pooler';
        return 'other';
      } catch { return 'unset-or-invalid'; }
    })();
    console.error('[OTP] PostgreSQL auth backend could not initialize:', error.code || 'DATABASE_ERROR',
      '(endpoint type:', endpointKind + ')');
    if (error.code === 'ENETUNREACH' && endpointKind === 'supabase-direct-ipv6') {
      console.error('[OTP] Render requires the Supabase IPv4 Session Pooler URL, not the direct IPv6 database endpoint.');
    }
    process.exitCode = 1;
    void pgOtpStore?.close().finally(() => process.exit(1));
  });
}
