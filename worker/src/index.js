/*
 * Plate-lookup proxy for the Fuel tab.
 *
 * Keeps the plateapi.com.au API key out of the client: the PWA calls this
 * worker, the worker adds the key (stored as a Cloudflare secret named
 * PLATE_API_KEY) and forwards the request. Deploy with:
 *
 *   npx wrangler deploy
 *   npx wrangler secret put PLATE_API_KEY
 */

var STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-RateLimit-Remaining'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return json({ success: false, error: 'Method not allowed' }, 405);
    }

    var url = new URL(request.url);
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
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}
