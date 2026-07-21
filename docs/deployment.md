# Deployment

For zero-config import, see [One-click Cloudflare deployment](cloudflare-one-click.md).

## Prerequisites for manual deployment

- Node.js 22+
- Cloudflare account
- Wrangler authentication

## One-click public default

The Worker can deploy without any secrets or provider keys:

```bash
npm ci
npm run build
npm run deploy
```

By default, `SEARCH_GATEWAY_MODE=public`, so `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` work immediately after deployment. Search works without paid provider keys through DuckDuckGo/Bing HTML fallbacks where reachable.

## Optional private mode

For long-running personal deployments, configure bearer auth after deployment:

```bash
# In Cloudflare Dashboard → Worker → Settings → Variables:
# set SEARCH_GATEWAY_MODE=private
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

Authenticated requests then require:

```http
Authorization: Bearer <your-token>
```

## Optional provider secrets

```bash
npx wrangler secret put SEARXNG_URL
npx wrangler secret put ZHIPU_API_KEY
npx wrangler secret put BOCHA_API_KEY
npx wrangler secret put COHERE_API_KEY
npx wrangler secret put JINA_API_KEY
npx wrangler secret put VOYAGE_API_KEY
npx wrangler secret put SILICONFLOW_API_KEY
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
```

## Dry run

```bash
npm run dry-run
```

## Cloudflare configuration

The `deploy-template/` subdirectory is the Cloudflare Dashboard one-click import target. `deploy-template/wrangler.toml` is intentionally minimal so Dashboard import has exactly one deployable Worker config. The repository root is kept for development, tests, docs, and integrations.

Default values:

- Worker name: `search-gateway`
- Entrypoint: `src/index.js`
- Workers.dev enabled: `true`
- Default vars: `SEARCH_GATEWAY_MODE=public`, `BING_MARKET=en-US`, `DUCKDUCKGO_LANGUAGE=en-US`

One-click template URL:

```text
https://github.com/EitanWong/search-gateway/tree/main/deploy-template
```

## GitHub deployment workflow

The upstream repository keeps its maintainer deployment workflow manual. Generated deployment repositories include a separate workflow that always validates pull requests and can deploy the default branch only after explicit opt-in.

Configure these GitHub repository settings in the generated repository:

| Setting | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Actions secret | A dedicated least-privilege Cloudflare token with permission to edit this account's Worker scripts. |
| `CLOUDFLARE_ACCOUNT_ID` | Actions variable | Your Cloudflare account ID. |
| `CLOUDFLARE_AUTO_DEPLOY` | Actions variable | Set to `true` to deploy validated changes on the default branch. Leave unset for manual-only deployment. |

The deploy workflow runs `npm ci`, `npm run build`, and `npm run dry-run` before `npm run deploy`. It never receives runtime bearer or provider secrets.

If Cloudflare's import flow created the deployment repository without `.github/workflows`, run `npm run bootstrap:github-actions` in a clone of that generated repository, review the generated workflows, and commit them. The bootstrap script is part of the non-hidden deployment template specifically for this importer behavior.

Worker runtime secrets such as `SEARCH_GATEWAY_TOKEN` and provider keys are optional and configured on the Cloudflare Worker. Use `SEARCH_GATEWAY_TOKEN` when `SEARCH_GATEWAY_MODE=private`.

Do not commit `.dev.vars`, `.env`, `.wrangler/`, `dist/`, or release-loop state.
