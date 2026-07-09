# Your search-gateway Worker

Your Cloudflare search/fetch gateway is deployed from this repository.

## Start here

1. Open your Worker URL in a browser.
2. Check the setup page at `/`.
3. Run the smoke test below.
4. Optional: switch to private mode.
5. Optional: run **Update from upstream** later to receive upstream fixes.

## Smoke test

Replace `WORKER_URL` with your deployed Worker URL:

```bash
export WORKER_URL="https://search-gateway.<your-subdomain>.workers.dev"

curl -s "$WORKER_URL/health"

curl -s "$WORKER_URL/search" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

If this works, your gateway is ready.

## Make it private

The template defaults to public mode so first deploy works immediately. Anyone with the Worker URL can call it.

For long-running personal use, set these in Cloudflare Dashboard → Worker → Settings → Variables and Secrets.

Variable:

```env
SEARCH_GATEWAY_MODE=private
```

Secret:

```env
SEARCH_GATEWAY_TOKEN=<random-secret>
```

Then call endpoints with bearer auth:

```bash
curl -s "$WORKER_URL/search" \
  -H "authorization: Bearer ***" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

## Add better search providers

No provider key is required by default; the Worker falls back to DuckDuckGo/Bing HTML search.

For higher quality, add one or more provider secrets in Cloudflare:

| Secret | Purpose |
|---|---|
| `ZHIPU_API_KEY` | Zhipu AI Web Search API |
| `BOCHA_API_KEY` | Bocha Web Search / AI Search API |
| `COHERE_API_KEY` | Optional Cohere rerank provider |
| `JINA_API_KEY` | Optional Jina AI rerank provider |
| `VOYAGE_API_KEY` | Optional Voyage AI rerank provider |
| `SILICONFLOW_API_KEY` | Optional SiliconFlow rerank provider |
| `BRAVE_SEARCH_API_KEY` | Brave Search API |
| `SERPER_API_KEY` | Google-style Serper API |
| `TAVILY_API_KEY` | Tavily Search API |

For self-hosted SearXNG:

| Variable / Secret | Purpose |
|---|---|
| `SEARXNG_URL` | SearXNG base URL with JSON enabled |
| `SEARXNG_SECRET` | Optional bearer token for private SearXNG |

## Optional rate limiting

To enable basic per-IP/per-endpoint rate limiting:

1. Create a Cloudflare KV namespace.
2. Bind it to this Worker as `SEARCH_RATE_LIMIT_KV`.
3. Set `SEARCH_RATE_LIMIT_PER_MINUTE`, for example `60`.

KV rate limiting is best-effort. For serious public exposure, also use Cloudflare dashboard rate limiting or WAF rules.

If you use Bocha on a public Worker, check the upstream account tier. Tier 0 is limited to `1 QPS`, `30 QPM`, and `1000 QPD`; configure `SEARCH_RATE_LIMIT_PER_MINUTE` accordingly. See `docs/bocha-pricing.md` in the full repository for pricing and quota planning.

If any rerank provider is configured, `/search` can use second-stage reranking automatically. Disable it per request with `"rerank": false`, or use `POST /rerank` directly with up to 50 candidate documents.

## Updating from upstream

Use this when the upstream template gets fixes or improvements.

```text
GitHub → this repository → Actions → Update from upstream → Run workflow
```

Recommended inputs:

| Input | Value |
|---|---|
| `upstream_repository` | `EitanWong/search-gateway` |
| `upstream_ref` | `main` |
| `preserve_wrangler` | `true` |

The workflow opens a PR. Review it, merge it, and Cloudflare should deploy the merged update.

Use a tag such as `v0.1.0` instead of `main` only when you want a pinned update.

## Important files

| File | Purpose |
|---|---|
| `src/index.js` | Worker implementation |
| `wrangler.toml` | Your Worker name, variables, and bindings |
| `.github/workflows/update-from-upstream.yml` | Manual upstream update workflow |
| `package.json` | Build/deploy scripts |

Do not commit `.dev.vars`, `.env`, API keys, or bearer tokens.
