# search-gateway

A public-by-default one-click Cloudflare search/fetch gateway template for AI agents, with private hardening and an upstream-update workflow for long-running personal deployments.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway/tree/main/deploy-template)

`main` is always the latest stable version. The Cloudflare button imports only `deploy-template/`, keeping the public template small and reliable.

## Quick Deploy

1. Click **Deploy to Cloudflare**.
2. Let Cloudflare create/import the repository from `deploy-template/`.
3. Deploy with the template defaults:

| Setting | Default |
|---|---|
| Worker config | `wrangler.toml` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Auth mode | `SEARCH_GATEWAY_MODE=public` |
| Search fallback | DuckDuckGo HTML → Bing HTML |

No provider key or secret is required for the first deploy.

## Agent-native deployment: Codex and Claude Code

Search Gateway can deploy itself through a guided agent workflow and then install a local, read-only stdio MCP for Codex CLI, Claude Code, or both. The MCP exposes `search_web`, `fetch_url`, `batch_fetch_urls`, and `search_and_fetch`; it does **not** expose Cloudflare deployment or secret-writing tools.

Give a coding agent this single GitHub instruction:

```text
Read and follow https://github.com/EitanWong/search-gateway/blob/main/integrations/agent-onboarding/SKILL.md . Guide me one step at a time, deploy Search Gateway to my Cloudflare account, then configure this coding agent to use it via MCP. Never commit, print, or pass my credentials as command-line arguments.
```

The agent will first ask which client(s) and access mode you want, then separately request a least-privilege Cloudflare API token/account ID, and finally offer optional provider setup. It runs `scripts/agent-setup.mjs --dry-run` before changing Cloudflare, stores endpoint/token only in a local mode-0600 configuration file, and checks `/health` before installing the MCP.

Full agent instructions: [integrations/agent-onboarding/SKILL.md](integrations/agent-onboarding/SKILL.md).

## Smoke Test

After deploy, open the Worker URL in a browser. `/` returns a compact setup page.

```bash
export WORKER_URL="https://search-gateway.<your-subdomain>.workers.dev"

curl -s "$WORKER_URL/health"

curl -s "$WORKER_URL/search" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

`GET /health` includes `service`, `version`, `auth_mode`, endpoint names, capabilities, and setup status.

## Private Mode

Public mode is convenient for demos. For long-running personal use, switch to private mode in Cloudflare Dashboard → Worker → Settings → Variables and Secrets.

Variables:

```env
SEARCH_GATEWAY_MODE=private
```

Secrets:

```env
SEARCH_GATEWAY_TOKEN=<random-secret>
```

Generate a token locally if you want:

```bash
openssl rand -hex 32
```

Then call protected endpoints with bearer auth:

```bash
curl -s "$WORKER_URL/search" \
  -H "authorization: Bearer <token>" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

## Updating Your Deployment

Cloudflare template import creates your own repository; it is not a normal GitHub fork. To keep it updated:

1. In your deployed repo, open GitHub Actions.
2. Run **Update from upstream**.
3. The workflow pulls upstream `main/deploy-template`, opens a PR, and preserves your `wrangler.toml` by default.
4. Review release notes and merge the PR.
5. Deploy through the mechanism configured by your generated repository: Cloudflare Git integration, or the opt-in GitHub Actions workflow.

The default upstream is `EitanWong/search-gateway@main`. Advanced users can run the workflow against a tag or commit.

Full guide: [docs/updating.md](docs/updating.md).

## Configuration Reference

Configure non-sensitive options as Cloudflare Variables and sensitive values as Cloudflare Secrets.

| Name | Kind | Default | Values / Example | Purpose |
|---|---|---|---|---|
| `SEARCH_GATEWAY_MODE` | Variable | `public` | `public`, `private` | Main access mode. Aliases: `open`, `bearer`, `secure`. |
| `SEARCH_GATEWAY_TOKEN` | Secret | unset | random string | Required only in private mode. |
| `SEARCH_GATEWAY_ALLOW_OPEN` | Variable | unset | `true` | Legacy explicit public-mode opt-in; prefer `SEARCH_GATEWAY_MODE=public`. |
| `SEARXNG_URL` | Variable or Secret | unset | `https://searx.example.com` | Optional SearXNG JSON API base URL. |
| `SEARXNG_SECRET` | Secret | unset | bearer token | Optional token for private SearXNG. |
| `SEARXNG_CATEGORIES` | Variable | `general` | `general` | SearXNG categories. |
| `SEARXNG_LANGUAGE` | Variable | request language / `auto` | `auto`, `en`, `zh-CN` | SearXNG language hint. |
| `SEARXNG_SAFESEARCH` | Variable | `0` | `0`, `1`, `2` | SearXNG safesearch setting. |
| `ZHIPU_API_KEY` | Secret | unset | API key | Optional Zhipu AI Web Search provider. Supports SDK-style `id.secret` keys. |
| `ZHIPU_SEARCH_ENGINE` | Variable | `search_pro` | `search_pro`, `search_pro_sogou`, `search_pro_quark` | Zhipu search engine. |
| `ZHIPU_CONTENT_SIZE` | Variable | `medium` | `medium`, `high` | Zhipu result content size. |
| `ZHIPU_SEARCH_DOMAIN_FILTER` | Variable | unset | `example.com` | Optional Zhipu domain filter. |
| `BOCHA_API_KEY` | Secret | unset | API key | Optional Bocha Web Search and Bocha AI Search providers. |
| `BOCHA_SUMMARY` | Variable | `false` | `true`, `false` | Whether Bocha should include long summaries. Matches Bocha's default `false`. |
| `BOCHA_INCLUDE` | Variable | unset | `qq.com|m.163.com` | Optional Bocha include domain filter; separate up to 100 root/subdomains with `|` or `,`. |
| `BOCHA_EXCLUDE` | Variable | unset | `qq.com|m.163.com` | Optional Bocha exclude domain filter; separate up to 100 root/subdomains with `|` or `,`. |
| `BOCHA_AI_ANSWER` | Variable | `false` | `true`, `false` | Whether `provider: "bocha_ai"` asks Bocha to generate answer/follow-up messages. `/search` still returns normalized webpage results only. |
| `BOCHA_RERANK_MODEL` | Variable | `gte-rerank` | `gte-rerank` | Default model for `/rerank`. Bocha semantic reranker CN/EN models may require invite access. |
| `COHERE_API_KEY` | Secret | unset | API key | Optional Cohere Rerank provider. |
| `COHERE_RERANK_MODEL` | Variable | `rerank-v3.5` | model id | Cohere rerank model. |
| `JINA_API_KEY` | Secret | unset | API key | Optional Jina AI Reranker provider. |
| `JINA_RERANK_MODEL` | Variable | `jina-reranker-v3` | model id | Jina rerank model. |
| `VOYAGE_API_KEY` | Secret | unset | API key | Optional Voyage AI Rerank provider. |
| `VOYAGE_RERANK_MODEL` | Variable | `rerank-2.5` | model id | Voyage rerank model. |
| `SILICONFLOW_API_KEY` | Secret | unset | API key | Optional SiliconFlow rerank provider. |
| `SILICONFLOW_RERANK_MODEL` | Variable | `BAAI/bge-reranker-v2-m3` | model id | SiliconFlow rerank model. |
| `BRAVE_SEARCH_API_KEY` | Secret | unset | API key | Optional Brave Search provider. |
| `SERPER_API_KEY` | Secret | unset | API key | Optional Serper provider. |
| `TAVILY_API_KEY` | Secret | unset | API key | Optional Tavily provider. |
| `DUCKDUCKGO_ENDPOINT` | Variable | `https://html.duckduckgo.com/html/` | URL | DuckDuckGo HTML endpoint override. Usually leave unchanged. |
| `DUCKDUCKGO_LANGUAGE` | Variable | `en-US` | locale | DuckDuckGo fallback language hint. |
| `BING_MARKET` | Variable | `en-US` | market | Bing fallback market. |
| `FETCH_CACHE_TTL_SECONDS` | Variable | `300` | `0`–`3600` | Default Worker Cache TTL for `/fetch`. |
| `SEARCH_RATE_LIMIT_KV` | KV binding | unset | KV namespace | Optional per-IP/path minute limiter. |
| `RATE_LIMIT_KV` | KV binding | unset | KV namespace | Backward-compatible KV limiter binding. |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Variable | `60` | positive integer | Limit used only when KV is bound. |
| `SEARCH_PROVIDER_TIMEOUT_MS` | Variable | `8000` | `1000`–`30000` | Per-provider search timeout. Prevents one slow provider from blocking the selected search mode. |
| `RERANK_PROVIDER_TIMEOUT_MS` | Variable | `6000` | `1000`–`30000` | Per-provider rerank timeout. Prevents slow rerank providers from blocking results. |

Full reference: [docs/configuration.md](docs/configuration.md).

## Endpoints

| Endpoint | Method | Purpose | Auth |
|---|---:|---|---|
| `/` | `GET` | Human setup page | Public |
| `/health` | `GET` | Version, capabilities, setup status | Public; config details shown when safe/authenticated |
| `/search` | `POST` | Search using provider fallback or aggregation | Public by default; bearer in private mode |
| `/fetch` | `POST` | Fetch and extract readable page text/metadata | Public by default; bearer in private mode |
| `/rerank` | `POST` | Rerank up to 50 documents with Bocha Semantic Reranker | Public by default; bearer in private mode |
| `/balance` | `GET` or `POST` | Query a provider account balance | Public by default; bearer in private mode |
| `/batch_fetch` | `POST` | Fetch up to 10 URLs in one call | Public by default; bearer in private mode |
| `/search_fetch` | `POST` | Search, then fetch top results in one call | Public by default; bearer in private mode |

### `/search`

```json
{
  "query": "Hermes Agent toolsets",
  "limit": 8,
  "provider": "auto",
  "mode": "balanced",
  "freshness": "none",
  "language": "auto"
}
```

Providers: `auto`, `searxng`, `zhipu`, `bocha`, `bocha_ai`, `brave`, `serper`, `tavily`, `duckduckgo`, `bing`.

`bocha` uses Bocha Web Search (`/v1/web-search`) for Bing-compatible web results. `bocha_ai` uses Bocha AI Search (`/v1/ai-search`) and extracts `source/webpage` messages into the same normalized result schema; modal cards, generated answers, and follow-up questions are intentionally ignored by `/search` for compatibility. For cost safety, `provider: "auto"` does not include `bocha_ai` unless `mode: "thorough"`; request `provider: "bocha_ai"` explicitly when you want AI Search.

Bocha pricing and quota planning notes are in [docs/bocha-pricing.md](docs/bocha-pricing.md). In particular, Tier 0 accounts are limited to `1 QPS`, `30 QPM`, and `1000 QPD`; use `SEARCH_RATE_LIMIT_PER_MINUTE` and Cloudflare rate limiting for public deployments.

Rerank is a second-stage ranking layer for `/search`. To keep the default `balanced` mode cost-safe, implicit rerank only happens in `mode: "thorough"`; use `"rerank": "auto"` or a comma-separated provider list to enable it per request. When rerank is enabled, the gateway expands the first-stage candidate pool to `min(20, limit * 3)`, calls configured rerank providers, and blends rerank scores with the base credibility/relevance score so tiny rerank differences do not bury much stronger trusted results.

Supported rerank providers: `bocha_rerank`, `cohere_rerank`, `jina_rerank`, `voyage_rerank`, `siliconflow_rerank`. DashScope/Qwen3 Rerank and VikingDB are tracked as future adapters pending verified standalone HTTP request/response shape.

Search modes:

- `fast` — lowest latency/cost. Sequential fallback, no implicit rerank.
- `balanced` — default. Parallel first wave of up to 3 configured providers, then merge/dedupe/rank.
- `thorough` — highest recall. Parallel aggregate across configured providers, then rerank when configured.

Freshness: `none`, `auto`, `day`, `week`, `month`, `year`.

Language: `auto`, `zh-CN`, `en-US`, or provider-supported locale/market.

### `/rerank`

```json
{
  "query": "阿里巴巴2024年的ESG报告",
  "documents": ["候选文档1", "候选文档2"],
  "top_n": 2,
  "provider": "auto",
  "model": "gte-rerank",
  "return_documents": false
}
```

Uses the configured rerank provider. `documents` accepts 1–50 strings. Returned `results[]` preserve each item's original `index` and `relevance_score`. `provider: "auto"` picks the first configured provider from the supported provider order; set `provider` explicitly for deterministic vendor choice.

### `/balance`

Pass `provider=bocha` as a query parameter for `GET` or as JSON for `POST`:

```bash
curl https://<worker>/balance?provider=bocha \
  -H "Authorization: Bearer <SEARC...KEN>"

curl https://<worker>/balance \
  -H "Authorization: Bearer <SEARC...KEN>" \
  -H "content-type: application/json" \
  -d '{"provider":"bocha"}'
```

Currently supported balance provider: `bocha`. It uses Bocha's balance API (`https://api.bocha.cn/v1/fund/remaining`) with `BOCHA_API_KEY` and returns `remaining` in CNY yuan, plus the provider timestamp and `checked_at`.

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

Modes: `full`, `text`, `metadata`, `chunks`.

Guardrails: private/loopback URLs are blocked, JSON body and URL/query lengths are capped, text-like content types are allowed, binary/PDF responses return structured errors, and redirects are rechecked.

### `/batch_fetch`

```json
{
  "requests": [
    { "url": "https://example.com/a", "mode": "metadata" },
    { "url": "https://example.com/b", "mode": "chunks" }
  ]
}
```

### `/search_fetch`

```json
{
  "query": "agent native web research",
  "limit": 8,
  "fetch_top": 2,
  "provider": "auto",
  "mode": "balanced",
  "freshness": "auto",
  "language": "auto",
  "fetch_mode": "chunks"
}
```

## Hermes Integration

Set the Hermes profile environment:

```env
SEARCH_GATEWAY_URL=https://search-gateway.<your-subdomain>.workers.dev
# Optional: only needed if your Worker uses SEARCH_GATEWAY_MODE=private
SEARCH_GATEWAY_TOKEN=<your-worker-secret>
```

Then restart Hermes / gateway. The plugin exposes `search_web`, `fetch_url`, `batch_fetch_urls`, and `search_and_fetch`.

See [integrations/hermes/README.md](integrations/hermes/README.md).

## Release Strategy

- `main` = latest stable version and one-click deploy source.
- Current iteration line is `0.1.x`; use patch releases for backwards-compatible UX, deployment, docs, and hardening work.
- No long-lived `release/*` branch.
- Use scoped feature/dev branches: `feat/*`, `fix/*`, `docs/*`, `chore/*`, `hotfix/*`, optional `dev` for integration.
- Tags/releases are milestone snapshots and release-note carriers, not the primary deploy channel.
- User update workflow defaults to upstream `main` and opens a PR instead of directly changing production.

Full policy: [docs/release-management.md](docs/release-management.md).

## Local Development

```bash
npm ci
npm test
npm run test:search-quality
npm run dry-run
npm run test:deploy-template
```

Full CI gate:

```bash
npm run test:ci
```

Optional live smoke test:

```bash
npm run test:live
```

## Documentation

- [One-click Cloudflare deployment](docs/cloudflare-one-click.md)
- [Configuration reference](docs/configuration.md)
- [Deployment](docs/deployment.md)
- [Updating deployed Workers](docs/updating.md)
- [Release and update policy](docs/release-management.md)
- [Release notes template](docs/release-template.md)
- [Hermes integration](integrations/hermes/README.md)
- [Testing and ranking workflow](docs/testing.md)
- [International documentation](docs/i18n/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Security Notes

- Default public mode is intentionally frictionless: anyone with the Worker URL can call the gateway.
- Use private mode for long-running personal deployments.
- Keep API keys and bearer tokens as Cloudflare Secrets.
- Do not commit `.dev.vars`, `.env`, or real secrets.
- Optional KV rate limiting is best-effort and not atomic under high burst concurrency; combine it with Cloudflare dashboard rules for serious public exposure.
- Prefer official search APIs or self-hosted SearXNG for quality; DuckDuckGo/Bing HTML are no-key fallbacks.
- For Bocha provider costs, resource packages, and QPS/QPM/QPD tiers, see [docs/bocha-pricing.md](docs/bocha-pricing.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
