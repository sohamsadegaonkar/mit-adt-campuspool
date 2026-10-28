// QA Regression Verification Suite for MIT-ADT CampusPool v1.2
// Validates Santana et al. 4-Gate Production Hardening, BUG-CP-04, UX-05, UX-06 & Zero-Seed Clean State

const assert = require('assert');

async function runTests() {
  console.log('🚀 Starting MIT-ADT CampusPool v1.2 QA Regression & Zero-Seed Verification Suite...\n');
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

  const BASE_URL = 'http://localhost:3000';

  // Fetch index.html
  const res = await fetch(`${BASE_URL}/`);
  assert.strictEqual(res.status, 200, 'Server should respond with 200 OK');
  const html = await res.text();

  // Test 1: BUG-CP-01 - Static UPI Intent Links
  await test('TC-01: Static UPI settlement links match /^upi:\\/\\/pay\\?pa=campuspool\\.mitadt@okaxis/', () => {
    const upiLinkRegex = /href="upi:\/\/pay\?pa=campuspool\.mitadt@okaxis[^"]*"/g;
    const matches = html.match(upiLinkRegex);
    assert.ok(matches && matches.length >= 2, `Expected at least 2 static UPI links, found ${matches ? matches.length : 0}`);
    
    assert.ok(html.includes('id="settleUpiLinkBtn" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'settleUpiLinkBtn must have valid UPI intent href');
    assert.ok(html.includes('id="settleActionUpiLink" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'settleActionUpiLink must have valid UPI intent href');
    assert.ok(html.includes('id="paymentUpiLinkBtn" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'paymentUpiLinkBtn must have valid UPI intent href');
  });

  // Test 2: BUG-CP-02 & UX-05 - Non-empty QR src and inline SVG fallback
  await test('TC-02: QR code img[alt="Scan UPI QR"] has non-empty src, VPA text & UX-05 offline fallback', () => {
    assert.ok(!html.includes('id="settleQrCodeImg" src=""'), 'settleQrCodeImg must not have empty src');
    assert.ok(html.includes('id="settleQrCodeImg" src="https://api.qrserver.com/'), 'settleQrCodeImg must have default QR API URL');
    assert.ok(html.includes('id="settleVpaDisplay" class="font-mono font-black text-brand-300 text-xs break-all">campuspool.mitadt@okaxis</div>'), 'settleVpaDisplay must be pre-populated with campuspool.mitadt@okaxis');
    assert.ok(html.includes('handleQrError(this)'), 'settleQrCodeImg must bind to handleQrError for offline fallback');
    assert.ok(html.includes('function handleQrError'), 'Inline SVG QR fallback must be implemented');
  });

  // Test 3: BUG-CP-03 - No FOUC on Cold Load for settlement banner
  await test('TC-03: Settlement warning banner has hidden and style="display: none;" on cold load', () => {
    assert.ok(html.includes('id="settlementWarningBanner" hidden style="display: none;"'), 'settlementWarningBanner must have hidden attribute and display: none in static HTML');
  });

  // Test 4: BUG-CP-04 - Native hidden attribute coverage across all secondary modals
  await test('TC-04 [BUG-CP-04]: All non-payment secondary modals carry native [hidden] attribute on cold load', () => {
    assert.ok(html.includes('id="welcomePopModal" hidden style="display: none;"'), 'welcomePopModal must have native hidden attribute');
    assert.ok(html.includes('id="authModal" hidden style="display: none;"'), 'authModal must have native hidden attribute');
    assert.ok(html.includes('id="bookingModal" hidden style="display: none;"'), 'bookingModal must have native hidden attribute');
    assert.ok(html.includes('id="sosModal" hidden style="display: none;"'), 'sosModal must have native hidden attribute');
    assert.ok(html.includes('id="notificationsModal" hidden style="display: none;"'), 'notificationsModal must have native hidden attribute');
    assert.ok(html.includes('id="toastNotification" hidden style="display: none;"'), 'toastNotification must have native hidden attribute');
  });

  // Test 5: UX-01 & UX-06 - Clarified Campus Community & 100% Campus Verified Heading
  await test('TC-05 [UX-01 & UX-06]: Hero heading reads "100% Campus Verified" matching Students & Faculty copy', () => {
    assert.ok(html.includes('100% Campus Verified'), 'Hero card heading must read 100% Campus Verified (UX-06)');
    assert.ok(html.includes('@students / @mituniversity.edu.in (Students &amp; Faculty)'), 'Hero value metric must clarify Students & Faculty (UX-01)');
  });

  // Test 6: Zero Demo Profiles & Empty State "No more rides near you"
  await test('TC-06: Static HTML renders "No more rides near you" empty state with illustration', () => {
    assert.ok(html.includes('No more rides near you'), 'Static HTML must display "No more rides near you"');
    assert.ok(html.includes('Available Rides (<span id="countAvailableRides">0</span>)'), 'Available rides count must be 0');
    assert.ok(!html.includes('data-ride-id="ride_1"'), 'Static HTML must not contain demo ride_1');
    assert.ok(!html.includes('data-ride-id="ride_2"'), 'Static HTML must not contain demo ride_2');
    assert.ok(!html.includes('data-ride-id="ride_3"'), 'Static HTML must not contain demo ride_3');
    assert.ok(!html.includes('data-ride-id="ride_4"'), 'Static HTML must not contain demo ride_4');
  });

  // Test 7: UX-03 - One-Tap Copy VPA Buttons
  await test('TC-07: UX-03 One-tap Copy VPA buttons present with clipboard handler', () => {
    assert.ok(html.includes('class="copy-vpa-btn'), 'Static modal must contain copy-vpa-btn');
    assert.ok(html.includes('UX-03: One-Tap Copy VPA Button Listener'), 'Global copy VPA event listener must be implemented in JS');
    assert.ok(html.includes('navigator.clipboard.writeText'), 'Clipboard API must be invoked');
  });

  // Test 8: UX-04 - Accessible Vehicle Filter Select
  await test('TC-08: UX-04 aria-label="Filter rides by vehicle type" present on #filterVehicleSelect', () => {
    assert.ok(html.includes('id="filterVehicleSelect" aria-label="Filter rides by vehicle type"'), '#filterVehicleSelect must have aria-label for accessibility');
  });

  // Test 9: Backend Zero-Seed Verification
  await test('TC-09: Backend /api/rides returns 0 rides in clean production state', async () => {
    const apiRes = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(apiRes.status, 200);
    const data = await apiRes.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.rides), 'rides must be an array');
    assert.strictEqual(data.rides.length, 0, `Expected 0 seed rides, found ${data.rides.length}`);
  });

  // Test 10: Zero PII Leakage Check
  await test('TC-10: Privacy check - zero real student phone numbers or personal emails in seed data', () => {
    assert.ok(!html.includes('sohamsadegaonkar'), 'Personal author accounts should not leak in client HTML');
    assert.ok(!html.includes('Kunal Shinde</h3>'), 'Kunal Shinde demo profile should not exist in static ride cards');
    assert.ok(!html.includes('Pooja Kadam</h3>'), 'Pooja Kadam demo profile should not exist in static ride cards');
  });

  // Test 11: Real-Time Free GPS & Leaflet Engine Verification
  await test('TC-11: Real-time free GPS tracking engine (Leaflet + OpenStreetMap + HTML5 Geolocation)', async () => {
    // 1. Client assets
    assert.ok(html.includes('leaflet.css'), 'Leaflet CSS must be loaded');
    assert.ok(html.includes('leaflet.js'), 'Leaflet JS must be loaded');
    assert.ok(html.includes('id="campusLeafletMap"'), '#campusLeafletMap canvas must exist');
    assert.ok(html.includes('id="gpsTrackingModal" hidden style="display: none;"'), '#gpsTrackingModal must exist with native hidden state');
    assert.ok(html.includes('calculateDistanceKm'), 'Client-side Haversine distance calculator must exist');

    // 2. Real-time GPS API Endpoints
    const driverLocPayload = {
      rideId: 'test_commute_live',
      lat: 18.4905,
      lng: 74.0255,
      speed: 36,
      heading: 180,
      accuracy: 8
    };
    const postRes = await fetch(`${BASE_URL}/api/rides/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(driverLocPayload)
    });
    assert.strictEqual(postRes.status, 200, 'POST /api/rides/location must succeed');

    const getRes = await fetch(`${BASE_URL}/api/rides/location?rideId=test_commute_live`);
    assert.strictEqual(getRes.status, 200, 'GET /api/rides/location must succeed');
    const getData = await getRes.json();
    assert.strictEqual(getData.success, true);
    assert.strictEqual(getData.location.lat, 18.4905);
    assert.strictEqual(getData.location.speed, 36);

    // 3. Passenger Location Endpoint
    const passPayload = {
      bookingId: 'test_booking_live',
      lat: 18.4891,
      lng: 74.0280,
      accuracy: 5
    };
    const passPostRes = await fetch(`${BASE_URL}/api/bookings/passenger-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passPayload)
    });
    assert.strictEqual(passPostRes.status, 200, 'POST /api/bookings/passenger-location must succeed');

    const passGetRes = await fetch(`${BASE_URL}/api/bookings/passenger-location?bookingId=test_booking_live`);
    assert.strictEqual(passGetRes.status, 200, 'GET /api/bookings/passenger-location must succeed');
    const passGetData = await passGetRes.json();
    assert.strictEqual(passGetData.success, true);
    assert.strictEqual(passGetData.location.lat, 18.4891);
  });

  console.log(`\n========================================`);
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed to execute:', err);
  process.exit(1);
});
