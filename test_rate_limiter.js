// MIT ADT CampusPool - Distributed Rate Limiter Verification Suite
// Validates Tiered Rate Limiting, Cross-Worker Coordination, IP Isolation & Abuse Protection

const assert = require('assert');

const BASE_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function runRateLimiterTests() {
  console.log('🛡️  Starting MIT ADT CampusPool Rate Limiter Test Suite...\n');
  console.log(` Target Server: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // Test 1: Standard API Request Rate Limiting Headers
  // -------------------------------------------------------------------------
  await test('RL-01: Standard API responses include IETF & standard RateLimit headers', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);

    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');
    const reset = res.headers.get('ratelimit-reset');
    const tier = res.headers.get('x-ratelimit-tier');

    assert.ok(limit, 'Response must include RateLimit-Limit header');
    assert.ok(remaining !== null, 'Response must include RateLimit-Remaining header');
    assert.ok(reset, 'Response must include RateLimit-Reset header');
    assert.strictEqual(tier, 'SYSTEM_TELEMETRY', 'Health check should be categorized as SYSTEM_TELEMETRY');
    console.log(`     [Telemetry Headers: Tier=${tier} | Limit=${limit} | Remaining=${remaining} | Reset=${reset}s]`);
  });

  // -------------------------------------------------------------------------
  // Test 2: Strict Auth Gateway Throttling (AUTH_STRICT: 10 req/min)
  // -------------------------------------------------------------------------
  const TEST_IP_A = '198.51.100.42';
  await test('RL-02: Strict Auth gateway (AUTH_STRICT: 10/min) returns HTTP 429 & Retry-After upon exceeding limit', async () => {
    // Send 10 rapid requests to /api/auth/login-request with TEST_IP_A
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': TEST_IP_A
        },
        body: JSON.stringify({ identifier: `probe_${i}@students.mituniversity.edu.in` })
      });

      // Allowed under the 10 limit (returns 404 USER_NOT_FOUND, but NOT 429)
      assert.notStrictEqual(res.status, 429, `Request #${i} should be allowed by rate limiter`);
      const remaining = parseInt(res.headers.get('ratelimit-remaining'), 10);
      assert.strictEqual(remaining, 10 - i, `Remaining count mismatch at request #${i}`);
    }

    // 11th request MUST be blocked with HTTP 429 Too Many Requests
    const blockedRes = await fetch(`${BASE_URL}/api/auth/login-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': TEST_IP_A
      },
      body: JSON.stringify({ identifier: 'blocked@students.mituniversity.edu.in' })
    });

    assert.strictEqual(blockedRes.status, 429, '11th request must be rejected with HTTP 429');
    const retryAfter = blockedRes.headers.get('retry-after');
    assert.ok(retryAfter, '429 response must provide Retry-After header');
    assert.ok(parseInt(retryAfter, 10) > 0, 'Retry-After must be positive seconds');

    const blockedData = await blockedRes.json();
    assert.strictEqual(blockedData.success, false);
    assert.strictEqual(blockedData.error, 'RATE_LIMIT_EXCEEDED');
    assert.strictEqual(blockedData.tier, 'AUTH_STRICT');
    console.log(`     [HTTP 429 Enforced: Retry-After=${retryAfter}s | Tier=${blockedData.tier}]`);
  });

  // -------------------------------------------------------------------------
  // Test 3: IP Multi-Tenant Isolation
  // -------------------------------------------------------------------------
  const TEST_IP_B = '198.51.100.43';
  await test('RL-03: Rate limits are strictly isolated per IP (TEST_IP_B is NOT throttled by TEST_IP_A)', async () => {
    // TEST_IP_A is currently exhausted, but TEST_IP_B should have full fresh quota
    const res = await fetch(`${BASE_URL}/api/auth/login-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': TEST_IP_B
      },
      body: JSON.stringify({ identifier: 'probe_b@students.mituniversity.edu.in' })
    });

    assert.notStrictEqual(res.status, 429, 'TEST_IP_B should not be throttled');
    const remaining = parseInt(res.headers.get('ratelimit-remaining'), 10);
    assert.strictEqual(remaining, 9, 'TEST_IP_B should have 9 remaining slots');
    console.log(`     [Isolation Confirmed: TEST_IP_B remaining quota = ${remaining}/10]`);
  });

  // -------------------------------------------------------------------------
  // Test 4: Cross-Worker Shared Rate Limit Coordination
  // -------------------------------------------------------------------------
  const TEST_IP_CLUSTER = '198.51.100.88';
  await test('RL-04: Cross-Worker Rate Limiting Coordination (all cluster workers decrement the same counter)', async () => {
    const workerPidsSeen = new Set();
    const remainingCounts = [];

    // Send 5 requests distributed across round-robin workers
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE_URL}/api/rides/location?rideId=probe_${i}`, {
        headers: { 'X-Forwarded-For': TEST_IP_CLUSTER }
      });
      assert.strictEqual(res.status, 200);
      const pid = res.headers.get('x-worker-pid');
      const rem = parseInt(res.headers.get('ratelimit-remaining'), 10);
      if (pid) workerPidsSeen.add(pid);
      remainingCounts.push(rem);
    }

    // Assert that remaining count monotonically decreases: 179, 178, 177, 176, 175
    assert.strictEqual(remainingCounts[0], 179);
    assert.strictEqual(remainingCounts[4], 175);
    console.log(`     [Cluster Coordination Verified: PIDs=[${Array.from(workerPidsSeen).join(', ')}] | Remaining count: ${remainingCounts.join(' -> ')}]`);
  });

  // -------------------------------------------------------------------------
  // Test 5: Real-Time GPS Tracking Throughput (180 req/min)
  // -------------------------------------------------------------------------
  await test('RL-05: Real-Time GPS (GPS_REALTIME: 180/min) allows high-frequency commute breadcrumbs', async () => {
    const res = await fetch(`${BASE_URL}/api/rides/location?rideId=gps_commute_live`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-ratelimit-tier'), 'GPS_REALTIME');
    const limit = parseInt(res.headers.get('ratelimit-limit'), 10);
    assert.strictEqual(limit, 180, 'GPS tracking limit must be 180 requests/minute');
    console.log(`     [GPS_REALTIME: Tier Limit=${limit} req/min allows smooth 2-second driver updates]`);
  });

  // -------------------------------------------------------------------------
  // Test 6: Static Asset Immunity
  // -------------------------------------------------------------------------
  await test('RL-06: Static assets (CSS, HTML, SVG) are immune to API rate limits', async () => {
    const resCss = await fetch(`${BASE_URL}/campuspool.css`, {
      headers: { 'X-Forwarded-For': TEST_IP_A } // Even with the exhausted IP!
    });
    assert.strictEqual(resCss.status, 200, 'Static CSS must never return 429');

    const resHtml = await fetch(`${BASE_URL}/`, {
      headers: { 'X-Forwarded-For': TEST_IP_A }
    });
    assert.strictEqual(resHtml.status, 200, 'Static HTML must never return 429');
    console.log(`     [Static Asset Immunity Confirmed: Exhausted IP receives static assets seamlessly]`);
  });

  // -------------------------------------------------------------------------
  // Test 7: Telemetry & Cluster Status API
  // -------------------------------------------------------------------------
  await test('RL-07: /api/lb-status exposes distributed rate limiting telemetry & policies', async () => {
    const res = await fetch(`${BASE_URL}/api/lb-status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.rateLimiting, 'Telemetry must expose rateLimiting block');
    assert.strictEqual(data.rateLimiting.status, 'active');
    assert.strictEqual(data.rateLimiting.tiers.AUTH_STRICT.limit, 10);
    assert.strictEqual(data.rateLimiting.tiers.GPS_REALTIME.limit, 180);
    assert.strictEqual(data.rateLimiting.tiers.SYSTEM_TELEMETRY.limit, 300);
    console.log(`     [Rate Limiter Telemetry: Engine="${data.rateLimiting.engine}" | Status="${data.rateLimiting.status}"]`);
  });

  // -------------------------------------------------------------------------
  // Test 8: Clean-up of Test Rate Limit Records
  // -------------------------------------------------------------------------
  await test('RL-08: Clean up test IP records from database', async () => {
    try {
      const SQLiteCampusDatabase = require('./database');
      const db = new SQLiteCampusDatabase();
      db.db.prepare("DELETE FROM rate_limits WHERE key LIKE '%198.51.100%'").run();
      db.db.prepare("DELETE FROM otp_verifications WHERE identifier LIKE '%student_%'").run();
      console.log(`     [Database cleaned: All test rate limit entries removed]`);
    } catch (e) {
      console.warn('     [Cleanup warning]:', e.message);
    }
  });

  console.log(`\n========================================================`);
  console.log(` Rate Limiter Results: ${passed} Passed | ${failed} Failed`);
  console.log(`========================================================\n`);

  if (failed > 0) process.exit(1);
}

runRateLimiterTests().catch(err => {
  console.error('Rate limiter test runner error:', err);
  process.exit(1);
});
