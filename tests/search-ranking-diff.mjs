import { readFileSync, writeFileSync } from 'node:fs';
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function hasArg(name) {
  return process.argv.includes(name);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '(invalid-url)';
  }
}

function brief(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function itemOf(result) {
  const url = result.canonical_url || result.url || '';
  return {
    domain: hostOf(url),
    title: brief(result.title),
    url,
  };
}

function inputSnapshot(testCase, topN) {
  return {
    name: testCase.name,
    query: testCase.query,
    top: (testCase.responses || []).slice(0, topN).map(itemOf),
  };
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

function installMockFetch() {
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
  return () => { globalThis.fetch = originalFetch; };
}

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
  if (response.status !== 200) throw new Error(`${testCase.name}: search status ${response.status}`);
  const body = await response.json();
  if (!body.ok) throw new Error(`${testCase.name}: search failed ${body.error || ''}`);
  return {
    name: testCase.name,
    query: testCase.query,
    top: body.results.map(itemOf),
  };
}

async function currentSnapshot(topN) {
  const restoreFetch = installMockFetch();
  try {
    const snapshots = [];
    for (const testCase of cases) {
      const snapshot = await search(testCase);
      snapshots.push({ ...snapshot, top: snapshot.top.slice(0, topN) });
    }
    return { generated_at: new Date(0).toISOString(), top_n: topN, cases: snapshots };
  } finally {
    restoreFetch();
  }
}

function inputOrderSnapshot(topN) {
  return { generated_at: new Date(0).toISOString(), top_n: topN, cases: cases.map((testCase) => inputSnapshot(testCase, topN)) };
}

function key(item) {
  return `${item.domain}\n${item.url}`;
}

function caseDiff(beforeCase, afterCase, topN) {
  const rows = [];
  const before = beforeCase.top || [];
  const after = afterCase.top || [];
  for (let i = 0; i < topN; i += 1) {
    const oldItem = before[i] || { domain: '(none)', title: '', url: '' };
    const newItem = after[i] || { domain: '(none)', title: '', url: '' };
    if (key(oldItem) !== key(newItem)) rows.push({ rank: i + 1, before: oldItem, after: newItem });
  }
  return rows;
}

function renderItem(item) {
  return `${item.domain} | ${item.title || '(untitled)'} | ${item.url || '(no-url)'}`;
}

function renderDiff(beforeSnapshot, afterSnapshot, topN, mode) {
  const beforeByName = new Map((beforeSnapshot.cases || []).map((item) => [item.name, item]));
  const changed = [];
  for (const afterCase of afterSnapshot.cases || []) {
    const beforeCase = beforeByName.get(afterCase.name) || { name: afterCase.name, query: afterCase.query, top: [] };
    const rows = caseDiff(beforeCase, afterCase, topN);
    if (rows.length) changed.push({ beforeCase, afterCase, rows });
  }

  const lines = [
    '# Search ranking diff',
    `Mode: ${mode}`,
    `Cases: ${(afterSnapshot.cases || []).length}`,
    `Changed cases: ${changed.length}`,
    `Top N: ${topN}`,
    '',
  ];
  for (const change of changed) {
    lines.push(`## ${change.afterCase.name}`);
    lines.push(`Query: ${change.afterCase.query}`);
    for (const row of change.rows) {
      lines.push(`- #${row.rank}`);
      lines.push(`  - before: ${renderItem(row.before)}`);
      lines.push(`  - after:  ${renderItem(row.after)}`);
    }
    lines.push('');
  }
  if (!changed.length) lines.push('No ranking changes.');
  return lines.join('\n');
}

const topN = Number.parseInt(argValue('--top') || '5', 10);
if (!Number.isInteger(topN) || topN <= 0 || topN > 20) throw new Error('--top must be an integer between 1 and 20');

const writePath = argValue('--write-baseline');
const baselinePath = argValue('--baseline');
const current = await currentSnapshot(topN);

if (writePath) {
  writeFileSync(writePath, JSON.stringify(current, null, 2) + '\n');
  console.log(`wrote ranking baseline: ${writePath}`);
  process.exit(0);
}

const baseline = baselinePath
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : inputOrderSnapshot(topN);

const mode = baselinePath ? `${baselinePath} -> current` : 'mock input order -> current ranking';
const report = renderDiff(baseline, current, topN, mode);
console.log(report);

if (hasArg('--fail-on-diff') && report.includes('Changed cases: ') && !report.includes('Changed cases: 0')) {
  process.exitCode = 1;
}
