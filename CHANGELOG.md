# Changelog

## Unreleased

- Replace the Cloudflare one-click path with true zero-config deployment: isolated `deploy-template/` subdirectory, strict `wrangler.json`, Cloudflare template metadata, build/deploy command prefills, open-by-default auth mode, and optional bearer-token hardening.
- Add Agent-oriented `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` behavior.
- Add machine-readable errors and suggested recovery actions.
- Add multilingual ranking signals, source credibility, freshness, domain diversity, and bounded provider consensus scoring.
- Add deterministic search-quality benchmark and ranking diff reporter.
- Add CI, open-source contribution/security materials, and multilingual documentation entrypoints.
- Switch open-source license to Apache-2.0 with NOTICE.
- Add Cloudflare deployment workflow and one-click deployment documentation.
- Publish the Hermes integration under `integrations/hermes/`.
