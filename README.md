# search-gateway

Cloudflare Worker search/fetch gateway for agents running in restricted networks.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway)

The local agent talks to one stable endpoint; the Worker handles provider choice, caching, and page fetching. The Deploy to Cloudflare button is zero-config by default: it deploys an open no-key gateway first, then you can optionally set `SEARCH_GATEWAY_TOKEN` to require bearer auth.

## Documentation

- [One-click Cloudflare deployment](docs/cloudflare-one-click.md)
- [Deployment](docs/deployment.md)
- [Hermes integration](integrations/hermes/README.md)
- [Testing and ranking workflow](docs/testing.md)
- [International documentation](docs/i18n/README.md): 简体中文, 日本語, 한국어, Español, Français, Deutsch, Português do Brasil
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)


## Endpoints

- `GET /health` — public health/capability check. In zero-config mode it also reports `auth_mode: "open"`; after `SEARCH_GATEWAY_TOKEN` is configured it reports secure bearer mode only to authenticated callers.
- `POST /search` — search endpoint. Open in zero-config mode; bearer-authenticated after `SEARCH_GATEWAY_TOKEN` is configured.
- `POST /fetch` — page text extraction endpoint. Open in zero-config mode; bearer-authenticated after `SEARCH_GATEWAY_TOKEN` is configured.

When `SEARCH_GATEWAY_TOKEN` is configured, authenticated requests require:

```http
Authorization: Bearer <gateway-token>
Content-Type: application/json
```

## Search request

```json
{
  "query": "Hermes Agent toolsets",
  "limit": 8,
  "provider": "auto",
  "strategy": "fallback",
  "freshness": "none",
  "language": "auto"
}
```

Providers:

- `auto` — SearXNG when configured → configured paid APIs → DuckDuckGo HTML → Bing HTML.
- `searxng` — self-hosted/open SearXNG JSON API. No paid search key required; configure `SEARXNG_URL`.
- `brave`
- `serper`
- `tavily`
- `duckduckgo` — no-key DuckDuckGo HTML fallback.
- `bing` — no-key Bing HTML fallback.

Strategies:

- `fallback` — default for backwards compatibility and cost control. Providers are tried in order until one returns results. With `provider: "auto"`, unconfigured paid providers are skipped; zero-key search still works through DuckDuckGo/Bing HTML.
- `aggregate` — with `provider: "auto"`, all available providers are queried in parallel, including no-key DuckDuckGo/Bing fallback sources. Results are canonicalized, deduped, and ranked.

Freshness/language:

- `freshness` — `none` (default), `auto`, `day`, `week`, `month`, or `year`. `auto` detects recency intent such as "latest", "news", "最新", "最近" and currently maps it to `month`.
- `language` — `auto` (default), `zh-CN`, `en-US`, or a provider-supported locale/market. `auto` routes CJK queries to `zh-CN`; otherwise `en-US`.
- Provider support is best-effort: SearXNG/Brave/Serper/Tavily/Bing receive freshness parameters; DuckDuckGo HTML uses language headers only.
- Ranking is multilingual: ASCII tokens and CJK bigrams both contribute to relevance, so Chinese queries such as `最新人工智能新闻` do not collapse to provider order. When `freshness` is not `none`, recent parseable results get a bounded boost; topical title matches still dominate fresh-but-irrelevant pages. Ranking also applies small deterministic source-quality adjustments: GitHub/government/education/docs/developer hosts get a limited credibility boost, obvious SEO/download-spam hosts are demoted, URL consensus across providers and same-host consensus get bounded tie-breaking boosts, and top results are diversified so one domain does not crowd out other relevant sources. Consensus scoring is URL/host-level only; it does not infer semantic claim agreement.

Search responses include diagnostics:

```json
{
  "ok": true,
  "strategy": "aggregate",
  "provider": "auto",
  "providers_used": ["brave", "serper", "bing"],
  "query": "Hermes Agent toolsets",
  "freshness": "none",
  "language": "en-US",
  "count": 2,
  "results": [
    {
      "title": "Hermes Agent",
      "url": "https://example.com/article",
      "canonical_url": "https://example.com/article",
      "snippet": "Result summary",
      "source": "example.com",
      "provider": "brave",
      "providers": ["brave", "bing"],
      "published_at": "2026-07-04T00:00:00.000Z",
      "author": "",
      "site_name": "example.com",
      "image_url": "",
      "retrieved_at": "2026-07-04T00:00:00.000Z"
    }
  ],
  "warnings": [],
  "details": [],
  "fetched_at": "2026-07-04T00:00:00.000Z"
}
```

`canonical_url` removes hash fragments, common tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`), normalizes host casing, and strips non-root trailing slashes. Provider errors and empty-provider notes are reported in `warnings`/`details` without secret values.

## Search quality regression

Run the deterministic offline quality harness before changing ranking/provider logic:

```bash
npm run test:search-quality
```

The harness reads `tests/search-quality-cases.json`, mocks provider responses, and exercises the real `/search` handler with `strategy: "aggregate"`. It protects core live-search behavior across 20+ adversarial cases: official/credible sources, Chinese relevance, freshness ranking, developer docs, GitHub/source-code preference, government/education/public-health sources, product pricing, release notes, API docs, finance/news freshness, SEO/coupon/download-spam demotion, domain diversity, mixed Chinese/English entity queries, and false-positive guards such as `Seoul`, `crackdown`, and `torrential` not being penalized by spam tokens. On failure it prints the query, expected rule block, actual top results with domain/title/URL, and mock input order for quick ranking diagnosis. It is intentionally not a KB/RAG benchmark and does not measure corpus ingestion.

Use the deterministic ranking diff reporter to inspect ordering changes before/after ranking tweaks:

```bash
npm run ranking:diff -- --top 3
npm run ranking:diff -- --write-baseline /tmp/search-ranking-baseline.json
npm run ranking:diff -- --baseline /tmp/search-ranking-baseline.json --top 3
```

Without `--baseline`, the reporter compares mock provider input order to current ranked output. With `--baseline`, it compares a saved current-ranking snapshot to the new current ranking. It uses the same fixed fixtures and mocked providers as the quality harness; it is an explainability/debug report, not a pass/fail quality gate unless `--fail-on-diff` is supplied.

## Fetch request

```json
{
  "url": "https://example.com/article",
  "max_chars": 8000
}
```

Private/loopback URLs are blocked by default. Requests are capped at 16KB JSON bodies for `/search` and `/fetch`, 32KB for `/batch_fetch` and `/search_fetch`, 500-character search queries, and 2048-character fetch URLs. `/fetch` only extracts text-like responses (`text/*`, JSON, XML, XHTML, RSS/Atom); binary content such as images, zip files, or octet streams returns `415` instead of being read as text. PDFs return a structured `415` with a PDF-extraction hint. `/fetch` also enforces a 4MB response byte cap before text extraction, provider JSON responses are capped at 1MB, and HTML fallback search pages are capped at 2MB.

Optional rate limiting: bind a Cloudflare KV namespace as `SEARCH_RATE_LIMIT_KV` (or `RATE_LIMIT_KV`) and set `SEARCH_RATE_LIMIT_PER_MINUTE` (default `60`) to enable per-IP, per-endpoint minute buckets. This KV limiter is best-effort and not atomic under high burst concurrency; for production exposure, also enforce Cloudflare dashboard rate-limit rules or move to Durable Objects for strict counters. Without the KV binding, in-code rate limiting is disabled.

Fetch responses include `request_id`, `mode`, `cache`, `final_url`, `content_type`, source host, metadata, Markdown-ish `text`, `char_count`, `total_chars`, `offset`, `next_offset`, `word_count`, and `truncated` in the default `mode: "full"`. Error responses include machine-actionable `error_code` and `suggested_action` where possible, so agents can branch without parsing prose. Callers can request `mode: "metadata"` to omit body text, `mode: "text"` to omit metadata, or `mode: "chunks"` to return metadata plus heading/paragraph-bounded `chunks[]` without top-level `text`. `chunk_chars` controls approximate chunk size. HTML extraction uses charset-aware decoding (`Content-Type`/HTML meta charset), falls back from missing meta/title to `<h1>` for page title, preserves common headings, paragraphs, ordered/unordered lists, tables, blockquotes, code blocks, emphasis, and links; honors safe `<base href>` for relative links; removes obvious page chrome such as scripts/styles/nav/header/footer/aside/form; scores competing main-content candidates with a link-density penalty; recognizes common article wrappers and `itemprop="articleBody"`; extracts metadata from meta/OG plus JSON-LD Article data (`description`, `canonical_url`, `lang`, `published_at`, `modified_at`, `author`, `site_name`, `og_image`); and flags likely JS-rendered pages with `is_dynamic` plus a browser-rendering hint. Non-2xx HTTP responses return `ok: false` with the HTTP status while still including extracted title/text when the response has an allowed text content type. Long pages can be paged with request fields `offset` and `max_chars`. Extracted full fetch results are cached with the Worker Cache API when available; set `cache_ttl` or env `FETCH_CACHE_TTL_SECONDS` to control TTL, or `cache_ttl: 0`/`false` to disable.

Example `/fetch` response:

```json
{
  "ok": true,
  "request_id": "gw_00000000-0000-00",
  "mode": "full",
  "cache": "miss",
  "url": "https://example.com/article",
  "final_url": "https://example.com/article",
  "status": 200,
  "content_type": "text/html; charset=utf-8",
  "source": "example.com",
  "title": "Article Title",
  "description": "Page summary",
  "canonical_url": "https://example.com/article",
  "lang": "en-US",
  "published_at": "2026-07-04T00:00:00.000Z",
  "modified_at": "2026-07-05T00:00:00.000Z",
  "author": "Author Name",
  "site_name": "Example Site",
  "og_image": "https://example.com/cover.png",
  "text": "# Article Title\n\nReadable body...",
  "char_count": 1024,
  "total_chars": 4096,
  "offset": 0,
  "next_offset": 1024,
  "word_count": 180,
  "truncated": true,
  "is_dynamic": false,
  "fetched_at": "2026-07-04T00:00:00.000Z"
}
```

Example `mode: "chunks"` response shape:

```json
{
  "ok": true,
  "mode": "chunks",
  "cache": "hit",
  "title": "Article Title",
  "total_chars": 4096,
  "chunk_chars": 1800,
  "chunk_count": 3,
  "chunks": [
    {
      "index": 0,
      "heading": "Article Title",
      "text": "# Article Title\n\nReadable body...",
      "char_count": 1024,
      "offset": 0
    }
  ]
}
```

## Batch fetch request

`/batch_fetch` accepts up to 10 fetch requests and returns results in input order. This is the Agent-first path for reading several search results without forcing the model to make one tool call per URL. Each item is isolated: one blocked/failed URL does not fail the whole batch. If all items fail, the endpoint returns top-level `ok:false` with HTTP 502 while preserving per-item causes.

```json
{
  "requests": [
    {"url": "https://example.com/a", "mode": "metadata"},
    {"url": "https://example.com/b", "mode": "chunks", "chunk_chars": 1800}
  ]
}
```

Example `/batch_fetch` response shape:

```json
{
  "ok": true,
  "request_id": "gw_00000000-0000-00",
  "count": 2,
  "success_count": 1,
  "failed_count": 1,
  "results": [
    {"index": 0, "ok": true, "mode": "metadata", "title": "A"},
    {"index": 1, "ok": false, "error_code": "BLOCKED_URL", "suggested_action": "choose_public_http_url"}
  ]
}
```

## Search and fetch request

`/search_fetch` is the highest-level Agent-native primitive: it runs `/search`, selects the top `fetch_top` results, and fetches them with `/batch_fetch` in one call.

```json
{
  "query": "agent native web research",
  "limit": 8,
  "fetch_top": 3,
  "provider": "auto",
  "strategy": "fallback",
  "freshness": "auto",
  "language": "auto",
  "fetch_mode": "chunks"
}
```

Example `/search_fetch` response shape:

```json
{
  "ok": true,
  "request_id": "gw_00000000-0000-00",
  "search": {"ok": true, "count": 8, "results": []},
  "fetch_top": 3,
  "fetched": {"ok": true, "success_count": 3, "results": []}
}
```

## Local test

```bash
npm test
```

The default test suite mocks provider and page fetches, so it is deterministic and does not require internet access.

Optional live smoke test:

```bash
npm run test:live
```

The live smoke uses Bing HTML search and `https://example.com`; it is intentionally separate from `npm test`.

## Deploy

### One-click Cloudflare deploy

Use the button at the top of this README. The default deployment requires no secrets or provider keys:

- build command: `npm run build`
- deploy command: `npm run deploy`
- Worker config: `deploy-template/wrangler.jsonc`
- default search: no-key DuckDuckGo/Bing HTML fallbacks
- default auth mode: `open`

After deployment, visit `/health`. If you want bearer auth, generate a token and set it as a Worker secret:

```bash
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

Optional providers can be added later:

```bash
npx wrangler secret put SEARXNG_URL
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
```

Manual deploy from a local checkout:

```bash
npm ci
npm run build
npm run deploy
```

After deploy, set Hermes profile env:

```env
SEARCH_GATEWAY_URL=https://search-gateway.<your-subdomain>.workers.dev
# Optional. Only set this if you configured SEARCH_GATEWAY_TOKEN on the Worker.
SEARCH_GATEWAY_TOKEN=<your-worker-secret>
```

Then restart Hermes / gateway so the plugin sees the env vars. The Hermes plugin exposes `search_web`, `fetch_url`, `batch_fetch_urls`, and `search_and_fetch`; `fetch_url` supports the Worker's Agent-native fields `mode` (`full`, `text`, `metadata`, `chunks`), `offset`, `chunk_chars`, and `cache_ttl`, `batch_fetch_urls` reads up to 10 URLs in one gateway call for cheap metadata triage or parallel chunk extraction, and `search_and_fetch` compresses search → fetch top results into one tool call.

## Security notes

- Prefer SearXNG for a no-paid-key, open-source metasearch layer. Self-hosting is more reliable than public instances; the instance must enable JSON output (`format=json`).
- `auto` is designed to keep web search functional with no paid provider keys: DuckDuckGo HTML is tried before Bing HTML.
- The one-click deployment intentionally starts in `auth_mode: "open"` so Cloudflare can deploy it with zero mandatory form fields. Set `SEARCH_GATEWAY_TOKEN` as a Worker secret to switch `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` to bearer-auth mode.
- Keep open mode only for personal/testing deployments or behind Cloudflare Access/rate limits. For public production use, configure `SEARCH_GATEWAY_TOKEN` and Cloudflare dashboard rate limiting.
- Do not commit `.dev.vars`, `.env`, or real secrets.
- `/search` validates configured `SEARXNG_URL` and `DUCKDUCKGO_ENDPOINT` with the same private-host checks used by `/fetch`, so a compromised config cannot turn the Worker into an internal-network probe. Like most Worker-side URL guards, this blocks literal private hosts/IPs but cannot pre-resolve arbitrary public hostnames to prevent DNS-rebinding style answers.
- `/fetch` blocks localhost/private IP literals, URL credentials, localhost-style trailing-dot names, link-local/ULA IPv6, IPv4-mapped IPv6, CGNAT/reserved IPv4 ranges, and common non-public literal address forms to reduce SSRF risk.
- `/fetch` follows redirects manually, re-checks every redirect target, and only forwards safe request headers (`User-Agent`, `Accept`, `Accept-Language`) across redirect hops.
- `/search` provider calls use manual redirect mode; provider-side 3xx responses are treated as provider failures instead of being followed to arbitrary targets.
- Prefer official search APIs (Brave/Serper/Tavily) for quality; Bing HTML is a fallback, not the ideal long-term provider.
