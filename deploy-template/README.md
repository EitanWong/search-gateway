# search-gateway Worker

This repository was created from the upstream `search-gateway` Cloudflare deploy template.

## Smoke test

Replace `WORKER_URL` with your deployed Worker URL:

```bash
export WORKER_URL="https://search-gateway.<your-subdomain>.workers.dev"

curl -s "$WORKER_URL/health"

curl -s "$WORKER_URL/search" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

Open `$WORKER_URL/` in a browser for a compact setup page.

## Private mode

Public mode is the template default so one-click deploy works immediately. For long-running personal use, switch to private mode in Cloudflare Dashboard → Worker → Settings → Variables and Secrets:

Variables:

```env
SEARCH_GATEWAY_MODE=private
```

Secrets:

```env
SEARCH_GATEWAY_TOKEN=<random-secret>
```

Then call protected endpoints with:

```bash
curl -s "$WORKER_URL/search" \
  -H "authorization: Bearer <token>" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

## Configuration

Common variables/secrets:

| Name | Kind | Default | Purpose |
|---|---|---|---|
| `SEARCH_GATEWAY_MODE` | Variable | `public` | `public` or `private`. |
| `SEARCH_GATEWAY_TOKEN` | Secret | unset | Required in private mode. |
| `SEARXNG_URL` | Variable/Secret | unset | Optional SearXNG JSON API base URL. |
| `SEARXNG_SECRET` | Secret | unset | Optional bearer token for private SearXNG. |
| `BRAVE_SEARCH_API_KEY` | Secret | unset | Optional Brave Search API key. |
| `SERPER_API_KEY` | Secret | unset | Optional Serper API key. |
| `TAVILY_API_KEY` | Secret | unset | Optional Tavily API key. |
| `DUCKDUCKGO_LANGUAGE` | Variable | `en-US` | DuckDuckGo fallback language hint. |
| `BING_MARKET` | Variable | `en-US` | Bing fallback market. |
| `FETCH_CACHE_TTL_SECONDS` | Variable | `300` | Worker Cache TTL for `/fetch`. |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Variable | `60` | Per-IP/path minute limit when KV is bound. |
| `SEARCH_RATE_LIMIT_KV` | KV binding | unset | Optional KV rate-limit binding. |

## Updating from upstream

Use GitHub Actions → **Update from upstream**. The workflow copies upstream `main/deploy-template` into a branch and opens a PR.

By default it preserves your local `wrangler.toml`, so Worker name, routes, variables, and bindings remain under your control.

Review upstream release notes before merging update PRs.
