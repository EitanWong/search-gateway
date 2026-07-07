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

## Automatic GitHub deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`. It deploys automatically on push to `main` or `master` after these GitHub repository secrets are configured:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`SEARCH_GATEWAY_TOKEN` and provider keys must still be configured as Cloudflare Worker secrets.

Do not commit `.dev.vars`, `.env`, `.wrangler/`, `dist/`, or release-loop state.
