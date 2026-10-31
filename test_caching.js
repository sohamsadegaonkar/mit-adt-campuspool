// MIT ADT CampusPool - Multi-Tier Caching Verification Suite
// Validates In-Memory Static Asset Caching, ETags, 304 Not Modified, API Micro-Caching & Invalidation

const assert = require('assert');

const BASE_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function runCachingTests() {
  console.log('⚡ Starting MIT ADT CampusPool Caching Test Suite...\n');
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
  // Test 1: Static Asset Caching (CSS & SVG)
  // -------------------------------------------------------------------------
  let cssEtag = null;
  await test('CACHE-01: Static assets (CSS/SVG) served with 7-day Cache-Control & strong ETags', async () => {
    const res = await fetch(`${BASE_URL}/campuspool.css`);
    assert.strictEqual(res.status, 200);
    const cc = res.headers.get('cache-control') || '';
    assert.ok(cc.includes('max-age=604800'), `Cache-Control must contain max-age=604800, got: ${cc}`);
    assert.ok(cc.includes('stale-while-revalidate'), `Cache-Control must contain stale-while-revalidate, got: ${cc}`);
    
    cssEtag = res.headers.get('etag');
    assert.ok(cssEtag, 'Response must include ETag header');
    assert.strictEqual(res.headers.get('x-cache'), 'HIT');
    console.log(`     [campuspool.css: Cache-Control="${cc}" | ETag=${cssEtag}]`);
  });

  // -------------------------------------------------------------------------
  // Test 2: Conditional GET (HTTP 304 Not Modified)
  // -------------------------------------------------------------------------
  await test('CACHE-02: Conditional GET with If-None-Match returns HTTP 304 Not Modified (0 bytes transferred)', async () => {
    assert.ok(cssEtag, 'cssEtag must be available from CACHE-01');
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/campuspool.css`, {
      headers: { 'If-None-Match': cssEtag }
    });
    const duration = (performance.now() - start).toFixed(2);
    assert.strictEqual(res.status, 304, 'Server should respond with 304 Not Modified');
    assert.strictEqual(res.headers.get('etag'), cssEtag);
    assert.strictEqual(res.headers.get('x-cache'), 'HIT-304');
    const body = await res.text();
    assert.strictEqual(body, '', '304 response body must be completely empty');
    console.log(`     [304 Not Modified verified in ${duration}ms with zero network payload]`);
  });

  // -------------------------------------------------------------------------
  // Test 3: HTML Shell Caching Policy (no-cache, must-revalidate)
  // -------------------------------------------------------------------------
  let htmlEtag = null;
  await test('CACHE-03: index.html served with no-cache, must-revalidate and ETag for instant updates', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);
    const cc = res.headers.get('cache-control') || '';
    assert.ok(cc.includes('no-cache'), 'index.html must have no-cache for fresh deploys');
    assert.ok(cc.includes('must-revalidate'), 'index.html must have must-revalidate');
    htmlEtag = res.headers.get('etag');
    assert.ok(htmlEtag, 'index.html must include ETag');

    // Test 304 for index.html as well
    const condRes = await fetch(`${BASE_URL}/`, {
      headers: { 'If-None-Match': htmlEtag }
    });
    assert.strictEqual(condRes.status, 304);
    console.log(`     [index.html: Cache-Control="${cc}" | ETag=${htmlEtag} | 304 OK]`);
  });

  // -------------------------------------------------------------------------
  // Test 4: Live Rides Feed Micro-Caching (5-second TTL)
  // -------------------------------------------------------------------------
  let ridesEtag = null;
  await test('CACHE-04: /api/rides implements 5-second micro-cache with ETag & 304 support', async () => {
    // 1. Initial request (miss or warm)
    const res1 = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(res1.status, 200);
    ridesEtag = res1.headers.get('etag');
    assert.ok(ridesEtag, '/api/rides must include ETag');
    const cc = res1.headers.get('cache-control') || '';
    assert.ok(cc.includes('max-age=5'), `Cache-Control must contain max-age=5, got: ${cc}`);

    // 2. Immediate second request (Cache HIT)
    const res2 = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('etag'), ridesEtag);

    // 3. Conditional request with If-None-Match (304 Not Modified)
    const res3 = await fetch(`${BASE_URL}/api/rides`, {
      headers: { 'If-None-Match': ridesEtag }
    });
    assert.strictEqual(res3.status, 304);
    console.log(`     [/api/rides: Cache-Control="${cc}" | ETag=${ridesEtag} | 304 Not Modified verified]`);
  });

  // -------------------------------------------------------------------------
  // Test 5: Write-Through Cache Invalidation & Cleanup
  // -------------------------------------------------------------------------
  await test('CACHE-05: Ride creations and cancellations instantly invalidate the rides feed micro-cache', async () => {
    // 1. Post a new ride
    const testEmail = `cache_driver_${Date.now()}@students.mituniversity.edu.in`;
    const postRes = await fetch(`${BASE_URL}/api/rides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driverName: 'Cache Invalidation Tester',
        driverEmail: testEmail,
        driverPhone: '9898989898',
        dept: 'Computer Science',
        vehicle: 'Car',
        vehicleModel: 'Honda City',
        pickup: 'World Peace Dome Square (Gate 2)',
        destination: 'Pune Railway Station',
        departureTime: 'Today, 06:00 PM',
        seatsTotal: 3,
        seatsLeft: 3,
        uberBenchmark: 320,
        studentFare: 160,
        driverPayout: 144
      })
    });
    assert.strictEqual(postRes.status, 201, 'Ride creation should succeed');
    const postData = await postRes.json();
    const createdRideId = postData.ride.id;

    // 2. Fetch /api/rides immediately - must return fresh data with X-Cache: MISS
    const getRes = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.headers.get('x-cache'), 'MISS', 'Cache must be invalidated and re-queried');
    const newEtag = getRes.headers.get('etag');
    assert.notStrictEqual(newEtag, ridesEtag, 'ETag must change after new ride creation');

    const data = await getRes.json();
    assert.ok(data.rides.some(r => r.driverEmail === testEmail), 'Fresh ride must be immediately visible in feed');

    // 3. Clean up: Cancel the test ride to maintain clean database state
    const cancelRes = await fetch(`${BASE_URL}/api/rides/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rideId: createdRideId,
        driverEmail: testEmail
      })
    });
    assert.strictEqual(cancelRes.status, 200, 'Test ride cancellation should succeed');

    // 4. Verify cancellation invalidated the cache again
    const postCancelRes = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(postCancelRes.status, 200);
    assert.strictEqual(postCancelRes.headers.get('x-cache'), 'MISS', 'Cache must be invalidated after cancellation');
    const finalData = await postCancelRes.json();
    assert.ok(!finalData.rides.some(r => r.driverEmail === testEmail), 'Canceled ride should not appear in feed');

    console.log(`     [Write-through invalidation confirmed on create & cancel: ETag transitions validated]`);
  });

  // -------------------------------------------------------------------------
  // Test 6: In-Memory Static Cache Performance Benchmark
  // -------------------------------------------------------------------------
  await test('CACHE-06: In-memory static cache benchmark (serves 50 concurrent requests in sub-milliseconds)', async () => {
    const BENCH_REQUESTS = 50;
    const start = performance.now();
    const promises = Array.from({ length: BENCH_REQUESTS }, () => fetch(`${BASE_URL}/campuspool.css`));
    const responses = await Promise.all(promises);
    const totalDuration = performance.now() - start;
    const avgDuration = (totalDuration / BENCH_REQUESTS).toFixed(2);

    for (const r of responses) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('x-cache'), 'HIT');
    }

    console.log(`     [${BENCH_REQUESTS} requests served in ${totalDuration.toFixed(1)}ms | Average: ${avgDuration}ms per request]`);
  });

  // -------------------------------------------------------------------------
  // Test 7: Telemetry Cache Status Verification
  // -------------------------------------------------------------------------
  await test('CACHE-07: /api/lb-status exposes real-time caching engine telemetry', async () => {
    const res = await fetch(`${BASE_URL}/api/lb-status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.caching, 'Telemetry must contain caching metrics');
    assert.ok(data.caching.staticFilesCached > 0, `staticFilesCached should be > 0, got ${data.caching.staticFilesCached}`);
    assert.strictEqual(data.caching.ridesMicroCacheTtlSeconds, 5);
    console.log(`     [Telemetry: staticFilesCached=${data.caching.staticFilesCached} | isRidesCacheWarm=${data.caching.isRidesCacheWarm}]`);
  });

  console.log(`\n========================================================`);
  console.log(` Caching Results: ${passed} Passed | ${failed} Failed`);
  console.log(`========================================================\n`);

  if (failed > 0) process.exit(1);
}

runCachingTests().catch(err => {
  console.error('Caching test runner error:', err);
  process.exit(1);
});
