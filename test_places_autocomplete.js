'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createPlacesClient, PlacesError, validInput, validToken, parseDailyCap} =
  require('./places-autocomplete');

const SESSION = 'a'.repeat(24);
const PLACE_ID = 'ChIJ123456789ABCDEFGHIJK';

function mockFetch(responseBody, inspection) {
  return async (url, request) => {
    inspection?.(url, request);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responseBody),
    };
  };
}

test('Pune-biased Places (New) suggestions include India and correct session token', async () => {
  const client = createPlacesClient({
    apiKey: 'placeholder-test-key-not-real',
    fetchImpl: mockFetch({
      suggestions: [
        {placePrediction: {
          placeId: PLACE_ID,
          structuredFormat: {
            mainText: {text: 'Swargate'},
            secondaryText: {text: 'Pune, Maharashtra, India'},
          },
          phone: 'must-not-be-exposed',
        }},
      ],
    }, (url, opts) => {
      assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.redirect, 'error');
      const body = JSON.parse(opts.body);
      assert.equal(body.input, 'swargate');
      assert.equal(body.sessionToken, SESSION);
      assert.deepEqual(body.includedRegionCodes, ['in']);
      assert.deepEqual(body.locationBias.circle.center,
        {latitude: 18.5204, longitude: 73.8567});
      assert.ok(!opts.headers['X-Goog-FieldMask'].includes('phone'));
    }),
  });
  const found = await client.suggest({input: '  swargate  ', sessionToken: SESSION});
  assert.deepEqual(found, [
    {id: PLACE_ID, title: 'Swargate', subtitle: 'Pune, Maharashtra, India'},
  ]);
  assert.equal(JSON.stringify(found).includes('phone'), false);
});

test('selection resolves coordinates using the same billing token', async () => {
  const client = createPlacesClient({
    apiKey: 'placeholder-test-key-not-real',
    fetchImpl: mockFetch({
      id: PLACE_ID,
      formattedAddress: 'Swargate, Pune, Maharashtra, India',
      location: {latitude: 18.501, longitude: 73.860},
    }, (url, opts) => {
      assert.equal(url, 'https://places.googleapis.com/v1/places/' +
        PLACE_ID + '?sessionToken=' + SESSION);
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers['X-Goog-FieldMask'],
        'id,formattedAddress,location');
    }),
  });
  const result = await client.resolve({placeId: PLACE_ID, sessionToken: SESSION});
  assert.equal(result.address, 'Swargate, Pune, Maharashtra, India');
  assert.equal(result.latitude, 18.501);
});

test('invalid queries and billing tokens rejected before Google requests', async () => {
  let count = 0;
  const client = createPlacesClient({
    apiKey: 'placeholder-test-key-not-real',
    fetchImpl: async () => { count++; throw Error('unexpected'); },
  });
  for (const query of ['ab', '<script>', 'a'.repeat(81), '   ']) {
    await assert.rejects(client.suggest({input: query, sessionToken: SESSION}),
      e => e instanceof PlacesError && e.code === 'INVALID_QUERY');
  }
  await assert.rejects(client.suggest({input:'Swargate', sessionToken:'short'}),
    e => e instanceof PlacesError && e.code === 'INVALID_SESSION_TOKEN');
  assert.equal(count, 0);
  assert.throws(() => validToken('bad'));
  assert.throws(() => validInput('ab'));
});

test('upstream errors are redacted and never expose provider secret', async () => {
  const client = createPlacesClient({
    apiKey: 'placeholder-test-key-not-real',
    fetchImpl: async () => { throw new Error('key placeholder-test-key-not-real'); },
  });
  await assert.rejects(client.suggest({input:'swargate',sessionToken:SESSION}),
    error => error.code === 'LOCATION_PROVIDER_UNAVAILABLE' &&
      !error.message.includes('placeholder'));
});

test('reject malformed Place Details instead of accepting fake locations', async () => {
  const client = createPlacesClient({
    apiKey: 'placeholder-test-key-not-real',
    fetchImpl: mockFetch({id: PLACE_ID, formattedAddress: 'Swargate'}),
  });
  await assert.rejects(client.resolve({placeId:PLACE_ID,sessionToken:SESSION}),
    e => e.code === 'LOCATION_PROVIDER_UNAVAILABLE');
});

test('billing cap accepts one request for cautious controlled QA', () => {
  assert.equal(parseDailyCap('1'), 1);
  assert.equal(parseDailyCap('5'), 5);
  assert.equal(parseDailyCap(), 250);
  assert.equal(parseDailyCap('1000'), 1000);
  for (const invalid of ['0', '-1', '1001', '10000', 'NaN', '3.5',
    '100abc', 'Infinity', '', ' 5', '005']) {
    assert.throws(() => parseDailyCap(invalid),
      /PLACES_DAILY_CAP must be an integer/);
  }
});
