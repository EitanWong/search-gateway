import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(__dirname, 'search-quality-cases.json'), 'utf8'));
const env = {
  SEARCH_GATEWAY_TOKEN: 'dev-token',
  BRAVE_SEARCH_API_KEY: 'brave-key',
  SERPER_API_KEY: 'serper-key',
  TAVILY_API_KEY: 'tavily-key',
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '(invalid-url)';
  }
}

function domainOf(result) {
  return hostOf(result.canonical_url || result.url);
}

function brief(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function resultLine(result, index) {
  return `${index + 1}. ${domainOf(result)} | ${brief(result.title)} | ${result.canonical_url || result.url}`;
}

function inputLine(result, index) {
  return `${index + 1}. ${hostOf(result.url)} | ${brief(result.title)} | ${result.url || '(missing-url)'}`;
}

function expectations(testCase) {
  return JSON.stringify({
    top_domain_one_of: testCase.top_domain_one_of,
    must_include_domains_top3: testCase.must_include_domains_top3,
    avoid_domains_top3: testCase.avoid_domains_top3,
    max_same_domain_top3: testCase.max_same_domain_top3,
  }, null, 2);
}

function diagnostic(testCase, results, reason) {
  return [
    `${testCase.name}: ${reason}`,
    `Query: ${testCase.query}`,
    `Freshness: ${testCase.freshness || 'none'} | Language: ${testCase.language || 'auto'} | Limit: ${testCase.limit || 5}`,
    `Expected: ${expectations(testCase)}`,
    'Top results:',
    ...(results.length ? results.slice(0, 5).map(resultLine) : ['(none)']),
    'Mock input order:',
    ...((testCase.responses || []).length ? testCase.responses.slice(0, 8).map(inputLine) : ['(none)']),
  ].join('\n');
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

function htmlResponse(html = '') {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input.url || input);
  if (url.startsWith('https://api.search.brave.com/')) {
    const query = new URL(url).searchParams.get('q');
    const testCase = cases.find((item) => item.query === query);
    return jsonResponse({ web: { results: testCase?.responses || [] } });
  }
  if (url === 'https://google.serper.dev/search') return jsonResponse({ organic: [] });
  if (url === 'https://api.tavily.com/search') return jsonResponse({ results: [] });
  if (url.startsWith('https://html.duckduckgo.com/html/')) return htmlResponse('');
  if (url.startsWith('https://www.bing.com/search')) return htmlResponse('');
  throw new Error(`unexpected fetch: ${url}`);
};

async function search(testCase) {
  const response = await worker.fetch(new Request('https://gateway.test/search', {
    method: 'POST',
    headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      query: testCase.query,
      limit: testCase.limit || 5,
      provider: 'auto',
      mode: 'thorough',
      freshness: testCase.freshness || 'none',
      language: testCase.language || 'auto',
    }),
  }), env);
  assert.equal(response.status, 200, `${testCase.name}: search status`);
  const body = await response.json();
  assert.equal(body.ok, true, `${testCase.name}: search ok`);
  return body.results;
}

try {
  for (const testCase of cases) {
    const results = await search(testCase);
    const domains = results.map(domainOf);
    const top3 = domains.slice(0, 3);

    if (testCase.top_domain_one_of) {
      assert.ok(
        testCase.top_domain_one_of.includes(domains[0]),
        diagnostic(testCase, results, `top domain ${domains[0]} not in ${testCase.top_domain_one_of.join(', ')}`),
      );
    }
    for (const domain of testCase.must_include_domains_top3 || []) {
      assert.ok(
        top3.includes(domain),
        diagnostic(testCase, results, `missing ${domain} in top3 ${top3.join(', ')}`),
      );
    }
    for (const domain of testCase.avoid_domains_top3 || []) {
      assert.ok(
        !top3.includes(domain),
        diagnostic(testCase, results, `avoided domain ${domain} appeared in top3 ${top3.join(', ')}`),
      );
    }
    if (testCase.max_same_domain_top3) {
      const counts = top3.reduce((map, domain) => map.set(domain, (map.get(domain) || 0) + 1), new Map());
      const maxCount = counts.size ? Math.max(...counts.values()) : 0;
      assert.ok(
        maxCount <= testCase.max_same_domain_top3,
        diagnostic(testCase, results, `top3 domain pileup ${top3.join(', ')}`),
      );
    }
    console.log(`ok - ${testCase.name}: ${domains.slice(0, 3).join(', ')}`);
  }
  console.log(`search quality cases passed: ${cases.length}`);
} finally {
  globalThis.fetch = originalFetch;
}
