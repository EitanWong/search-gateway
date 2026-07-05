# search-gateway

Cloudflare Worker search/fetch gateway for agents running in restricted networks.

The local agent talks to one stable endpoint; the Worker handles provider choice, caching, and page fetching.

## Endpoints

- `GET /health` — public health/capability check. Provider configuration details are hidden unless the request includes a valid bearer token.
- `POST /search` — authenticated search.
- `POST /fetch` — authenticated page text extraction.

All authenticated requests require:

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

## Fetch request

```json
{
  "url": "https://example.com/article",
  "max_chars": 8000
}
```

Private/loopback URLs are blocked by default. Requests are capped at 16KB JSON bodies, 500-character search queries, and 2048-character fetch URLs. `/fetch` only extracts text-like responses (`text/*`, JSON, XML, XHTML, RSS/Atom); binary content such as images, zip files, or octet streams returns `415` instead of being read as text. PDFs return a structured `415` with a PDF-extraction hint. `/fetch` also enforces a 4MB response byte cap before text extraction, provider JSON responses are capped at 1MB, and HTML fallback search pages are capped at 2MB.

Optional rate limiting: bind a Cloudflare KV namespace as `SEARCH_RATE_LIMIT_KV` (or `RATE_LIMIT_KV`) and set `SEARCH_RATE_LIMIT_PER_MINUTE` (default `60`) to enable per-IP, per-endpoint minute buckets. This KV limiter is best-effort and not atomic under high burst concurrency; for production exposure, also enforce Cloudflare dashboard rate-limit rules or move to Durable Objects for strict counters. Without the KV binding, in-code rate limiting is disabled.

Fetch responses include `final_url`, `content_type`, source host, metadata, Markdown-ish `text`, `char_count`, `word_count`, and `truncated`. HTML extraction preserves common headings, paragraphs, lists, code blocks, emphasis, and links; removes obvious page chrome such as scripts/styles/nav/header/footer/aside/form; scores competing main-content candidates with a link-density penalty; recognizes common article wrappers and `itemprop="articleBody"`; extracts metadata (`description`, `canonical_url`, `lang`, `published_at`, `modified_at`, `author`, `site_name`, `og_image`); and flags likely JS-rendered pages with `is_dynamic` plus a browser-rendering hint. Non-2xx HTTP responses return `ok: false` with the HTTP status while still including extracted title/text when the response has an allowed text content type.

Example `/fetch` response:

```json
{
  "ok": true,
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
  "word_count": 180,
  "truncated": false,
  "is_dynamic": false,
  "fetched_at": "2026-07-04T00:00:00.000Z"
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

```bash
cd /opt/data/projects/typescript/cloudflare-workers/search-gateway
npx wrangler login
npx wrangler secret put SEARCH_GATEWAY_TOKEN
# Optional no-paid-key meta-search provider (recommended):
# Set SEARXNG_URL as a Worker variable or secret, e.g. https://your-searxng.example.com
npx wrangler secret put SEARXNG_URL
# Optional high-quality paid search providers:
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler deploy
```

After deploy, set Hermes profile env:

```env
SEARCH_GATEWAY_URL=https://search-gateway.<your-subdomain>.workers.dev
SEARCH_GATEWAY_TOKEN=<same token>
```

Then restart Hermes / gateway so the plugin sees the env vars.

## Security notes

- Prefer SearXNG for a no-paid-key, open-source metasearch layer. Self-hosting is more reliable than public instances; the instance must enable JSON output (`format=json`).
- `auto` is designed to keep web search functional with no paid provider keys: DuckDuckGo HTML is tried before Bing HTML.
- Do not deploy without `SEARCH_GATEWAY_TOKEN`.
- Do not commit `.dev.vars`, `.env`, or real secrets.
- `/search` validates configured `SEARXNG_URL` and `DUCKDUCKGO_ENDPOINT` with the same private-host checks used by `/fetch`, so a compromised config cannot turn the Worker into an internal-network probe. Like most Worker-side URL guards, this blocks literal private hosts/IPs but cannot pre-resolve arbitrary public hostnames to prevent DNS-rebinding style answers.
- `/fetch` blocks localhost/private IP literals, URL credentials, localhost-style trailing-dot names, link-local/ULA IPv6, IPv4-mapped IPv6, CGNAT/reserved IPv4 ranges, and common non-public literal address forms to reduce SSRF risk.
- `/fetch` follows redirects manually, re-checks every redirect target, and only forwards safe request headers (`User-Agent`, `Accept`, `Accept-Language`) across redirect hops.
- `/search` provider calls use manual redirect mode; provider-side 3xx responses are treated as provider failures instead of being followed to arbitrary targets.
- Prefer official search APIs (Brave/Serper/Tavily) for quality; Bing HTML is a fallback, not the ideal long-term provider.
