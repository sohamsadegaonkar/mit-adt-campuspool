'use strict';
// Real browser tests. No real student data, live OTP provider, Render or Supabase.
const {test,expect}=require('@playwright/test');
const {pool,seed,clear,openAs,api,future,localInput,seedRide}=require('./mobility-fixtures.cjs');

let fixture;
test.beforeEach(async()=>{fixture=await seed();});
test.afterEach(async()=>{await clear(fixture);fixture=null;});

async function fillIntent(page){
  await page.locator('#mobilityPickupLat').fill('18.512');
  await page.locator('#mobilityPickupLon').fill('73.925');
  await page.locator('#mobilityDropoffLat').fill('18.467');
  await page.locator('#mobilityDropoffLon').fill('74.019');
  await page.locator('#mobilityEarliest').fill(localInput(future(23)));
  await page.locator('#mobilityLatest').fill(localInput(future(25)));
}
async function createIntent(page){
  await fillIntent(page);
  const [response]=await Promise.all([
    page.waitForResponse(r=>r.url().includes('/api/mobility/intents')&&
      r.request().method()==='POST', {timeout:12000}),
    page.locator('#mobilityCreate').click()
  ]);
  expect(response.status()).toBe(201);
  await expect(page.locator('#mobilityActive')).toBeVisible();
}
async function findCandidates(page){
  const [response]=await Promise.all([
    page.waitForResponse(r=>r.url().includes('/api/mobility/matches?')&&r.request().method()==='GET'),
    page.locator('#mobilitySearch').click()
  ]);
  expect(response.status()).toBe(200);
  return response.json();
}

test('guest cannot see or write private travel intents',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#mobilityIntentPanel')).toBeHidden();
  await expect(page.locator('#offerMobilityGeoSection')).toBeHidden();
  const response=await page.request.post('/api/mobility/intents',{
    data:{pickup:{lat:18.51,lon:73.92},dropoff:{lat:18.46,lon:74.01},
      earliestDeparture:future(23).toISOString(),latestDeparture:future(25).toISOString()}
  });
  expect(response.status()).toBe(401);
});

test('server-disabled mobility remains hidden for verified student',async({page,context})=>{
  await context.route('**/api/mobility/intent',route=>route.fulfill({
    status:404,contentType:'application/json',body:'{"error":"FEATURE_NOT_ENABLED"}'
  }));
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeHidden();
  await expect(page.locator('#offerMobilityGeoSection')).toBeHidden();
});

test('verified student validates request, creates and cancels own intent',async({page,context})=>{
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  // Driver opt-in is enabled by the server but stays visually hidden inside its inactive tab.
  await expect(page.locator('#offerMobilityGeoSection')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#offerMobilityOptIn')).not.toBeChecked();

  await page.locator('#mobilityPickupLat').fill('40');
  await page.locator('#mobilityPickupLon').fill('73.925');
  await page.locator('#mobilityDropoffLat').fill('18.467');
  await page.locator('#mobilityDropoffLon').fill('74.019');
  await page.locator('#mobilityEarliest').fill(localInput(future(23)));
  await page.locator('#mobilityLatest').fill(localInput(future(25)));
  // Native input min/max must block invalid coordinates before network.
  expect(await page.locator('#mobilityPickupLat').evaluate(el=>el.checkValidity())).toBe(false);
  await page.locator('#mobilityPickupLat').fill('18.512');

  await createIntent(page);
  await expect(page.locator('#mobilityPickupLat')).toHaveValue('');
  const db=await pool.query(
    "SELECT count(*)::int AS n FROM public.campus_trip_intents WHERE student_user_id=$1 AND status='active'",
    [fixture.passenger.id]
  );
  expect(db.rows[0].n).toBe(1);

  const csrfCheck=await page.evaluate(async()=>{
    const r=await fetch('/api/mobility/intents/cancel',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({intentId:'00000000-0000-4000-8000-000000000000'})
    });
    return r.status;
  });
  expect(csrfCheck).toBe(403);

  const [cancelled]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/api/mobility/intents/cancel')&&r.request().method()==='POST'),
    page.locator('#mobilityCancel').click()
  ]);
  expect(cancelled.status()).toBe(200);
  await expect(page.locator('#mobilityIntentForm')).toBeVisible();
  await expect(page.locator('#mobilityMatches article')).toHaveCount(0);
});

test('real PostGIS candidate is displayed privately and opens existing booking confirmation',async({page,context})=>{
  const rideId=await seedRide(fixture.driver);
  expect(rideId).toMatch(/^ride_[0-9a-f-]{36}$/i);
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await createIntent(page);
  const found=await findCandidates(page);
  expect(found.candidates).toHaveLength(1);
  expect(found.candidates[0].rideId).toBe(rideId);
  await expect(page.locator('#mobilityMatches article')).toHaveCount(1);
  const card=page.locator('#mobilityMatches article').first();
  await expect(card).toContainText('Unverified road route. No seat is reserved.');
  const displayed=await card.innerText();
  expect(displayed).not.toContain(fixture.driver.email);
  expect(displayed).not.toContain(fixture.driver.phone);
  expect(displayed).not.toContain('18.5103');
  const stored=await page.evaluate(()=>JSON.stringify(localStorage));
  expect(stored).not.toContain('18.512');

  await card.getByRole('button',{name:'View ride & booking options'}).click();
  await expect(page.locator('#bookingModal')).toBeVisible();
  const before=await pool.query('SELECT count(*)::int AS n FROM public.campus_bookings WHERE ride_id=$1',[rideId]);
  expect(before.rows[0].n).toBe(0);
  await page.locator('#closeBookingModalBtn').click();
  const [cancel]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/api/mobility/intents/cancel')),
    page.locator('#mobilityCancel').click()
  ]);
  expect(cancel.status()).toBe(200);
  await expect(page.locator('#mobilityMatches article')).toHaveCount(0);
});

test('driver opt-in posts geo-linked ride and rider finds it through browser UI',async({page,context})=>{
  await openAs(page,context,fixture.driver);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await page.locator('#tabOfferRide').click();
  await expect(page.locator('#offerMobilityGeoSection')).toBeVisible();
  await expect(page.locator('#offerMobilityFields')).toBeHidden();
  await page.locator('#offerMobilityOptIn').check();
  await expect(page.locator('#offerMobilityFields')).toBeVisible();
  await page.locator('#offerVehicleType').selectOption('Car');
  await page.locator('#offerVehicleModel').fill('Browser CI Car');
  await page.locator('#offerSeats').fill('2');
  await page.locator('#offerDepartureTime').fill('Tomorrow morning');
  await page.locator('#offerMobilityPickupLat').fill('18.5103');
  await page.locator('#offerMobilityPickupLon').fill('73.9232');
  await page.locator('#offerMobilityDropoffLat').fill('18.4652');
  await page.locator('#offerMobilityDropoffLon').fill('74.0181');
  await page.locator('#offerMobilityDepartureAt').fill(localInput(future()));
  const [posted]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/api/rides')&&r.request().method()==='POST'),
    page.locator('#offerRideForm button[type="submit"]').click()
  ]);
  expect(posted.status()).toBe(201);
  const body=await posted.json();
  const rideId=body.ride.id;
  expect(rideId).toMatch(/^ride_[0-9a-f-]{36}$/i);
  const geo=await pool.query('SELECT ride_id FROM public.campus_ride_geo WHERE ride_id=$1',[rideId]);
  expect(geo.rows).toHaveLength(1);
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await createIntent(page);
  const found=await findCandidates(page);
  expect(found.candidates.some(item=>item.rideId===rideId)).toBe(true);
  await expect(page.locator('#mobilityMatches article')).toHaveCount(1);
});

test('error handling and logout clear private candidate UI',async({page,context})=>{
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await createIntent(page);
  await page.route('**/api/mobility/matches?*',route=>route.fulfill({
    status:429,contentType:'application/json',body:'{"error":"RATE_LIMITED"}'
  }));
  await page.locator('#mobilitySearch').click();
  await expect(page.locator('#mobilityStatus')).toContainText('matching search limit');
  await expect(page.locator('#mobilityMatches article')).toHaveCount(0);
  await page.locator('#headerLogoutBtn').click();
  await expect(page.locator('#mobilityIntentPanel')).toBeHidden();
  await expect(page.locator('#offerMobilityGeoSection')).toBeHidden();
});

test('matching panel fits viewport without causing horizontal overflow',async({page,context})=>{
  await openAs(page,context,fixture.passenger);
  const panel=page.locator('#mobilityIntentPanel');
  await expect(panel).toBeVisible();
  const bounds=await panel.boundingBox();
  expect(bounds).not.toBeNull();
  const width=await page.evaluate(()=>document.documentElement.clientWidth);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  await expect(page.locator('#mobilityPickupLat')).toBeVisible();
  await expect(page.locator('#mobilityDropoffLat')).toBeVisible();
});

test('session logout discards a late successful private candidate response',async({page,context})=>{
  const rideId=await seedRide(fixture.driver);
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await createIntent(page);
  let releaseResponse;
  const gate=new Promise(resolve=>{releaseResponse=resolve;});
  let confirmPending;
  const pending=new Promise(resolve=>{confirmPending=resolve;});
  const candidate={
    rideId,vehicle:'Car',studentFare:40,seatsLeft:2,
    pickupDistanceMeters:100,dropoffDistanceMeters:120,
    candidateOnly:true,roadRouteVerificationRequired:true,
    departureAt:future(24).toISOString()
  };
  await page.route('**/api/mobility/matches?*',async route=>{
    confirmPending();
    await gate;
    await route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({routeVerificationRequired:true,candidates:[candidate]})});
  });
  await page.locator('#mobilitySearch').click();
  await pending;
  await page.locator('#headerLogoutBtn').click();
  await expect(page.locator('#mobilityIntentPanel')).toBeHidden();
  const delivered=page.waitForResponse(res=>res.url().includes('/api/mobility/matches?')&&res.status()===200);
  releaseResponse();
  await delivered;
  // Let the already-pending browser fetch promise settle after the logout event.
  await page.waitForTimeout(200);
  await expect(page.locator('#mobilityMatches article')).toHaveCount(0);
  await expect(page.locator('#mobilityStatus')).toHaveText('');
  await expect(page.locator('#mobilityActive')).toBeHidden();
});

test('explicit opt-in map clicks select coordinates without saving them to browser storage',async({page,context})=>{
  const assetHeaders={'access-control-allow-origin':'*','cache-control':'no-store'};
  // Use genuine pinned Leaflet assets from the isolated CI install; do not
  // contact a third-party CDN or real tile provider with synthetic QA coordinates.
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    route=>route.fulfill({path:require.resolve('leaflet/dist/leaflet.js'),
      contentType:'text/javascript',headers:assetHeaders}));
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    route=>route.fulfill({path:require.resolve('leaflet/dist/leaflet.css'),
      contentType:'text/css',headers:assetHeaders}));
  let tileRequests=0;
  page.on('request',req=>{
    if(req.url().includes('.tile.openstreetmap.org/'))tileRequests++;
  });
  await page.route(/https:\/\/[a-z]\.tile\.openstreetmap\.org\/.*/,
    route=>route.fulfill({status:204,body:''}));
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await page.waitForFunction(()=>typeof window.L?.map==='function');
  expect(tileRequests).toBe(0);
  await page.locator('#mobilityPickPickup').click();
  await expect(page.locator('#mobilityMap')).toBeVisible();
  await page.locator('#mobilityMap').click({position:{x:95,y:110}});
  const pickupLat=await page.locator('#mobilityPickupLat').inputValue();
  const pickupLon=await page.locator('#mobilityPickupLon').inputValue();
  expect(Number(pickupLat)).toBeGreaterThan(6);
  expect(Number(pickupLon)).toBeGreaterThan(68);
  await page.locator('#mobilityPickDropoff').click();
  await page.locator('#mobilityMap').click({position:{x:160,y:160}});
  expect(Number(await page.locator('#mobilityDropoffLat').inputValue())).toBeGreaterThan(6);
  expect(Number(await page.locator('#mobilityDropoffLon').inputValue())).toBeGreaterThan(68);
  await expect.poll(()=>tileRequests).toBeGreaterThan(0);
  const privacy=await page.evaluate(()=>({
    storage:JSON.stringify({localStorage:{...localStorage},sessionStorage:{...sessionStorage}}),
    query:location.search
  }));
  expect(privacy.storage).not.toContain(pickupLat);
  expect(privacy.storage).not.toContain(pickupLon);
  expect(privacy.query).not.toContain(pickupLat);
  expect(privacy.query).not.toContain(pickupLon);
  await page.locator('#headerLogoutBtn').click();
  await expect(page.locator('#mobilityIntentPanel')).toBeHidden();
  await expect(page.locator('#mobilityMap')).toBeHidden();
  await expect(page.locator('#mobilityPickupLat')).toHaveValue('');
  await expect(page.locator('#mobilityPickupLon')).toHaveValue('');
});

test('mobility create and cancel can be activated from keyboard with announced status',async({page,context})=>{
  await openAs(page,context,fixture.passenger);
  await expect(page.locator('#mobilityIntentPanel')).toBeVisible();
  await expect(page.locator('#mobilityStatus')).toHaveAttribute('role','status');
  await expect(page.locator('#mobilityStatus')).toHaveAttribute('aria-live','polite');
  await expect(page.getByRole('spinbutton',{name:'Pickup latitude',exact:true})).toBeVisible();
  await fillIntent(page);
  await page.locator('#mobilityCreate').focus();
  await expect(page.locator('#mobilityCreate')).toBeFocused();
  const created=page.waitForResponse(r=>r.url().endsWith('/api/mobility/intents')&&r.request().method()==='POST');
  await page.keyboard.press('Enter');
  expect((await created).status()).toBe(201);
  await expect(page.locator('#mobilityActive')).toBeVisible();
  await expect(page.locator('#mobilityStatus')).toContainText('Travel request saved privately');
  await page.locator('#mobilityCancel').focus();
  await expect(page.locator('#mobilityCancel')).toBeFocused();
  const cancelled=page.waitForResponse(r=>r.url().endsWith('/api/mobility/intents/cancel')&&r.request().method()==='POST');
  await page.keyboard.press('Enter');
  expect((await cancelled).status()).toBe(200);
  await expect(page.locator('#mobilityIntentForm')).toBeVisible();
});
