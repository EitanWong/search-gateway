import assert from 'node:assert/strict';
import worker, { _test } from '../src/index.js';

const env = {
  SEARCH_GATEWAY_TOKEN: 'dev-token',
  BRAVE_SEARCH_API_KEY: 'brave-key',
  SERPER_API_KEY: 'serper-key',
  TAVILY_API_KEY: 'tavily-key',
};

const originalFetch = globalThis.fetch;

async function call(path, options = {}, testEnv = env) {
  const req = new Request(`https://gateway.test${path}`, options);
  return worker.fetch(req, testEnv);
}

function post(path, body, testEnv) {
  return call(path, {
    method: 'POST',
    headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, testEnv);
}

function mockFetch(handler) {
  globalThis.fetch = async (input, init) => handler(input, init);
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

function htmlResponse(html, init = {}) {
  return new Response(html, {
    status: init.status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers || {}) },
  });
}

function memoryKv() {
  const store = new Map();
  return {
    async get(key) { return store.get(key) || null; },
    async put(key, value) { store.set(key, value); },
  };
}

try {
  // health is public, but provider configuration is only shown to authenticated callers.
  {
    const res = await call('/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.service, 'search-gateway');
    assert.deepEqual(data.capabilities.search_strategies, ['fallback', 'aggregate']);
    assert.equal(data.capabilities.canonical_dedupe, true);
    assert.equal('providers' in data, false);
    assert.equal('provider_order' in data, false);
    assert.equal('auth_configured' in data, false);

    const authed = await call('/health', {
      method: 'GET',
      headers: { authorization: 'Bearer dev-token' },
    });
    assert.equal(authed.status, 200);
    const authedData = await authed.json();
    assert.equal(authedData.providers.brave, true);
    assert.deepEqual(authedData.provider_order, ['brave', 'serper', 'tavily', 'duckduckgo', 'bing']);
    assert.equal(authedData.auth_configured, true);
  }

  // auth is enforced for both search and fetch.
  {
    const res = await call('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });
    assert.equal(res.status, 401);

    const fetchRes = await call('/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(fetchRes.status, 401);
  }

  // input guardrails reject oversized/unsupported search and request payloads early.
  {
    const oversizedBody = JSON.stringify({ query: 'x'.repeat(17000) });
    const oversizedRes = await call('/search', {
      method: 'POST',
      headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json', 'content-length': String(oversizedBody.length) },
      body: oversizedBody,
    });
    assert.equal(oversizedRes.status, 400);
    assert.match((await oversizedRes.json()).error, /request body too large/);

    const longQueryRes = await post('/search', { query: 'x'.repeat(501) });
    assert.equal(longQueryRes.status, 400);
    assert.equal((await longQueryRes.json()).error, 'query too long; max 500 chars');

    const unsupportedProviderRes = await post('/search', { query: 'test', provider: 'google' });
    assert.equal(unsupportedProviderRes.status, 400);
    assert.equal((await unsupportedProviderRes.json()).error, 'unsupported provider: google');
  }

  // optional KV-backed rate limit rejects requests before spending provider calls.
  {
    const limitedEnv = { ...env, SEARCH_RATE_LIMIT_KV: memoryKv(), SEARCH_RATE_LIMIT_PER_MINUTE: '1' };
    const first = await call('/search', {
      method: 'POST',
      headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ query: 'test', provider: 'google' }),
    }, limitedEnv);
    assert.equal(first.status, 400);

    const second = await call('/search', {
      method: 'POST',
      headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ query: 'test', provider: 'google' }),
    }, limitedEnv);
    assert.equal(second.status, 429);
    const secondData = await second.json();
    assert.equal(secondData.error, 'rate limit exceeded');
    assert.equal(second.headers.get('retry-after'), '60');
  }

  // freshness/language helpers normalize natural-language requests for provider routing.
  {
    assert.equal(_test.normalizeFreshness('auto', 'latest Hermes Agent news'), 'month');
    assert.equal(_test.normalizeFreshness('week', 'anything'), 'week');
    assert.equal(_test.normalizeFreshness('bad-value', 'anything'), 'none');
    assert.equal(_test.normalizeLanguage('auto', '最新 AI 新闻'), 'zh-CN');
    assert.equal(_test.normalizeLanguage('auto', 'latest AI news'), 'en-US');
  }

  // aggregate search queries configured providers in parallel, dedupes canonical URLs, and ranks matches.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      if (url.startsWith('https://api.search.brave.com/')) {
        return jsonResponse({ web: { results: [
          {
            title: 'Plain result',
            url: 'https://Other.test/page?utm_source=news#frag',
            description: 'background only',
          },
          {
            title: 'Search Gateway Agent',
            url: 'https://Example.com/article/?utm_campaign=x&fbclid=1',
            description: 'agent search docs',
          },
        ] } });
      }
      if (url === 'https://google.serper.dev/search') {
        return jsonResponse({ organic: [
          {
            title: 'Agent gateway guide',
            link: 'https://example.com/article/?gclid=ad',
            snippet: 'search gateway with agent details',
          },
        ] });
      }
      if (url === 'https://api.tavily.com/search') {
        return jsonResponse({ results: [
          {
            title: '',
            url: 'https://third.test/post',
            content: 'agent search only in snippet',
          },
        ] });
      }
      if (url.startsWith('https://html.duckduckgo.com/html/')) {
        return htmlResponse('');
      }
      if (url.startsWith('https://www.bing.com/search')) {
        return htmlResponse(`
          <li class="b_algo"><h2><a href="https://example.com/article/?msclkid=abc">Search Gateway Agent Reference</a></h2><p>agent search gateway reference</p></li>
        `);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await post('/search', { query: 'agent search gateway', provider: 'auto', strategy: 'aggregate', limit: 5 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.strategy, 'aggregate');
    assert.deepEqual(data.providers_used, ['brave', 'serper', 'tavily', 'bing']);
    assert.equal(data.count, 3);
    assert.equal(data.results[0].canonical_url, 'https://example.com/article');
    assert.deepEqual(data.results[0].providers, ['brave', 'serper', 'bing']);
    assert.equal(data.results[0].provider, 'brave');
    assert.equal(data.results[0].source, 'example.com');
  }

  // aggregate diagnostics are stable in provider order even when providers fail or return empty.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      if (url.startsWith('https://api.search.brave.com/')) return jsonResponse({ web: { results: [] } });
      if (url === 'https://google.serper.dev/search') return jsonResponse({}, { status: 503 });
      if (url === 'https://api.tavily.com/search') {
        return jsonResponse({ results: [{ title: 'Tavily hit', url: 'https://tavily.test/hit', content: 'agent search' }] });
      }
      if (url.startsWith('https://html.duckduckgo.com/html/')) return htmlResponse('');
      if (url.startsWith('https://www.bing.com/search')) return htmlResponse('');
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await post('/search', { query: 'agent search', provider: 'auto', strategy: 'aggregate', limit: 5 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.deepEqual(data.providers_used, ['tavily']);
    assert.deepEqual(data.warnings, [
      'brave: empty results',
      'serper: serper search failed: 503',
      'duckduckgo: empty results',
      'bing: empty results',
    ]);
  }

  // oversized provider JSON responses are bounded and surfaced as provider warnings.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      if (url.startsWith('https://api.search.brave.com/')) {
        return jsonResponse({ ignored: true }, { headers: { 'content-length': String(2 * 1024 * 1024) } });
      }
      if (url === 'https://google.serper.dev/search') {
        return jsonResponse({ organic: [{ title: 'Serper bounded fallback', link: 'https://bounded.test/a', snippet: 'agent search' }] });
      }
      if (url === 'https://api.tavily.com/search') return jsonResponse({ results: [] });
      if (url.startsWith('https://html.duckduckgo.com/html/')) return htmlResponse('');
      if (url.startsWith('https://www.bing.com/search')) return htmlResponse('');
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await post('/search', { query: 'agent search', provider: 'auto', strategy: 'aggregate', limit: 5 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.deepEqual(data.providers_used, ['serper']);
    assert.match(data.warnings[0], /brave: response too large/);
  }

  // provider fetches do not automatically follow redirects, preventing provider endpoint redirects from becoming SSRF paths.
  {
    let braveCalls = 0;
    mockFetch(async (input, init) => {
      const url = String(input.url || input);
      if (url.startsWith('https://api.search.brave.com/')) {
        braveCalls += 1;
        assert.equal(init.redirect, 'manual');
        return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
      }
      if (url === 'https://google.serper.dev/search') {
        assert.equal(init.redirect, 'manual');
        return jsonResponse({ organic: [{ title: 'Serper after redirect block', link: 'https://redirect-safe.test/a', snippet: 'agent search' }] });
      }
      if (url === 'https://api.tavily.com/search') return jsonResponse({ results: [] });
      if (url.startsWith('https://html.duckduckgo.com/html/')) return htmlResponse('');
      if (url.startsWith('https://www.bing.com/search')) return htmlResponse('');
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await post('/search', { query: 'agent search', provider: 'auto', strategy: 'aggregate', limit: 5 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(braveCalls, 1);
    assert.deepEqual(data.providers_used, ['serper']);
    assert.equal(data.warnings[0], 'brave: brave search failed: 302');
  }

  // SearXNG configuration is SSRF-guarded before any provider fetch is attempted.
  {
    mockFetch(async () => {
      throw new Error('fetch should not be called for blocked SearXNG URL');
    });
    const blockedSearxEnv = { SEARCH_GATEWAY_TOKEN: 'dev-token', SEARXNG_URL: 'http://127.0.0.1:8888' };
    const res = await post('/search', { query: 'hermes searxng', provider: 'searxng', limit: 3 }, blockedSearxEnv);
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.match(data.warnings[0], /SEARXNG_URL blocked: private IP blocked/);
  }

  // SearXNG is a first-class provider when configured, mapping its JSON API into normalized results.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      assert.ok(url.startsWith('https://searx.test/search?'));
      assert.match(url, /format=json/);
      assert.match(url, /categories=general/);
      assert.match(url, /language=zh-CN/);
      assert.match(url, /time_range=week/);
      return jsonResponse({ results: [
        {
          title: 'Hermes Agent from SearXNG',
          url: 'https://searx-result.test/doc?utm_source=x#top',
          content: 'meta search result',
          engine: 'duckduckgo',
          img_src: 'http://169.254.169.254/latest/meta-data',
        },
      ] });
    });

    const searxEnv = { SEARCH_GATEWAY_TOKEN: 'dev-token', SEARXNG_URL: 'https://searx.test' };
    const res = await post('/search', { query: 'hermes searxng', provider: 'searxng', limit: 3, freshness: 'week', language: 'zh-CN' }, searxEnv);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.provider, 'searxng');
    assert.equal(data.freshness, 'week');
    assert.equal(data.language, 'zh-CN');
    assert.equal(data.results[0].canonical_url, 'https://searx-result.test/doc');
    assert.equal(data.results[0].provider, 'searxng');
    assert.deepEqual(data.results[0].providers, ['searxng']);
    assert.equal(data.results[0].site_name, 'duckduckgo');
    assert.equal(data.results[0].image_url, '');
    assert.equal(typeof data.results[0].retrieved_at, 'string');
  }

  // DuckDuckGo HTML fallback parses no-key search results, including uddg redirect URLs.
  {
    const html = `
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fddg%3Futm_campaign%3Dx">Duck Result</a>
        <a class="result__snippet">Duck snippet about search</a>
      </div>`;
    const parsed = _test.parseDuckDuckGoResults(html);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, 'https://example.com/ddg?utm_campaign=x');
    assert.equal(parsed[0].title, 'Duck Result');
    assert.equal(parsed[0].snippet, 'Duck snippet about search');

    mockFetch(async (input, init) => {
      const url = String(input.url || input);
      assert.equal(url, 'https://html.duckduckgo.com/html/');
      assert.equal(init.method, 'POST');
      assert.equal(init.body, 'q=duck+search');
      return htmlResponse(html);
    });

    const noKeyEnv = { SEARCH_GATEWAY_TOKEN: 'dev-token' };
    const res = await post('/search', { query: 'duck search', provider: 'auto', limit: 5 }, noKeyEnv);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.provider, 'duckduckgo');
    assert.equal(data.count, 1);
    assert.equal(data.results[0].canonical_url, 'https://example.com/ddg');
  }

  // DuckDuckGo configurable endpoint is also SSRF-guarded before fetch.
  {
    mockFetch(async () => {
      throw new Error('fetch should not be called for blocked DuckDuckGo endpoint');
    });
    const blockedDdgEnv = { SEARCH_GATEWAY_TOKEN: 'dev-token', DUCKDUCKGO_ENDPOINT: 'http://127.0.0.1:8080/html/' };
    const res = await post('/search', { query: 'duck search', provider: 'duckduckgo', limit: 5 }, blockedDdgEnv);
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.match(data.warnings[0], /DUCKDUCKGO_ENDPOINT blocked: private IP blocked/);
  }

  // auto provider selection works with zero paid keys and never requires third-party search APIs.
  {
    assert.deepEqual(_test.configuredProviders('auto', {}), ['duckduckgo', 'bing']);
    assert.deepEqual(_test.configuredProviders('auto', { SEARXNG_URL: 'https://searx.test' }), ['searxng', 'duckduckgo', 'bing']);
  }

  // fallback keeps compatibility and returns warnings from failed/empty earlier providers.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      if (url.startsWith('https://api.search.brave.com/')) return jsonResponse({ web: { results: [] } });
      if (url === 'https://google.serper.dev/search') return jsonResponse({}, { status: 503 });
      if (url === 'https://api.tavily.com/search') {
        return jsonResponse({ results: [{ title: 'Tavily result', url: 'https://result.test/a', content: 'query match' }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await post('/search', { query: 'query match', provider: 'auto', limit: 3 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.strategy, 'fallback');
    assert.equal(data.provider, 'tavily');
    assert.equal(data.count, 1);
    assert.deepEqual(data.warnings, ['brave: empty results', 'serper: serper search failed: 503']);
  }

  // fetch returns extracted content for non-2xx responses and marks ok false.
  {
    mockFetch(async () => htmlResponse('<title>Missing</title><main>Not found text</main>', { status: 404 }));

    const res = await post('/fetch', { url: 'https://example.com/missing', max_chars: 1000 });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.status, 404);
    assert.equal(data.final_url, 'https://example.com/missing');
    assert.equal(data.source, 'example.com');
    assert.equal(data.title, 'Missing');
    assert.match(data.text, /Not found text/);
  }

  // /fetch turns HTML into agent-readable Markdown while removing obvious page chrome.
  {
    const html = `<!doctype html><html lang="zh-CN"><head>
      <title>原始标题</title>
      <meta property="og:title" content="OG 标题">
      <meta name="description" content="页面描述">
      <meta property="article:published_time" content="2026-06-01T00:00:00Z">
      <meta name="author" content="张三">
      <meta property="og:image" content="https://cdn.example.com/cover.png?utm_source=x">
      <link rel="canonical" href="https://example.com/canonical?utm_campaign=x#frag">
    </head><body>
      <nav>Menu should disappear</nav>
      <article>
        <h1>标题</h1>
        <p>正文段落，包含 <strong>重点</strong> 内容。</p>
        <h2>子标题</h2>
        <ul><li>列表项</li></ul>
        <pre><code>const x = 1;</code></pre>
        <p><a href="/relative">相对链接</a></p>
      </article>
      <footer>版权信息 should disappear</footer>
    </body></html>`;
    mockFetch(async () => htmlResponse(html));

    const res = await post('/fetch', { url: 'https://example.com/article', max_chars: 5000 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.title, 'OG 标题');
    assert.equal(data.description, '页面描述');
    assert.equal(data.author, '张三');
    assert.equal(data.published_at, '2026-06-01T00:00:00.000Z');
    assert.equal(data.canonical_url, 'https://example.com/canonical');
    assert.equal(data.lang, 'zh-CN');
    assert.equal(data.og_image, 'https://cdn.example.com/cover.png');
    assert.match(data.text, /^# 标题/m);
    assert.match(data.text, /\*\*重点\*\*/);
    assert.match(data.text, /^## 子标题/m);
    assert.match(data.text, /^- 列表项/m);
    assert.match(data.text, /```\nconst x = 1;\n```/);
    assert.match(data.text, /\[相对链接\]\(https:\/\/example.com\/relative\)/);
    assert.doesNotMatch(data.text, /Menu should disappear/);
    assert.doesNotMatch(data.text, /版权信息 should disappear/);
    assert.equal(data.char_count, data.text.length);
    assert.equal(data.truncated, false);
    assert.equal(data.is_dynamic, false);
  }

  // /fetch P1 extraction scores prose above link-dense article candidates and exposes richer size metadata.
  {
    const linkBlock = Array.from({ length: 25 }, (_, i) => `<a href="/item-${i}">Nav item ${i} label for related content</a>`).join(' ');
    const prose = '<p>This is a real paragraph with substantive content about the topic and actual evidence.</p><p>A second paragraph continues with more useful information for the reader.</p>';
    const html = `<html><head>
      <meta property="og:site_name" content="Example News">
      <meta property="article:modified_time" content="2026-05-15T12:00:00Z">
    </head><body>
      <article>${linkBlock}</article>
      <article>${prose}</article>
    </body></html>`;
    mockFetch(async () => htmlResponse(html));
    const res = await post('/fetch', { url: 'https://example.com/link-density', max_chars: 5000 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.doesNotMatch(data.text, /Nav item/);
    assert.match(data.text, /substantive content/);
    assert.equal(data.site_name, 'Example News');
    assert.equal(data.modified_at, '2026-05-15T12:00:00.000Z');
    assert.equal(typeof data.word_count, 'number');
    assert.ok(Number.isInteger(data.word_count));
    assert.ok(data.word_count > 0);
  }

  // /fetch P1 recognizes schema.org articleBody wrappers and ignores surrounding chrome.
  {
    const html = `<html><body>
      <header>Ignore this header</header>
      <div itemprop="articleBody"><p>Schema.org annotated article content that should be extracted.</p></div>
      <aside>Related links should disappear</aside>
    </body></html>`;
    mockFetch(async () => htmlResponse(html));
    const res = await post('/fetch', { url: 'https://schema-test.example.com/article' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.text, /Schema\.org annotated/);
    assert.doesNotMatch(data.text, /Ignore this header|Related links/);
  }

  // /fetch P1 flags framework shells with very low visible text yield.
  {
    const reactShell = `<html><head><title>Next App</title></head><body>
      <div id="__next" data-reactroot=""><span>Loading</span></div>
      <script>${'const __NEXT_DATA__=' + 'x'.repeat(9000)}</script>
    </body></html>`;
    mockFetch(async () => htmlResponse(reactShell));
    const res = await post('/fetch', { url: 'https://next-app.example.com/' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.is_dynamic, true);
    assert.match(data.hint, /JS-rendered|browser rendering/i);
  }

  // /fetch P1 surfaces the last visible heading when truncation happens.
  {
    const longContent = `<article>
      <h1>Main Title</h1>
      <p>${'Introduction paragraph content. '.repeat(10)}</p>
      <h2>Deep Section</h2>
      <p>${'Section content that is very long. '.repeat(80)}</p>
    </article>`;
    mockFetch(async () => htmlResponse(longContent));
    const res = await post('/fetch', { url: 'https://example.com/long-article', max_chars: 500 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.truncated, true);
    assert.ok(['Main Title', 'Deep Section'].includes(data.truncated_section));
  }

  // /fetch does not reflect private canonical or markdown link URLs.
  {
    mockFetch(async () => htmlResponse(`<html><head><link rel="canonical" href="http://127.0.0.1/internal"></head><body><article><p><a href="http://169.254.169.254/latest">metadata</a> safe text</p></article></body></html>`));
    const res = await post('/fetch', { url: 'https://example.com/private-links' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.canonical_url, 'https://example.com/private-links');
    assert.doesNotMatch(data.text, /169\.254\.169\.254|127\.0\.0\.1/);
    assert.match(data.text, /metadata safe text/);
  }

  // /fetch decodes numeric entities and truncates at sentence boundaries when possible.
  {
    mockFetch(async () => htmlResponse(`<article><p>&#8220;引用内容&#8221;&#x2013;作者。第二句完整。${'第三句很长。'.repeat(160)}</p></article>`));
    const res = await post('/fetch', { url: 'https://example.com/entities', max_chars: 500 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.truncated, true);
    assert.match(data.text, /“引用内容”–作者。/);
    assert.ok(/[。.!?！？]$/.test(data.text), data.text);
  }

  // /fetch flags JS-rendered shells instead of pretending an empty SPA was understood.
  {
    mockFetch(async () => htmlResponse(`<html><head><title>SPA</title></head><body><div id="root"></div><script>${'x'.repeat(6000)}</script></body></html>`));
    const res = await post('/fetch', { url: 'https://spa.example.com/app' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.is_dynamic, true);
    assert.match(data.hint, /JS-rendered|browser rendering/i);
  }

  // /fetch returns a structured hint for PDFs rather than a generic binary error.
  {
    mockFetch(async () => new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const res = await post('/fetch', { url: 'https://example.com/doc.pdf' });
    assert.equal(res.status, 415);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.content_type, 'application/pdf');
    assert.match(data.hint, /PDF extraction/i);
  }

  // private URLs are blocked before fetch.
  {
    mockFetch(async () => {
      throw new Error('fetch should not be called');
    });

    const res = await post('/fetch', { url: 'http://127.0.0.1/admin' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, 'private IP blocked');

    const ipv6Res = await post('/fetch', { url: 'http://[fc00::1]/admin' });
    assert.equal(ipv6Res.status, 400);
    const ipv6Data = await ipv6Res.json();
    assert.equal(ipv6Data.ok, false);
    assert.equal(ipv6Data.error, 'private IP blocked');

    const linkLocalRes = await post('/fetch', { url: 'http://[febf::1]/admin' });
    assert.equal(linkLocalRes.status, 400);
    const linkLocalData = await linkLocalRes.json();
    assert.equal(linkLocalData.ok, false);
    assert.equal(linkLocalData.error, 'private IP blocked');

    const mappedRes = await post('/fetch', { url: 'http://[::ffff:127.0.0.1]/admin' });
    assert.equal(mappedRes.status, 400);
    const mappedData = await mappedRes.json();
    assert.equal(mappedData.ok, false);
    assert.equal(mappedData.error, 'private IP blocked');

    const decimalRes = await post('/fetch', { url: 'http://2130706433/admin' });
    assert.equal(decimalRes.status, 400);
    assert.equal((await decimalRes.json()).error, 'private IP blocked');

    const trailingLocalhostRes = await post('/fetch', { url: 'http://localhost./admin' });
    assert.equal(trailingLocalhostRes.status, 400);
    assert.equal((await trailingLocalhostRes.json()).error, 'private host blocked');

    const cgnatRes = await post('/fetch', { url: 'http://100.64.0.1/admin' });
    assert.equal(cgnatRes.status, 400);
    assert.equal((await cgnatRes.json()).error, 'private IP blocked');
  }
  // /fetch rejects long URLs and non-text content types instead of reading binary payloads.
  {
    const longUrlRes = await post('/fetch', { url: `https://example.com/${'x'.repeat(2050)}` });
    assert.equal(longUrlRes.status, 400);
    assert.equal((await longUrlRes.json()).error, 'url too long; max 2048 chars');

    mockFetch(async () => new Response('not really an image', { status: 200, headers: { 'content-type': 'image/png' } }));
    const binaryRes = await post('/fetch', { url: 'https://example.com/image.png' });
    assert.equal(binaryRes.status, 415);
    const binaryData = await binaryRes.json();
    assert.equal(binaryData.ok, false);
    assert.equal(binaryData.content_type, 'image/png');
    assert.equal(binaryData.error, 'unsupported content-type: image/png');

    assert.equal(_test.isTextContentType(''), false);
    mockFetch(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const missingTypeRes = await post('/fetch', { url: 'https://example.com/unknown' });
    assert.equal(missingTypeRes.status, 415);
    const missingTypeData = await missingTypeRes.json();
    assert.equal(missingTypeData.ok, false);
    assert.equal(missingTypeData.error, 'unsupported content-type: unknown');
    mockFetch(async () => new Response('<p>too large</p>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(5 * 1024 * 1024) },
    }));
    const tooLargeRes = await post('/fetch', { url: 'https://example.com/huge' });
    assert.equal(tooLargeRes.status, 413);
    const tooLargeData = await tooLargeRes.json();
    assert.equal(tooLargeData.ok, false);
    assert.match(tooLargeData.error, /response too large/);
  }
  // /fetch reports the tracked final URL after safe redirects.
  {
    mockFetch(async (input) => {
      const url = String(input.url || input);
      if (url === 'https://redirect.test/start') {
        return new Response('', { status: 302, headers: { location: '/final' } });
      }
      return htmlResponse('<title>Final</title><p>redirected</p>');
    });

    const res = await post('/fetch', { url: 'https://redirect.test/start' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.final_url, 'https://redirect.test/final');
    assert.equal(data.source, 'redirect.test');
  }

  // redirects preserve only safe fetch headers.
  {
    const seen = [];
    mockFetch(async (input, init) => {
      const url = String(input.url || input);
      seen.push({ url, authorization: init.headers.get('authorization'), cookie: init.headers.get('cookie'), accept: init.headers.get('accept') });
      if (url === 'https://redirect.test/start') {
        return new Response('', { status: 302, headers: { location: 'https://example.com/final' } });
      }
      return htmlResponse('<title>Done</title><p>ok</p>');
    });

    const { response, finalUrl } = await _test.safeFetch('https://redirect.test/start', {
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        accept: 'text/html',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(finalUrl, 'https://example.com/final');
    assert.deepEqual(seen, [
      { url: 'https://redirect.test/start', authorization: null, cookie: null, accept: 'text/html' },
      { url: 'https://example.com/final', authorization: null, cookie: null, accept: 'text/html' },
    ]);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('ok');
