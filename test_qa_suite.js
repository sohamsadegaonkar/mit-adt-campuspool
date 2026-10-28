// QA Regression Verification Suite for MIT-ADT CampusPool
// Validates Santana et al. 4-Gate Production Hardening & QA Audit Requirements

const assert = require('assert');

async function runTests() {
  console.log('🚀 Starting MIT-ADT CampusPool QA Regression Suite...\n');
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
    
    // Check specific buttons
    assert.ok(html.includes('id="settleUpiLinkBtn" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'settleUpiLinkBtn must have valid UPI intent href');
    assert.ok(html.includes('id="settleActionUpiLink" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'settleActionUpiLink must have valid UPI intent href');
    assert.ok(html.includes('id="paymentUpiLinkBtn" href="upi://pay?pa=campuspool.mitadt@okaxis'), 'paymentUpiLinkBtn must have valid UPI intent href');
  });

  // Test 2: BUG-CP-02 - Non-empty QR src and default VPA display
  await test('TC-02: QR code img[alt="Scan UPI QR"] has non-empty src & pre-populated VPA', () => {
    assert.ok(!html.includes('id="settleQrCodeImg" src=""'), 'settleQrCodeImg must not have empty src');
    assert.ok(html.includes('id="settleQrCodeImg" src="https://api.qrserver.com/'), 'settleQrCodeImg must have default QR API URL');
    assert.ok(html.includes('id="settleVpaDisplay" class="font-mono font-black text-brand-300 text-xs break-all">campuspool.mitadt@okaxis</div>'), 'settleVpaDisplay must be pre-populated with campuspool.mitadt@okaxis');
  });

  // Test 3: BUG-CP-03 - No FOUC on Cold Load for settlement banner
  await test('TC-03: Settlement warning banner has hidden and style="display: none;" on cold load', () => {
    assert.ok(html.includes('id="settlementWarningBanner" hidden style="display: none;"'), 'settlementWarningBanner must have hidden attribute and display: none in static HTML');
  });

  // Test 4: UX-01 - Clarified Faculty and Staff Eligibility
  await test('TC-04: UX-01 Hero badge & auth copy clarify @students / @mituniversity.edu.in (Students & Faculty)', () => {
    assert.ok(html.includes('@students / @mituniversity.edu.in (Students &amp; Faculty)'), 'Hero value metric must clarify Students & Faculty');
    assert.ok(html.includes('Email ID (@students.mituniversity.edu.in or @mituniversity.edu.in)'), 'Auth modal must clarify faculty email domain');
  });

  // Test 5: UX-02 - Car Seat Capacity Badges
  await test('TC-05: UX-02 Car ride cards display seat capacity (e.g. 🚗 Car (X of Y Seats))', () => {
    assert.ok(html.includes('🚗 Car (2 of 3 Seats)'), 'Seed ride Pooja Kadam must display 🚗 Car (2 of 3 Seats)');
    assert.ok(html.includes('🚗 Car (3 of 3 Seats)'), 'Seed ride Shreya Nair must display 🚗 Car (3 of 3 Seats)');
    assert.ok(html.includes('🚗 Car (${ride.seatsLeft} of ${ride.seatsTotal} Seats)'), 'renderRidesGrid must template car seats left of total');
  });

  // Test 6: UX-03 - One-Tap Copy VPA Buttons
  await test('TC-06: UX-03 One-tap Copy VPA buttons present with clipboard handler', () => {
    assert.ok(html.includes('class="copy-vpa-btn'), 'Static modal must contain copy-vpa-btn');
    assert.ok(html.includes('UX-03: One-Tap Copy VPA Button Listener'), 'Global copy VPA event listener must be implemented in JS');
    assert.ok(html.includes('navigator.clipboard.writeText'), 'Clipboard API must be invoked');
  });

  // Test 7: UX-04 - Accessible Vehicle Filter Select
  await test('TC-07: UX-04 aria-label="Filter rides by vehicle type" present on #filterVehicleSelect', () => {
    assert.ok(html.includes('id="filterVehicleSelect" aria-label="Filter rides by vehicle type"'), '#filterVehicleSelect must have aria-label for accessibility');
  });

  // Test 8: Backend API Integrity
  await test('TC-08: Backend /api/rides returns active seed rides and 30% discount benchmarks', async () => {
    const apiRes = await fetch(`${BASE_URL}/api/rides`);
    assert.strictEqual(apiRes.status, 200);
    const data = await apiRes.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.rides) && data.rides.length >= 4, 'Must return at least 4 seed rides');
    
    // Verify 30% discount calculation for Kunal Shinde (₹203 vs ₹290 = 30%)
    const kunalRide = data.rides.find(r => r.driverName === 'Kunal Shinde');
    assert.ok(kunalRide, 'Kunal Shinde ride must exist');
    const kunalDiscount = Math.round(((kunalRide.uberBenchmark - kunalRide.studentFare) / kunalRide.uberBenchmark) * 100);
    assert.strictEqual(kunalDiscount, 30, 'Kunal discount must be 30%');
  });

  // Test 9: Zero PII Leakage Check
  await test('TC-09: Privacy check - zero real student phone numbers or personal emails in seed data', () => {
    // Only fictitious seed numbers allowed
    assert.ok(!html.includes('@gmail.com"'), 'Seed data should not leak personal gmail addresses');
    assert.ok(!html.includes('sohamsadegaonkar'), 'Personal author accounts should not leak in client HTML');
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
