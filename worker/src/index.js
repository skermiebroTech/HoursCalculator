/*
 * Worker for the Weekly Hours PWA: plate lookups + cross-device sync.
 *
 * /            — plate lookup proxy. Keeps the plateapi.com.au API key out of
 *                the client (stored as a Cloudflare secret named PLATE_API_KEY).
 * /sync/:code  — GET/PUT the user's backup JSON in Workers KV. The code is a
 *                long random secret generated on-device; anyone holding it can
 *                read and write that copy, so it is both ID and password.
 *
 * Deploy with:
 *   npx wrangler deploy
 *   npx wrangler secret put PLATE_API_KEY
 */

var STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

var MAX_SYNC_BYTES = 256 * 1024;

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-RateLimit-Remaining'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    var url = new URL(request.url);
    if (url.pathname.indexOf('/sync/') === 0) {
      return handleSync(request, env, url);
    }
    return handleLookup(request, env, url);
  }
};

async function handleLookup(request, env, url) {
  if (request.method !== 'GET') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }
  var plate = (url.searchParams.get('plate') || '').trim().toUpperCase();
  var state = (url.searchParams.get('state') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(plate) || STATES.indexOf(state) === -1) {
    return json({ success: false, error: 'Invalid plate or state' }, 400);
  }

  var upstream = await fetch(
    'https://api.plateapi.com.au/api/v1/lookup?plate=' + encodeURIComponent(plate) +
      '&state=' + encodeURIComponent(state),
    { headers: { 'X-API-Key': env.PLATE_API_KEY } }
  );

  var headers = Object.assign({ 'Content-Type': 'application/json' }, CORS);
  var remaining = upstream.headers.get('x-ratelimit-remaining');
  if (remaining !== null) headers['X-RateLimit-Remaining'] = remaining;
  return new Response(await upstream.text(), { status: upstream.status, headers: headers });
}

async function handleSync(request, env, url) {
  var code = url.pathname.slice('/sync/'.length);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) {
    return json({ success: false, error: 'Invalid sync code' }, 400);
  }
  var key = 'sync:' + code;

  if (request.method === 'GET') {
    var stored = await env.SYNC_KV.get(key);
    if (stored === null) {
      return json({ success: false, error: 'Nothing synced under this code yet' }, 404);
    }
    return new Response(stored, {
      headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
    });
  }

  if (request.method === 'PUT') {
    var body = await request.text();
    if (body.length > MAX_SYNC_BYTES) {
      return json({ success: false, error: 'Backup too large to sync' }, 413);
    }
    try { JSON.parse(body); }
    catch (e) { return json({ success: false, error: 'Not valid JSON' }, 400); }
    await env.SYNC_KV.put(key, body);
    return json({ success: true }, 200);
  }

  return json({ success: false, error: 'Method not allowed' }, 405);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}
