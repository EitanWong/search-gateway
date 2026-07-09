# Configuration reference

This page lists the Cloudflare variables, secrets, bindings, and request options supported by `search-gateway`.

## Where to configure values

| Kind | Cloudflare location | Use for | Visible after save? |
|---|---|---|---|
| Variable | Worker → Settings → Variables and Secrets → Variables | Non-sensitive options such as mode, language, market, limits | Yes |
| Secret | Worker → Settings → Variables and Secrets → Secrets | Tokens/API keys/passwords | No |
| Binding | Worker → Settings → Bindings | KV, service bindings, future storage | Binding metadata only |

Do not store provider API keys or bearer tokens as plaintext variables. Use Cloudflare Secrets.

## Recommended deployment defaults

`deploy-template/wrangler.toml` ships with:

```toml
[vars]
SEARCH_GATEWAY_MODE = "public"
BING_MARKET = "en-US"
DUCKDUCKGO_LANGUAGE = "en-US"
```

This makes one-click deployment immediately usable without mandatory secrets.

## Auth and access control

| Name | Type | Default | Values | Description |
|---|---|---|---|---|
| `SEARCH_GATEWAY_MODE` | Variable | `public` | `public`, `private` | Main auth mode. Public mode allows anyone with the URL to use search/fetch. Private mode requires `SEARCH_GATEWAY_TOKEN`. Aliases accepted by code: `open` → public; `bearer`, `secure` → private. |
| `SEARCH_GATEWAY_TOKEN` | Secret | unset | random string | Required only when `SEARCH_GATEWAY_MODE=private`. Requests must include `Authorization: Bearer <token>`. |
| `SEARCH_GATEWAY_ALLOW_OPEN` | Variable | unset | `true` | Backward-compatible legacy opt-in for public mode. Prefer `SEARCH_GATEWAY_MODE=public` in new deployments. |

### Public mode

Best for demos, quick testing, and low-friction one-click deployments.

```toml
SEARCH_GATEWAY_MODE = "public"
```

### Private mode

Best for long-running personal deployments.

1. Set normal variable:

```env
SEARCH_GATEWAY_MODE=private
```

2. Add secret:

```bash
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

3. Send requests with:

```http
Authorization: Bearer <token>
```

## Search providers

### Provider selection order

With `provider: "auto"`, configured providers are tried before no-key fallbacks:

```text
SearXNG → Brave → Serper → Tavily → DuckDuckGo HTML → Bing HTML
```

If no paid provider keys are configured, the gateway still works through DuckDuckGo/Bing HTML where reachable.

| Name | Type | Required? | Description |
|---|---|---:|---|
| `SEARXNG_URL` | Variable or Secret | Optional | Base URL of a SearXNG instance with JSON output enabled. Example: `https://searx.example.com`. |
| `SEARXNG_SECRET` | Secret | Optional | Bearer token sent to SearXNG when your SearXNG instance requires auth. |
| `SEARXNG_CATEGORIES` | Variable | Optional | SearXNG categories. Default: `general`. |
| `SEARXNG_LANGUAGE` | Variable | Optional | SearXNG language. Default: request language or `auto`. |
| `SEARXNG_SAFESEARCH` | Variable | Optional | SearXNG safesearch. Default: `0`. |
| `BRAVE_SEARCH_API_KEY` | Secret | Optional | Brave Search API key. Enables `provider: "brave"` and participates in `auto`. |
| `SERPER_API_KEY` | Secret | Optional | Serper API key. Enables `provider: "serper"` and participates in `auto`. |
| `TAVILY_API_KEY` | Secret | Optional | Tavily API key. Enables `provider: "tavily"` and participates in `auto`. |
| `DUCKDUCKGO_ENDPOINT` | Variable | Optional | DuckDuckGo HTML endpoint override. Default: `https://html.duckduckgo.com/html/`. Usually do not change this. |
| `DUCKDUCKGO_LANGUAGE` | Variable | Optional | DuckDuckGo/Bing language fallback. Default template value: `en-US`. |
| `BING_MARKET` | Variable | Optional | Bing market/language fallback. Default template value: `en-US`. |

## Rate limiting

Rate limiting is optional and requires a KV binding.

| Name | Type | Default | Description |
|---|---|---|---|
| `SEARCH_RATE_LIMIT_KV` | KV binding | unset | Preferred KV binding used for per-IP per-path rate limiting. |
| `RATE_LIMIT_KV` | KV binding | unset | Backward-compatible alternate KV binding name. |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Variable | `60` | Maximum requests per IP/path/minute when KV rate limiting is configured. |

Without a KV binding, rate limiting is disabled.

Example `wrangler.toml` binding:

```toml
[[kv_namespaces]]
binding = "SEARCH_RATE_LIMIT_KV"
id = "<kv-namespace-id>"
```

### Cloudflare Dashboard setup

Use this when you deployed through the Cloudflare button and prefer the web UI over Wrangler.

1. Create a KV namespace:

```text
Cloudflare Dashboard
→ Workers & Pages
→ KV
→ Create a namespace
→ Name: search-gateway-rate-limit
```

2. Bind the namespace to your Worker:

```text
Workers & Pages
→ your search-gateway Worker
→ Settings
→ Bindings
→ Add binding
→ KV namespace
```

Use:

| Field | Value |
|---|---|
| Variable name | `SEARCH_RATE_LIMIT_KV` |
| KV namespace | `search-gateway-rate-limit` |

3. Set the per-minute limit:

```text
Worker → Settings → Variables and Secrets → Variables → Add variable
```

| Variable | Example |
|---|---|
| `SEARCH_RATE_LIMIT_PER_MINUTE` | `60` |

4. Deploy or redeploy the Worker if Cloudflare asks you to apply changes.

5. Confirm `/health` reports the binding when configuration details are visible:

```bash
curl -s "$WORKER_URL/health"
```

Look for:

```json
{
  "optional_kv_rate_limit": true
}
```

### Operational notes

- The in-code KV limiter is best-effort and uses per-IP, per-path minute buckets.
- KV counters are not atomic under high burst concurrency.
- For serious public exposure, also configure Cloudflare dashboard rate limiting / WAF rules.
- If no KV binding is present, rate limiting is disabled even if `SEARCH_RATE_LIMIT_PER_MINUTE` is set.

## Fetch and extraction

| Name | Type | Default | Description |
|---|---|---|---|
| `FETCH_CACHE_TTL_SECONDS` | Variable | `300` | Default Worker cache TTL for fetched pages when request body omits `cache_ttl`. Max is clamped by Worker code. |

The fetch endpoint also accepts per-request options; see [Request options](#request-options).

## Health output

`GET /health` reports capabilities and setup state.

Public mode example:

```json
{
  "ok": true,
  "service": "search-gateway",
  "version": "0.1.0",
  "auth_mode": "public",
  "setup": { "status": "public_mode" }
}
```

Private mode with token configured:

```json
{
  "auth_mode": "bearer",
  "setup": { "status": "secure" }
}
```

Private mode without token:

```json
{
  "auth_mode": "private_unconfigured",
  "setup": { "status": "token_required" }
}
```

## Request options

### `/search`

```json
{
  "query": "Cloudflare Workers docs",
  "limit": 8,
  "provider": "auto",
  "strategy": "fallback",
  "freshness": "none",
  "language": "auto"
}
```

| Field | Default | Values | Description |
|---|---|---|---|
| `query` | required | string | Search query. Max 500 chars. |
| `limit` | `8` | 1–20 | Max results. |
| `provider` | `auto` | `auto`, `searxng`, `brave`, `serper`, `tavily`, `duckduckgo`, `bing` | Provider to use. |
| `strategy` | `fallback` | `fallback`, `aggregate` | Sequential fallback or parallel merge/ranking. |
| `freshness` | `none` | `none`, `auto`, `day`, `week`, `month`, `year` | Recency hint. `auto` detects news/latest intent. |
| `language` | `auto` | `auto`, `zh-CN`, `en-US`, provider-supported values | Language/market hint. |

### `/fetch`

```json
{
  "url": "https://example.com/article",
  "mode": "full",
  "max_chars": 8000,
  "offset": 0,
  "chunk_chars": 1800,
  "cache_ttl": 300
}
```

| Field | Default | Values | Description |
|---|---|---|---|
| `url` | required | HTTP(S) URL | URL to fetch and extract. Private/local literal hosts are blocked. |
| `mode` | `full` | `full`, `text`, `metadata`, `chunks` | Extraction mode. |
| `max_chars` | `8000` | 500–30000 | Text window size. |
| `offset` | `0` | integer | Continue extraction from previous `next_offset`. |
| `chunk_chars` | `1800` | 300–6000 | Approximate chunk size in `chunks` mode. |
| `cache_ttl` | env/default | 0–3600 | Worker cache TTL seconds. `0` disables cache for that request. |

### `/batch_fetch`

```json
{
  "requests": [
    { "url": "https://example.com/a", "mode": "metadata" },
    { "url": "https://example.com/b", "mode": "chunks" }
  ]
}
```

Max 10 fetch requests per call.

### `/search_fetch`

```json
{
  "query": "Cloudflare Worker 1101 error",
  "limit": 8,
  "fetch_top": 3,
  "provider": "auto",
  "strategy": "fallback",
  "freshness": "none",
  "language": "auto",
  "fetch_mode": "chunks",
  "max_chars": 8000,
  "chunk_chars": 1800,
  "cache_ttl": 300
}
```

Combines search and fetch in one call for agent workflows.

## Common setups

### One-click demo

```env
SEARCH_GATEWAY_MODE=public
BING_MARKET=en-US
DUCKDUCKGO_LANGUAGE=en-US
```

No secrets required.

### Personal private gateway

```env
SEARCH_GATEWAY_MODE=private
```

Secrets:

```env
SEARCH_GATEWAY_TOKEN=<random-token>
```

### Higher-quality search

Variables/secrets:

```env
SEARCH_GATEWAY_MODE=private
SEARCH_GATEWAY_TOKEN=<random-token>
BRAVE_SEARCH_API_KEY=<secret>
SERPER_API_KEY=<secret>
TAVILY_API_KEY=<secret>
```

### Self-hosted SearXNG first

```env
SEARXNG_URL=https://searx.example.com
SEARXNG_CATEGORIES=general
SEARXNG_LANGUAGE=auto
SEARXNG_SAFESEARCH=0
```

If your SearXNG instance is private, add:

```env
SEARXNG_SECRET=<secret>
```

## Safety notes

- Public mode is intentionally convenient, but anyone with the URL can use the gateway.
- Use private mode for long-running personal deployments.
- Keep API keys and bearer tokens as Cloudflare Secrets.
- Do not commit `.dev.vars`, `.env`, or real secrets.
- `/fetch`, provider endpoint overrides, and redirects include SSRF guardrails, but no URL guard is a substitute for careful deployment configuration.
