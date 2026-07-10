# Your search-gateway Worker

Your Cloudflare search/fetch gateway is deployed from this repository.

## Start here

1. Check this repository's `wrangler.toml` to see whether it uses public or private mode.
2. Open your Worker URL in a browser and check the setup page at `/`.
3. Run the smoke test below from the same network that will call the Worker.
4. Configure GitHub Actions deployment only if you want default-branch pushes to publish automatically.
5. Run **Update from upstream** later to receive upstream fixes.

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

## Access mode

A fresh template defaults to public mode so first deploy works immediately. Anyone with the Worker URL can call it. If your local `wrangler.toml` already says `SEARCH_GATEWAY_MODE=private`, skip directly to the bearer-authenticated command below.

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

## GitHub Actions deployment

The generated repository includes two independent workflows:

- **CI** validates pull requests and default-branch pushes with `npm ci`, `npm run build`, and `npm run dry-run`.
- **Deploy to Cloudflare Workers** publishes only from the default branch, and only after you opt in.

To enable automatic deployment, configure these GitHub Actions repository settings:

| Setting | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | A dedicated least-privilege token allowed to deploy Worker scripts in your Cloudflare account. |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Your Cloudflare account ID. |
| `CLOUDFLARE_AUTO_DEPLOY` | Variable | `true` |

Runtime secrets such as `SEARCH_GATEWAY_TOKEN`, `ZHIPU_API_KEY`, and `BOCHA_API_KEY` stay in Cloudflare Workers secrets. Do not copy them to GitHub.

Leave `CLOUDFLARE_AUTO_DEPLOY` unset to keep deployment manual; run **Deploy to Cloudflare Workers** from Actions when you want to publish.

### If Cloudflare import omitted `.github/workflows`

Some Cloudflare import flows create the Worker repository without hidden `.github/` files. Check the generated repository after its first deploy. If `.github/workflows/ci.yml` is missing, clone the generated repository and run:

```bash
npm run bootstrap:github-actions
git add .github/workflows
git commit -m "chore: enable search-gateway automation"
git push
```

The bootstrap script resolves the fixed official upstream to a commit SHA, creates only missing workflows, and refuses to overwrite existing workflow files unless you explicitly pass `--force`.

## Connect Hermes Agent

The upstream repository ships a dependency-free Hermes plugin. Follow the [Hermes integration guide](https://github.com/EitanWong/search-gateway/tree/main/integrations/hermes) to install it into a profile and configure `SEARCH_GATEWAY_URL` plus the private bearer token when required.

Hermes fixes its tool schema when a session starts. After enabling or changing the plugin, open a new session or run `/reset`; the new session exposes `search_web`, `fetch_url`, `batch_fetch_urls`, and `search_and_fetch`.

## Updating from upstream

Use this when the upstream template gets fixes or improvements.

This repository includes a weekly upstream check. When upstream changes, it opens a pull request instead of pushing directly to your production branch.

```text
GitHub → this repository → Actions → Update from upstream → Run workflow
```

Recommended inputs:

| Input | Value |
|---|---|
| `upstream_ref` | `main` |
| `preserve_wrangler` | `true` |

The workflow resolves `upstream_ref` to a concrete commit SHA, copies template files without running upstream Node dependencies or scripts, then opens a PR. The generated repository CI validates that PR with:

```bash
npm ci
npm run build
npm run dry-run
```

The PR body lists changed files and the validation commands. The generated repo also runs CI on pull requests, so wait for the green check and review the PR. After merge, it publishes automatically only when `CLOUDFLARE_AUTO_DEPLOY=true`; otherwise run the manual deploy workflow.

Use a tag such as `v0.1.0` instead of `main` only when you want a pinned update.

## Important files

| File | Purpose |
|---|---|
| `src/index.js` | Worker implementation |
| `wrangler.toml` | Your Worker name, variables, and bindings |
| `.github/workflows/update-from-upstream.yml` | Manual upstream update workflow |
| `.github/workflows/ci.yml` | Build and dry-run validation for PRs and pushes |
| `.github/workflows/deploy-cloudflare.yml` | Opt-in validated deployment from the default branch |
| `package.json` | Build/deploy scripts |

Do not commit `.dev.vars`, `.env`, API keys, or bearer tokens.
