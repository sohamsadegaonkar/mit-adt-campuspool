'use strict';
// Exactly-once database effects for keyed, authenticated domain mutations.
// Keys are user+route scoped; do not wrap OTP responses, credentials, payments
// or external API calls in this store. No in-memory locks or Redis required.
const crypto = require('node:crypto');
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
class IdempotencyError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function validKey(key) {
  if (key === undefined) throw new IdempotencyError('IDEMPOTENCY_KEY_REQUIRED', 428);
  if (typeof key !== 'string' || !KEY_PATTERN.test(key))
    throw new IdempotencyError('INVALID_IDEMPOTENCY_KEY', 400);
  return key;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
function digest(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}
function identity({ actor, route, key, body }) {
  validKey(key);
  if (typeof actor !== 'string' || !actor || typeof route !== 'string' || !route.startsWith('POST /api/'))
    throw new IdempotencyError('IDEMPOTENCY_SCOPE_INVALID', 500);
  // Store pseudonymous actor hash and body digest; never store raw keys in logs.
  return {
    actorHash: digest('campus-user:' + actor.trim().toLowerCase()),
    route, key,
    requestHash: digest(JSON.stringify(canonical(body)))
  };
}
function ensureResponse(result) {
  if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 299 ||
    !result.body || typeof result.body !== 'object' || Array.isArray(result.body))
    throw new IdempotencyError('IDEMPOTENCY_RESULT_INVALID', 500);
  return result;
}
function replay(row, requestHash) {
  if (row.request_hash !== requestHash)
    throw new IdempotencyError('IDEMPOTENCY_KEY_REUSED', 409);
  if (!Number.isInteger(Number(row.response_status)) || !row.response_json)
    throw new IdempotencyError('IDEMPOTENCY_RECORD_INCOMPLETE', 503);
  return { status: Number(row.response_status), body: JSON.parse(row.response_json), replayed: true };
}
class PgIdempotencyStore {
  constructor(pool) { if (!pool || typeof pool.connect !== 'function') throw Error('PG pool required'); this.pool = pool; }
  async ready() {
    await this.pool.query('SELECT 1 FROM public.campus_idempotency_keys LIMIT 0');
  }
  async run({ actor, route, key, body, execute }) {
    const id = identity({ actor, route, key, body });
    if (typeof execute !== 'function') throw Error('Execute callback required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const args = [id.actorHash, id.route, id.key, id.requestHash];
      // Expired keys can be reused. Delete only the same key, not other actors' records.
      await client.query([
        'DELETE FROM public.campus_idempotency_keys',
        'WHERE actor_hash=$1 AND route=$2 AND request_key=$3 AND expires_at<=now()'
      ].join(' '), args.slice(0, 3));
      // A concurrent insert for the same key blocks here until its transaction
      // commits/rolls back. The business effect and response commit together.
      const inserted = await client.query([
        'INSERT INTO public.campus_idempotency_keys',
        '(actor_hash,route,request_key,request_hash,expires_at)',
        "VALUES($1,$2,$3,$4,now()+interval '24 hours')",
        'ON CONFLICT (actor_hash,route,request_key) DO NOTHING',
        'RETURNING actor_hash'
      ].join(' '), args);
      if (!inserted.rowCount) {
        const r = await client.query([
          'SELECT request_hash,response_status,response_json FROM public.campus_idempotency_keys',
          'WHERE actor_hash=$1 AND route=$2 AND request_key=$3'
        ].join(' '), args.slice(0, 3));
        if (!r.rows.length) throw new IdempotencyError('IDEMPOTENCY_RETRY', 503);
        const previous = replay(r.rows[0], id.requestHash);
        await client.query('COMMIT');
        return previous;
      }
      const result = ensureResponse(await execute(client));
      await client.query([
        'UPDATE public.campus_idempotency_keys',
        'SET response_status=$4,response_json=$5',
        'WHERE actor_hash=$1 AND route=$2 AND request_key=$3'
      ].join(' '), [id.actorHash, id.route, id.key, result.status, JSON.stringify(result.body)]);
      await client.query('COMMIT');
      return { ...result, replayed: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }
}
class SqliteIdempotencyStore {
  constructor(db) {
    if (!db || typeof db.transaction !== 'function') throw Error('SQLite connection required');
    this.db = db;
  }
  run({ actor, route, key, body, execute }) {
    const id = identity({ actor, route, key, body });
    if (typeof execute !== 'function') throw Error('Execute callback required');
    const tx = this.db.transaction(() => {
      const now = Date.now();
      this.db.prepare([
        'DELETE FROM idempotency_keys WHERE actor_hash=? AND route=? AND request_key=?',
        'AND expires_at<=?'
      ].join(' ')).run(id.actorHash, id.route, id.key, now);
      const ins = this.db.prepare([
        'INSERT OR IGNORE INTO idempotency_keys',
        '(actor_hash,route,request_key,request_hash,expires_at)',
        'VALUES(?,?,?,?,?)'
      ].join(' ')).run(id.actorHash, id.route, id.key, id.requestHash, now + TTL_MS);
      if (!ins.changes) {
        const row = this.db.prepare([
          'SELECT request_hash,response_status,response_json FROM idempotency_keys',
          'WHERE actor_hash=? AND route=? AND request_key=?'
        ].join(' ')).get(id.actorHash, id.route, id.key);
        if (!row) throw new IdempotencyError('IDEMPOTENCY_RETRY', 503);
        return replay(row, id.requestHash);
      }
      const result = ensureResponse(execute());
      this.db.prepare([
        'UPDATE idempotency_keys SET response_status=?,response_json=?',
        'WHERE actor_hash=? AND route=? AND request_key=?'
      ].join(' ')).run(result.status, JSON.stringify(result.body), id.actorHash, id.route, id.key);
      return { ...result, replayed: false };
    });
    // better-sqlite3 nested transactions use SAVEPOINTs; no effects commit
    // independently of the idempotency result.
    return tx.immediate();
  }
}
module.exports = { PgIdempotencyStore, SqliteIdempotencyStore, IdempotencyError, validKey, canonical, TTL_MS };
