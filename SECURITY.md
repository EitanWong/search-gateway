# Security Policy

## Supported versions

The `main`/`master` branch receives security fixes until versioned releases are introduced.

## Reporting vulnerabilities

Please report security issues privately to the repository owner instead of opening a public issue. If no private security advisory channel is available yet, contact the maintainer through GitHub profile contact information.

## Secrets and deployment

Do not commit real credentials. Use Cloudflare Worker secrets for:

- `SEARCH_GATEWAY_TOKEN`
- `SEARXNG_URL` if private
- `ZHIPU_API_KEY`
- `BOCHA_API_KEY`
- `COHERE_API_KEY`
- `JINA_API_KEY`
- `VOYAGE_API_KEY`
- `SILICONFLOW_API_KEY`
- `BRAVE_SEARCH_API_KEY`
- `SERPER_API_KEY`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`

Local `.dev.vars`, `.env`, `.wrangler/`, `dist/`, and `.release-loop/` are ignored.

## Trust boundaries

All external URLs and provider responses are untrusted. The Worker blocks private/internal URLs before fetch and after redirects to reduce SSRF risk.
