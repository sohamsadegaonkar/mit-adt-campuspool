// MIT ADT CampusPool - Load Balancer Verification & Distribution Test Suite
// Asserts Round-Robin Load Balancing, Multi-Worker Distribution & Shared State Sync

const assert = require('assert');

const BASE_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function runLoadBalancerTests() {
  console.log('⚖️  Starting MIT ADT CampusPool Load Balancer Test Suite...\n');
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
  // Test 1: Telemetry & Status API Verification (/api/lb-status)
  // -------------------------------------------------------------------------
  let lbConfig = null;
  await test('LB-01: /api/lb-status returns cluster load balancer telemetry', async () => {
    const res = await fetch(`${BASE_URL}/api/lb-status`);
    assert.strictEqual(res.status, 200, 'LB status should return 200 OK');
    const data = await res.json();
    assert.strictEqual(data.status, 'healthy');
    assert.ok(data.loadBalancer, 'Telemetry must contain loadBalancer object');
    assert.ok(data.loadBalancer.type.includes('Cluster Load Balancer'), 'Must identify as Cluster Load Balancer');
    assert.ok(data.loadBalancer.totalWorkers >= 2, `Expected at least 2 workers, found ${data.loadBalancer.totalWorkers}`);
    assert.ok(data.loadBalancer.workerPid > 0, 'workerPid must be positive integer');
    lbConfig = data.loadBalancer;
    console.log(`     [LB Mode: ${data.loadBalancer.type} | Workers: ${data.loadBalancer.totalWorkers} | Policy: ${data.loadBalancer.algorithm}]`);
  });

  // -------------------------------------------------------------------------
  // Test 2: Multi-Worker Request Distribution (Round-Robin Verification)
  // -------------------------------------------------------------------------
  await test('LB-02: Rapid concurrent requests are distributed across distinct worker processes', async () => {
    const REQUEST_COUNT = 24;
    const workerPidCounts = new Map();
    const workerIdCounts = new Map();

    const fetchPromises = Array.from({ length: REQUEST_COUNT }, async (_, i) => {
      const res = await fetch(`${BASE_URL}/api/lb-status?req=${i}`);
      assert.strictEqual(res.status, 200);
      const pid = res.headers.get('x-worker-pid') || 'unknown';
      const id = res.headers.get('x-worker-id') || 'unknown';
      const lbHeader = res.headers.get('x-load-balancer');

      assert.strictEqual(lbHeader, 'Node-Cluster-Round-Robin', 'Header X-Load-Balancer must be present');

      workerPidCounts.set(pid, (workerPidCounts.get(pid) || 0) + 1);
      workerIdCounts.set(id, (workerIdCounts.get(id) || 0) + 1);
      return { pid, id };
    });

    await Promise.all(fetchPromises);

    console.log('\n     📊 Request Distribution Across Clustered Workers:');
    console.log('     ---------------------------------------------------');
    for (const [pid, count] of workerPidCounts.entries()) {
      const pct = Math.round((count / REQUEST_COUNT) * 100);
      console.log(`     Worker PID ${pid.padEnd(8)}: ${count.toString().padStart(2)} requests (${pct.toString().padStart(2)}%) ${'█'.repeat(Math.round(pct / 5))}`);
    }
    console.log('     ---------------------------------------------------\n');

    const uniquePids = workerPidCounts.size;
    assert.ok(uniquePids >= 2, `Expected requests to be distributed to at least 2 distinct worker PIDs, but got ${uniquePids}`);
  });

  // -------------------------------------------------------------------------
  // Test 3: Cross-Worker Real-Time Shared State Sync (GPS Synchronization)
  // -------------------------------------------------------------------------
  await test('LB-03: Real-Time GPS updates written by one worker are immediately readable by any other worker', async () => {
    const testRideId = `lb_test_ride_${Date.now()}`;
    const gpsLocation = {
      rideId: testRideId,
      lat: 18.4904,
      lng: 74.0253,
      speed: 42,
      heading: 270,
      accuracy: 6
    };

    // 1. Post to Load Balancer (Routed to Worker A)
    const postRes = await fetch(`${BASE_URL}/api/rides/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gpsLocation)
    });
    assert.strictEqual(postRes.status, 200);
    const workerA = postRes.headers.get('x-worker-pid');

    // 2. Query from Load Balancer (May be routed to Worker B, C, or D)
    const getRes = await fetch(`${BASE_URL}/api/rides/location?rideId=${testRideId}`);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    const workerB = getRes.headers.get('x-worker-pid');

    assert.strictEqual(getData.success, true);
    assert.strictEqual(getData.location.lat, 18.4904);
    assert.strictEqual(getData.location.speed, 42);
    console.log(`     [GPS Write Worker PID: ${workerA} -> Read Worker PID: ${workerB} (Sync OK)]`);
  });

  // -------------------------------------------------------------------------
  // Test 4: ACID Concurrency Under Load (No SQLite Locks)
  // -------------------------------------------------------------------------
  await test('LB-04: Concurrent writes across clustered workers execute without SQLITE_BUSY', async () => {
    const CONCURRENT_WRITES = 12;
    const writePromises = Array.from({ length: CONCURRENT_WRITES }, async (_, i) => {
      const res = await fetch(`${BASE_URL}/api/rides/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rideId: `concurrent_test_${i}`,
          lat: 18.49 + (i * 0.001),
          lng: 74.02 + (i * 0.001),
          speed: 30 + i
        })
      });
      assert.strictEqual(res.status, 200, `Concurrent write #${i} should return 200`);
      return res.json();
    });

    const results = await Promise.all(writePromises);
    assert.strictEqual(results.length, CONCURRENT_WRITES);
    console.log(`     [${CONCURRENT_WRITES} parallel writes completed successfully without concurrency lock errors]`);
  });

  console.log(`\n========================================================`);
  console.log(` Load Balancer Results: ${passed} Passed | ${failed} Failed`);
  console.log(`========================================================\n`);

  if (failed > 0) process.exit(1);
}

runLoadBalancerTests().catch(err => {
  console.error('Load balancer test runner error:', err);
  process.exit(1);
});
