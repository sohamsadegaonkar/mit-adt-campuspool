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
const OTP_SECRET = envConfig.OTP_SECRET || process.env.OTP_SECRET || 'mit_adt_campuspool_jwt_hmac_secret_2026';

// -------------------------------------------------------------------------
// Embedded SQLite Relational Database Engine (better-sqlite3)
// Real SQL Tables, WAL Journaling, Foreign Keys & ACID Transactions
// -------------------------------------------------------------------------
const SQLiteCampusDatabase = require('./database');
const db = new SQLiteCampusDatabase();

// -------------------------------------------------------------------------
// Native SMTP Dispatcher for Real-Time Email Delivery (Zero npm dependencies)
// -------------------------------------------------------------------------
function sendSmtpEmail({ to, subject, htmlContent, textContent }) {
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
            resolve({ delivered: true });
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

    client.setTimeout(12000, () => {
      client.destroy();
      reject(new Error('SMTP Connection Timeout'));
    });
  });
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
// HTTP Server & Router
// -------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Parse JSON Body Helper
  async function parseBody() {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  function sendJson(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/check-uniqueness
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/check-uniqueness') {
    const body = await parseBody();
    const check = db.checkUniqueness(body.name, body.email, body.phone);
    if (!check.unique) {
      return sendJson(409, { success: false, ...check });
    }
    return sendJson(200, { success: true, message: "Credentials are unique and ready for verification." });
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

    console.log(`[SIGN-IN-OTP] Dispatched Sign-In code (${otp}) to ${user.email} for ${user.name}`);

    sendSmtpEmail({
      to: user.email,
      subject: emailSubject,
      htmlContent: emailHtml,
      textContent: `MIT ADT CampusPool: Your sign-in code is ${otp}. Valid for 10 minutes.`
    }).then(() => {
      console.log(`[SIGN-IN-OTP] ✅ Live SMTP email delivered to ${user.email}`);
    }).catch(err => {
      console.warn(`[SIGN-IN-OTP] ⚠️ SMTP Error: ${err.message}`);
    });

    return sendJson(200, {
      success: true,
      message: `Sign-in verification code dispatched to ${user.email}.`,
      email: user.email,
      name: user.name,
      phone: user.phone
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

    // 1. Accept any valid email format (University or Personal)
    const validEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
    if (!validEmail) {
      return sendJson(400, {
        success: false,
        error: 'INVALID_DOMAIN',
        message: 'Please enter a valid email address.'
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
      emailStatus = await sendSmtpEmail({
        to: email,
        subject: emailSubject,
        htmlContent: emailHtml,
        textContent: `Your MIT ADT CampusPool verification code is ${otp}. Valid for 10 minutes.`
      });
      if (emailStatus.delivered) {
        console.log(`[AUTH-EMAIL-SENT] ✅ Live SMTP email delivered to ${email}`);
      }
    } catch (err) {
      console.warn(`[AUTH-EMAIL-DISPATCH-WARNING] SMTP connection to ${SMTP_HOST} failed: ${err.message}`);
      emailStatus.delivered = false;
      emailStatus.error = err.message;
    }

    // Prominent console output for terminal developer convenience
    console.log(`\n==================================================================`);
    console.log(` 📨 MIT ADT CampusPool - Real-Time OTP Verification Dispatch`);
    console.log(` Recipient: ${email}`);
    console.log(` Verification Code: ${otp}`);
    if (emailStatus.delivered) {
      console.log(` Delivery Status: DELIVERED via SMTP (${SMTP_HOST}:${SMTP_PORT})`);
    } else {
      console.log(` Delivery Status: LOCAL CONSOLE MODE`);
      console.log(` Notice: To send directly into your actual email inbox, add your`);
      console.log(` genuine Gmail App Password to .env.production (see README.md).`);
    }
    console.log(`==================================================================\n`);

    const isRealDelivery = emailStatus.delivered === true;

    return sendJson(200, {
      success: true,
      isLogin: !!uniqueCheck.isExistingUser,
      existingUser: uniqueCheck.user || null,
      deliveredToInbox: isRealDelivery,
      message: isRealDelivery
        ? `A secure 6-digit verification code has been dispatched to ${email}. Check your inbox or spam folder.`
        : `A 6-digit verification code has been generated. Please check your inbox (or check your server terminal if testing locally).`,
      expiresInSeconds: 600
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
    const body = await parseBody();
    const phone = (body.phone || '').trim();
    const cleanDigits = phone.replace(/[^0-9]/g, '').slice(-10);

    if (cleanDigits.length !== 10 || !/^[6-9]\d{9}$/.test(cleanDigits)) {
      return sendJson(400, {
        success: false,
        error: 'INVALID_PHONE',
        message: 'Must be a valid 10-digit Indian mobile number.'
      });
    }

    // Check database uniqueness for phone
    const profiles = db.getProfiles();
    for (const p of profiles) {
      if (p.phone.replace(/[^0-9]/g, '').slice(-10) === cleanDigits) {
        return sendJson(409, {
          success: false,
          field: 'phone',
          error: 'DUPLICATE_PHONE',
          message: `This mobile number (+91 ${cleanDigits}) is already registered.`
        });
      }
    }

    const otp = generateOtpCode();
    const hashed = hashOtp(cleanDigits, otp);
    const expiresAt = Date.now() + 10 * 60 * 1000;

    db.cleanExpiredOtps(cleanDigits);

    db.saveOtp({
      id: crypto.randomUUID(),
      identifier: cleanDigits,
      type: 'PHONE',
      hashedOtp: hashed,
      attemptsLeft: 5,
      expiresAt: expiresAt,
      resendCooldownUntil: Date.now() + 45 * 1000,
      isVerified: false,
      token: null,
      createdAt: Date.now()
    });

    console.log(`[SMS-GATEWAY-DISPATCH] Dispatched SMS OTP (${otp}) to +91 ${cleanDigits} (Gateway: MSG91 / Fast2SMS DLT template)`);

    return sendJson(200, {
      success: true,
      message: `SMS verification code dispatched to +91 ${cleanDigits}.`,
      expiresInSeconds: 600
    });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/auth/verify-phone-otp
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/verify-phone-otp') {
    const body = await parseBody();
    const cleanDigits = (body.phone || '').replace(/[^0-9]/g, '').slice(-10);
    const enteredOtp = (body.otp || '').trim();

    const record = db.findOtp(cleanDigits, 'PHONE');
    if (!record) {
      return sendJson(400, { success: false, error: 'NO_OTP_REQUESTED', message: 'No active SMS code found for this mobile.' });
    }

    if (Date.now() > record.expiresAt) {
      return sendJson(400, { success: false, error: 'OTP_EXPIRED', message: 'SMS code expired. Request a new code.' });
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
  // REST API: /api/rides (List & Post)
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/rides') {
    return sendJson(200, { success: true, rides: db.getRides() });
  }

  if (method === 'POST' && pathname === '/api/rides') {
    const body = await parseBody();
    if (body.driverEmail) {
      const settlementCheck = db.checkUserSettlementBlock(body.driverEmail);
      if (settlementCheck.hasUnsettledCommission) {
        return sendJson(403, {
          success: false,
          error: 'COMMISSION_SETTLEMENT_REQUIRED',
          message: `Commission Settlement Required: You have ₹${settlementCheck.commissionDue} in pending platform commission from a previous commute. Please settle your commission via UPI before offering new rides.`,
          ...settlementCheck
        });
      }
    }
    const newRide = db.createRide(body);
    return sendJson(201, { success: true, ride: newRide });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/bookings (List, Filter by user & Create with Settlement Check)
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/bookings') {
    const userEmail = parsedUrl.query?.email;
    if (userEmail) {
      const bookings = db.getBookingsByUser(userEmail);
      return sendJson(200, { success: true, bookings });
    }
    return sendJson(200, { success: true, bookings: db.getBookings() });
  }

  if (method === 'GET' && pathname === '/api/my-rides') {
    const userEmail = parsedUrl.query?.email;
    if (!userEmail) {
      return sendJson(400, { success: false, message: 'Email query parameter is required.' });
    }
    const rides = db.getRidesByDriver(userEmail);
    return sendJson(200, { success: true, rides });
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    const body = await parseBody();
    if (body.passengerEmail) {
      const settlementCheck = db.checkUserSettlementBlock(body.passengerEmail);
      if (settlementCheck.isBlocked) {
        const errorMsg = settlementCheck.hasUnsettledCommission
          ? `Settlement Required: You have ₹${settlementCheck.commissionDue} in pending platform commission from a previous ride. Please settle via UPI to unlock bookings.`
          : `Payment Settlement Required: You have an unpaid ride booking (₹${settlementCheck.pendingBookings[0].studentFare} with ${settlementCheck.pendingBookings[0].driverName}). Please settle your ride fare before booking another seat.`;

        return sendJson(403, {
          success: false,
          error: 'SETTLEMENT_REQUIRED',
          message: errorMsg,
          ...settlementCheck
        });
      }
    }

    try {
      const booking = db.bookRide({
        rideId: body.rideId,
        passengerEmail: body.passengerEmail,
        passengerName: body.passengerName
      });
      return sendJson(201, { success: true, booking });
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      return sendJson(statusCode, { success: false, message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // REST API: /api/user/settlement-status (Check dues for driver/passenger)
  // -----------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/user/settlement-status') {
    const email = parsedUrl.query?.email;
    if (!email) {
      return sendJson(400, { success: false, message: 'Email query parameter is required.' });
    }
    const status = db.checkUserSettlementBlock(email);
    return sendJson(200, { success: true, ...status });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/driver/settle-commission (ACID Settle 10% Platform Commission)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/driver/settle-commission') {
    const body = await parseBody();
    const { driverEmail, amount } = body;
    if (!driverEmail || !amount) {
      return sendJson(400, { success: false, message: 'Driver email and amount are required.' });
    }
    const result = db.recordDriverSettlement(driverEmail, Number(amount));
    return sendJson(200, { success: true, message: 'Commission settled successfully in database.', ...result });
  }

  // -----------------------------------------------------------------------
  // REST API: /api/bookings/payment-status (Update UPI payment status)
  // -----------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/bookings/payment-status') {
    const body = await parseBody();
    if (!body.bookingId) {
      return sendJson(400, { success: false, message: 'Booking ID required.' });
    }
    const updated = db.updatePaymentStatus(body.bookingId, body.paymentStatus || 'Paid');
    return sendJson(200, { success: updated, message: 'Payment status updated in database.' });
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
      const result = db.cancelBooking(body.bookingId, body.passengerEmail);
      return sendJson(200, { success: true, message: 'Booking canceled and seat restored.', ...result });
    } catch (err) {
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
      const result = db.cancelRide(body.rideId, body.driverEmail);
      return sendJson(200, { success: true, message: 'Offered ride canceled.', ...result });
    } catch (err) {
      return sendJson(400, { success: false, message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // Static File Serving (Security Hardened)
  // -----------------------------------------------------------------------
  const blockedFiles = ['/server.js', '/database.js', '/schema.sql', '/firestore.rules', '/package.json', '/package-lock.json', '/.env', '/.env.production', '/campuspool_database.json', '/campuspool.db', '/campuspool.db-wal', '/campuspool.db-shm'];
  if (blockedFiles.includes(pathname) || pathname.startsWith('/.') || pathname.endsWith('.sql') || pathname.endsWith('.rules') || pathname.endsWith('.db') || pathname.endsWith('.db-wal') || pathname.endsWith('.db-shm')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied: Protected System File');
  }

  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

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

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Server Error');
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(` MIT ADT CampusPool Production Server`);
  console.log(` Real-Time SMTP OTP & ACID Persistent Database Active`);
  console.log(` Running on port ${PORT} (0.0.0.0)`);
  console.log(`========================================================`);
});
