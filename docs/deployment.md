# Deployment

For one-click import, see [One-click Cloudflare deployment](cloudflare-one-click.md).

## Prerequisites

- Node.js 22+
- Cloudflare account
- Wrangler authentication

## Configure secrets

```bash
npx wrangler secret put SEARCH_GATEWAY_TOKEN
# Optional providers
npx wrangler secret put SEARXNG_URL
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
```

## Dry run

```bash
npm run dry-run
```

## Deploy

```bash
npm run deploy
```

## GitHub deployment workflow

The repository includes `.github/workflows/deploy-cloudflare.yml` for manual deployment from GitHub Actions.
It is intentionally `workflow_dispatch`-only so fresh forks and public imports do not fail on every push before Cloudflare secrets are configured.

Before running it, configure these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`SEARCH_GATEWAY_TOKEN` and provider keys must still be configured as Cloudflare Worker secrets.

Do not commit `.dev.vars`, `.env`, `.wrangler/`, `dist/`, or release-loop state.
