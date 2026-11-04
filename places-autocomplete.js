'use strict';

// Places API (New) adapter. Server-only, opt-in and non-persistent.
// No request text, provider key, Place Details payload or user IP is logged.
const HOST = 'https://places.googleapis.com';
const AUTOCOMPLETE_PATH = '/v1/places:autocomplete';
const PLACE_PREFIX = '/v1/places/';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,36}$/;
const PLACE_RE = /^[A-Za-z0-9_-]{8,180}$/;
const PUNE_BIAS = Object.freeze({latitude: 18.5204, longitude: 73.8567});

class PlacesError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validToken(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new PlacesError('INVALID_SESSION_TOKEN');
  }
  return token;
}

function validInput(input) {
  if (typeof input !== 'string') throw new PlacesError('INVALID_QUERY');
  const value = input.trim().replace(/\s+/gu, ' ');
  if (value.length < 3 || value.length > 80 ||
      /[<>\u0000-\u001f\u007f]/u.test(input)) {
    throw new PlacesError('INVALID_QUERY');
  }
  return value;
}

function validPlaceId(placeId) {
  if (typeof placeId !== 'string' || !PLACE_RE.test(placeId)) {
    throw new PlacesError('INVALID_PLACE_ID');
  }
  return placeId;
}

function safeText(text, max = 180) {
  if (typeof text !== 'string') return '';
  return text.replace(/[<>\u0000-\u001f\u007f]/gu, '')
    .trim().slice(0, max);
}

// This local-instance cap supplements (NOT replaces) provider billing quotas.
// Accept a deliberately tiny value (e.g. 1) for owner-approved smoke QA.
// A malformed configuration must fail startup rather than silently increase cost.
function parseDailyCap(value = '250') {
  if (typeof value !== 'string' ||
      !/^[1-9][0-9]{0,3}$/.test(value) ||
      Number(value) > 1000) {
    throw new Error('PLACES_DAILY_CAP must be an integer from 1 to 1000');
  }
  return Number(value);
}

function createPlacesClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 4500,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 16) {
    throw new Error('PLACES_API_KEY must be configured securely');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch required');

  async function request(path, options, mask) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(HOST + path, {
        ...options,
        signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': mask,
        },
      });
    } catch {
      throw new PlacesError('LOCATION_PROVIDER_UNAVAILABLE', 503);
    }
    if (response.status === 429) {
      throw new PlacesError('LOCATION_PROVIDER_LIMIT', 503);
    }
    if (!response.ok) {
      throw new PlacesError('LOCATION_PROVIDER_UNAVAILABLE', 503);
    }
    let result;
    try {
      const raw = await response.text();
      if (raw.length > 128 * 1024) throw new Error('oversized');
      result = JSON.parse(raw);
      if (result === null || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('invalid response');
      }
    } catch {
      throw new PlacesError('LOCATION_PROVIDER_UNAVAILABLE', 503);
    }
    return result;
  }

  async function suggest({input, sessionToken}) {
    const value = validInput(input);
    const token = validToken(sessionToken);
    const response = await request(AUTOCOMPLETE_PATH, {
      method: 'POST',
      body: JSON.stringify({
        input: value,
        includedRegionCodes: ['in'],
        languageCode: 'en',
        regionCode: 'in',
        sessionToken: token,
        locationBias: {
          circle: {center: PUNE_BIAS, radius: 35000},
        },
      }),
    }, 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat');

    const items = Array.isArray(response.suggestions) ? response.suggestions : [];
    return items.slice(0, 5).map(({placePrediction}) => {
      const structured = placePrediction?.structuredFormat;
      return {
        id: safeText(placePrediction?.placeId, 180),
        title: safeText(structured?.mainText?.text, 110),
        subtitle: safeText(structured?.secondaryText?.text, 180),
      };
    }).filter(item => PLACE_RE.test(item.id) && item.title);
  }

  async function resolve({placeId, sessionToken}) {
    const id = validPlaceId(placeId);
    const token = validToken(sessionToken);
    const response = await request(PLACE_PREFIX + encodeURIComponent(id) +
      '?sessionToken=' + encodeURIComponent(token), {method: 'GET'},
    'id,formattedAddress,location');
    const latitude = response.location?.latitude;
    const longitude = response.location?.longitude;
    const address = safeText(response.formattedAddress, 260);
    if (response.id !== id || !address ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new PlacesError('LOCATION_PROVIDER_UNAVAILABLE', 503);
    }
    return {id, address, latitude, longitude};
  }

  return Object.freeze({suggest, resolve});
}

module.exports = {createPlacesClient, PlacesError, validInput, validToken, validPlaceId, parseDailyCap};
