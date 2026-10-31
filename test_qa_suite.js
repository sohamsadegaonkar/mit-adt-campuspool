// QA Comprehensive Verification Suite for MIT-ADT CampusPool v1.3
// Validates:
// - BUG-01 (P0): Modal lock & focus trap (#notificationsModal, #sosModal, #authModal)
// - BUG-02 (P1): Institutional domain validation on client and server
// - BUG-03 (P2): Production sanitized copy in OTP dispatch (no debug / terminal leakage)
// - BUG-04 (P3): External link isolation (target="_blank" rel="noopener noreferrer")
// - CP-001 to CP-005: Fare step constraint, accessible close controls, modal semantics, iframe title, persistence key
// - Santana et al. 4-Gate Production Hardening, Zero-Seed State & GPS Tracking

const assert = require('assert');

async function runTests() {
  console.log('🚀 Starting MIT-ADT CampusPool v1.3 QA Full Verification Suite...\n');
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
  await test('TC-04 [BUG-CP-04]: All secondary modals carry native [hidden] attribute on cold load', () => {
    assert.ok(html.includes('id="welcomePopModal" hidden style="display: none;"'), 'welcomePopModal must have native hidden attribute');
    assert.ok(html.includes('id="authModal" hidden style="display: none;"'), 'authModal must have native hidden attribute');
    assert.ok(html.includes('id="bookingModal" hidden style="display: none;"'), 'bookingModal must have native hidden attribute');
    assert.ok(html.includes('id="paymentModal" hidden style="display: none;"'), 'paymentModal must have native hidden attribute');
    assert.ok(html.includes('id="driverSettlementModal" hidden style="display: none;"'), 'driverSettlementModal must have native hidden attribute');
    assert.ok(html.includes('id="settlementLockModal" hidden style="display: none;"'), 'settlementLockModal must have native hidden attribute');
    assert.ok(html.includes('id="sosModal" hidden style="display: none;"'), 'sosModal must have native hidden attribute');
    assert.ok(html.includes('id="notificationsModal" hidden style="display: none;"'), 'notificationsModal must have native hidden attribute');
    assert.ok(html.includes('id="gpsTrackingModal" hidden style="display: none;"'), 'gpsTrackingModal must have native hidden attribute');
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
    assert.ok(html.includes('leaflet.css'), 'Leaflet CSS must be loaded');
    assert.ok(html.includes('leaflet.js'), 'Leaflet JS must be loaded');
    assert.ok(html.includes('id="campusLeafletMap"'), '#campusLeafletMap canvas must exist');
    assert.ok(html.includes('id="gpsTrackingModal" hidden style="display: none;"'), '#gpsTrackingModal must exist with native hidden state');
    assert.ok(html.includes('calculateDistanceKm'), 'Client-side Haversine distance calculator must exist');

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
  });

  // Test 12: Production Security Headers
  await test('TC-12 [SEC-01]: Security headers enforced (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)', async () => {
    const headRes = await fetch(`${BASE_URL}/`);
    assert.strictEqual(headRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(headRes.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(headRes.headers.get('strict-transport-security')?.includes('max-age='), 'Strict-Transport-Security must be configured');
    assert.ok(headRes.headers.get('content-security-policy')?.includes("default-src"), 'Content-Security-Policy must be configured');
  });

  // Test 13: BUG-02 Backend Domain Enforcement
  await test('TC-13 [BUG-02 Server]: /api/auth/send-email-otp strictly blocks non-institutional domains', async () => {
    // 1. External email must be rejected with HTTP 400
    const failRes = await fetch(`${BASE_URL}/api/auth/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'External Hacker',
        email: 'attacker@gmail.com',
        phone: '9876543210'
      })
    });
    assert.strictEqual(failRes.status, 400, 'Non-institutional email must yield HTTP 400');
    const failData = await failRes.json();
    assert.strictEqual(failData.success, false);
    assert.strictEqual(failData.error, 'INVALID_DOMAIN');
    assert.ok(failData.message.includes('Only @students.mituniversity.edu.in or @mituniversity.edu.in institutional email addresses are permitted'));

    // 2. Legitimate institutional student email must succeed
    const uniqueEmail = `test_${Date.now()}@students.mituniversity.edu.in`;
    const okRes = await fetch(`${BASE_URL}/api/auth/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Aarav Deshmukh',
        email: uniqueEmail,
        phone: '9876543210'
      })
    });
    assert.strictEqual(okRes.status, 200, 'Valid institutional email must return HTTP 200');
    const okData = await okRes.json();
    assert.strictEqual(okData.success, true);
    assert.strictEqual(typeof okData.expiresInSeconds, 'number');
  });

  // Test 14: BUG-03 Production Copy Sanitization in OTP Dispatch
  await test('TC-14 [BUG-03 Server]: OTP dispatch response contains zero debug / local terminal leakage', async () => {
    const facultyEmail = `faculty_${Date.now()}@mituniversity.edu.in`;
    const okRes = await fetch(`${BASE_URL}/api/auth/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Faculty Test',
        email: facultyEmail,
        phone: '9876543211'
      })
    });
    const okData = await okRes.json();
    assert.strictEqual(okData.message, 'A 6-digit verification code has been sent to your university inbox.');
    assert.ok(!JSON.stringify(okData).includes('terminal'), 'Response must not leak terminal copy');
    assert.ok(!JSON.stringify(okData).includes('locally'), 'Response must not leak local testing copy');
  });

  // Test 15: BUG-02 Client Domain Regex & Error String
  await test('TC-15 [BUG-02 Client]: Client isOfficialUniversityEmail enforces strict institutional regex', () => {
    assert.ok(html.includes('/^[a-zA-Z0-9._%+-]+@(students\\.)?mituniversity\\.edu\\.in$/i'), 'Client must use strict institutional regex');
    assert.ok(html.includes('Only @students.mituniversity.edu.in or @mituniversity.edu.in permitted. Invalid institutional domain.'), 'Client error must display exact institutional domain message');
  });

  // Test 16: BUG-01 & CP-002 Accessible Modal Controller, Escape key & Backdrop dismissal
  await test('TC-16 [BUG-01, CP-002, CP-003]: Enterprise accessible modal controller with Escape, backdrop, & focus trap', () => {
    assert.ok(html.includes('ENTERPRISE ACCESSIBLE MODAL CONTROLLER'), 'Modal controller must be present');
    assert.ok(html.includes("if (e.key === 'Escape')"), 'Escape key dismissal must be implemented');
    assert.ok(html.includes("e.target.closest('.modal-overlay')"), 'Backdrop click dismissal must be implemented');
    assert.ok(html.includes("if (e.key === 'Tab')"), 'W3C Tab focus containment must be implemented');
    assert.ok(html.includes("closeModalById('notificationsModal')"), 'Notification modal close listener must be wired');
    assert.ok(html.includes("closeModalById('sosModal')"), 'SOS modal close listener must be wired');
  });

  // Test 17: CP-001 Fare Step Constraint
  await test('TC-17 [CP-001]: #offerStudentFare has step="1" to satisfy native HTML constraint validation', () => {
    assert.ok(html.includes('id="offerStudentFare" value="104" min="20" step="1"'), '#offerStudentFare must have min="20" and step="1"');
  });

  // Test 18: CP-004 Campus Map iframe title
  await test('TC-18 [CP-004]: #campusGoogleMapsIframe has accessible non-empty title attribute', () => {
    assert.ok(html.includes('id="campusGoogleMapsIframe" title="MIT ADT campus gates and Pune commute map"'), 'campusGoogleMapsIframe must have descriptive title');
  });

  // Test 19: CP-005 Storage Key Agreement & Filter Synchronization
  await test('TC-19 [CP-005]: Storage key is mit_adt_campuspool_live_db_v4 with filter synchronization on load', () => {
    assert.ok(html.includes("const STORAGE_KEY = 'mit_adt_campuspool_live_db_v4';"), 'STORAGE_KEY must be mit_adt_campuspool_live_db_v4');
    assert.ok(html.includes("vSel.value = appState.activeVehicleFilter;"), 'Filter select value must synchronize from activeVehicleFilter');
  });

  // Test 20: BUG-04 External Link Security
  await test('TC-20 [BUG-04]: External links enforce target="_blank" and rel="noopener noreferrer"', () => {
    assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'), 'External links must enforce rel="noopener noreferrer"');
    assert.ok(!html.includes('target="_blank">'), 'No unprotected target="_blank" without rel="noopener noreferrer" should remain');
  });

  // Test 21: UX-02 & BUG-07 Bike Seat Clamping
  await test('TC-21 [UX-02 & BUG-07]: Bike vehicle type enforces initial and changed max="1"', () => {
    assert.ok(html.includes('id="offerSeats" value="1" min="1" max="1"'), 'Initial seats input for bike must have max="1"');
    assert.ok(html.includes("seatsInput.max = '1'"), 'Bike change handler must clamp max to 1');
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
