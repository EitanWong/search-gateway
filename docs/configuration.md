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
| `SEARCH_GATEWAY_TOKEN` | Secret | unset | random string | Required only when `SEARCH_GATEWAY_MODE=private`. Send it in the HTTP `Authorization` bearer header. |
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
SearXNG → Zhipu → Bocha Web → Brave → Serper → Tavily → DuckDuckGo HTML → Bing HTML
```

If no paid provider keys are configured, the gateway still works through DuckDuckGo/Bing HTML where reachable. Bocha AI Search is costlier than Bocha Web Search, so `bocha_ai` stays opt-in for normal `auto` searches and is included automatically only in `mode: "thorough"`.

| Name | Type | Required? | Description |
|---|---|---:|---|
| `SEARXNG_URL` | Variable or Secret | Optional | Base URL of a SearXNG instance with JSON output enabled. Example: `https://searx.example.com`. |
| `SEARXNG_SECRET` | Secret | Optional | Bearer token sent to SearXNG when your SearXNG instance requires auth. |
| `SEARXNG_CATEGORIES` | Variable | Optional | SearXNG categories. Default: `general`. |
| `SEARXNG_LANGUAGE` | Variable | Optional | SearXNG language. Default: request language or `auto`. |
| `SEARXNG_SAFESEARCH` | Variable | Optional | SearXNG safesearch. Default: `0`. |
| `ZHIPU_API_KEY` | Secret | Optional | Zhipu AI Web Search API key. Enables `provider: "zhipu"` and participates in `auto`. SDK-style `id.secret` keys are converted to the required short-lived JWT in the Worker. |
| `ZHIPU_SEARCH_ENGINE` | Variable | Optional | Zhipu engine. Default: `search_pro`; alternatives include `search_pro_sogou` and `search_pro_quark`. |
| `ZHIPU_CONTENT_SIZE` | Variable | Optional | Zhipu content size. Default: `medium`; set `high` for longer snippets. |
| `ZHIPU_SEARCH_DOMAIN_FILTER` | Variable | Optional | Optional Zhipu domain filter such as `www.example.com`. |
| `BOCHA_API_KEY` | Secret | Optional | Bocha API key. Enables `provider: "bocha"` for Web Search and `provider: "bocha_ai"` for AI Search; both participate in `auto`. |
| `BOCHA_SUMMARY` | Variable | Optional | Bocha summary flag. Default: `false`, matching Bocha's API default. Set `true` for longer summaries. |
| `BOCHA_INCLUDE` | Variable | Optional | Optional Bocha include domain filter. Separate up to 100 root/subdomains with `|` or `,`, for example `qq.com|m.163.com`. |
| `BOCHA_EXCLUDE` | Variable | Optional | Optional Bocha exclude domain filter. Separate up to 100 root/subdomains with `|` or `,`, for example `qq.com|m.163.com`. |
| `BOCHA_AI_ANSWER` | Variable | Optional | Bocha AI Search answer flag. Default: `false`. Set `true` to let Bocha generate answer/follow-up messages; `/search` still only returns normalized `source/webpage` results. |
| `BOCHA_RERANK_MODEL` | Variable | Optional | Default model for `/rerank`. Default: `gte-rerank`; Bocha semantic reranker CN/EN models may require invite access. |
| `/balance` | Endpoint | Optional | Generic provider balance endpoint. Currently supports `provider: "bocha"` with `BOCHA_API_KEY`. |
| `COHERE_API_KEY` | Secret | Optional | Cohere Rerank API key. Enables `cohere_rerank`. |
| `COHERE_RERANK_MODEL` | Variable | Optional | Cohere rerank model. Default: `rerank-v3.5`. |
| `JINA_API_KEY` | Secret | Optional | Jina AI Reranker API key. Enables `jina_rerank`. |
| `JINA_RERANK_MODEL` | Variable | Optional | Jina rerank model. Default: `jina-reranker-v3`. |
| `VOYAGE_API_KEY` | Secret | Optional | Voyage AI Rerank API key. Enables `voyage_rerank`. |
| `VOYAGE_RERANK_MODEL` | Variable | Optional | Voyage rerank model. Default: `rerank-2.5`. |
| `SILICONFLOW_API_KEY` | Secret | Optional | SiliconFlow Rerank API key. Enables `siliconflow_rerank`. |
| `SILICONFLOW_RERANK_MODEL` | Variable | Optional | SiliconFlow rerank model. Default: `BAAI/bge-reranker-v2-m3`. |
| `BRAVE_SEARCH_API_KEY` | Secret | Optional | Brave Search API key. Enables `provider: "brave"` and participates in `auto`. |
| `SERPER_API_KEY` | Secret | Optional | Serper API key. Enables `provider: "serper"` and participates in `auto`. |
| `TAVILY_API_KEY` | Secret | Optional | Tavily API key. Enables `provider: "tavily"` and participates in `auto`. |
| `DUCKDUCKGO_ENDPOINT` | Variable | Optional | DuckDuckGo HTML endpoint override. Default: `https://html.duckduckgo.com/html/`. Usually do not change this. |
| `DUCKDUCKGO_LANGUAGE` | Variable | Optional | DuckDuckGo/Bing language fallback. Default template value: `en-US`. |
| `BING_MARKET` | Variable | Optional | Bing market/language fallback. Default template value: `en-US`. |
| `SEARCH_PROVIDER_TIMEOUT_MS` | Variable | Optional | Per-provider search timeout. Default: `8000`; clamped to `1000`–`30000`. Applies to each provider call in every search mode. |
| `RERANK_PROVIDER_TIMEOUT_MS` | Variable | Optional | Per-provider rerank timeout. Default: `6000`; clamped to `1000`–`30000`. Applies independently to each configured rerank provider. |

## Rate limiting

Rate limiting is optional and requires a KV binding.

| Name | Type | Default | Description |
|---|---|---|---|
| `SEARCH_RATE_LIMIT_KV` | KV binding | unset | Preferred KV binding used for per-IP per-path rate limiting. |
| `RATE_LIMIT_KV` | KV binding | unset | Backward-compatible alternate KV binding name. |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Variable | `60` | Maximum requests per IP/path/minute when KV rate limiting is configured. |

Without a KV binding, rate limiting is disabled.

For Bocha provider pricing, resource packages, and account-tier QPS/QPM/QPD limits, see [Bocha pricing and rate limits](bocha-pricing.md). Set `SEARCH_RATE_LIMIT_PER_MINUTE` conservatively when exposing a Worker publicly; Bocha Tier 0 is only `30 QPM`.

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
  "mode": "balanced",
  "freshness": "none",
  "language": "auto",
  "rerank": "auto"
}
```

| Field | Default | Values | Description |
|---|---|---|---|
| `query` | required | string | Search query. Max 500 chars. |
| `limit` | `8` | 1–20 | Max results. |
| `provider` | `auto` | `auto`, `searxng`, `zhipu`, `bocha`, `bocha_ai`, `brave`, `serper`, `tavily`, `duckduckgo`, `bing` | Provider to use. |
| `mode` | `balanced` | `fast`, `balanced`, `thorough` | Search execution mode. `fast` is sequential and disables implicit rerank; `balanced` parallelizes the first provider wave without implicit rerank; `thorough` aggregates all configured providers and reranks when configured. |
| `freshness` | `none` | `none`, `auto`, `day`, `week`, `month`, `year` | Recency hint. `auto` detects news/latest intent. |
| `language` | `auto` | `auto`, `zh-CN`, `en-US`, provider-supported values | Language/market hint. |
| `rerank` | mode-dependent | `auto`, `false`, comma-separated rerank providers | Optional second-stage rerank. Omitted means disabled in `fast`/`balanced` and `auto` in `thorough`; pass `auto` or provider names to enable explicitly. |
| `rerank_pool` | `limit * 3` | 1–20 | Candidate pool size before rerank. Only used when a rerank provider is configured. |

Supported rerank providers: `bocha_rerank`, `cohere_rerank`, `jina_rerank`, `voyage_rerank`, `siliconflow_rerank`.

When `/search` rerank is enabled, the final ordering blends rerank scores with the base search credibility/relevance score. This keeps rerank useful for semantic relevance while preserving official-source, anti-spam, freshness, and consensus signals from the first-stage ranker.

Search responses include diagnostics for cost and latency tuning:

- `providers_attempted` lists search providers actually called, including failed/empty fallback attempts.
- `rerank_providers_attempted` lists rerank providers called when rerank is enabled.
- `cost_hints.paid_search_calls` and `cost_hints.paid_rerank_calls` count paid-provider attempts, not just successful providers.

### `/rerank`

```json
{
  "query": "阿里巴巴2024年的ESG报告",
  "documents": ["candidate document 1", "candidate document 2"],
  "top_n": 2,
  "provider": "auto",
  "return_documents": false
}
```

`documents` accepts 1–50 strings. `provider: "auto"` selects the first configured rerank provider from the supported order.

### `/balance`

`GET` or `POST /balance` returns an account balance for the requested provider.

```bash
curl "$WORKER_URL/balance?provider=bocha"
```

```json
{ "provider": "bocha" }
```

Currently supported balance provider: `bocha`. Unsupported providers return `400` so future providers can be added without introducing provider-specific endpoints.

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
  "fetch_top": 2,
  "provider": "auto",
  "mode": "balanced",
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
ZHIPU_API_KEY=<secret>
BOCHA_API_KEY=<secret>
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
