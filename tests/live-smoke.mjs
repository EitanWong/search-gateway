import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  SEARCH_GATEWAY_TOKEN: process.env.SEARCH_GATEWAY_TOKEN || 'dev-token',
  BING_MARKET: process.env.BING_MARKET || 'en-US',
};

async function call(path, body) {
  const req = new Request(`https://gateway.test${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SEARCH_GATEWAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return worker.fetch(req, env);
}

{
  const res = await call('/search', { query: 'Hermes Agent Nous Research', provider: 'bing', limit: 3 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.provider, 'bing');
  assert.ok(data.count > 0, JSON.stringify(data));
  assert.ok(data.results[0].url.startsWith('http'));
  console.log('search:', data.results.slice(0, 2).map((r) => `${r.title} | ${r.url}`).join('\n'));
}

{
  const res = await call('/fetch', { url: 'https://example.com', max_chars: 1200 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.text, /Example Domain/i);
}

console.log('live smoke ok');
