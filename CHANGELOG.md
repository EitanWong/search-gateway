# Changelog

## Unreleased

- Add Firecrawl Search v2 as an optional paid provider with explicit `provider: "firecrawl"`, configured `auto` participation, bounded JSON parsing, endpoint SSRF guardrails, and synchronized agent/setup schemas.
- Add `docs/updating.md` with step-by-step generated-repo updater workflow guidance, expected GitHub UI states, PR review checks, and troubleshooting.
- Expand rate-limit documentation with Cloudflare Dashboard KV namespace and Worker binding setup steps.
- Add `docs/release-template.md` to standardize `0.1.x` release notes and upgrade guidance.
- Rewrite `deploy-template/README.md` as a concise post-deploy user homepage.
- Use the `deploy-template/` subdirectory as the Cloudflare one-click deployment target with a minimal `wrangler.toml`, build/deploy command prefills, default-public one-click auth mode, and optional private bearer-token hardening.
- Add `GET /` HTML setup page and include `version` plus endpoint metadata in `GET /health`.
- Add `deploy-template/.github/workflows/update-from-upstream.yml` so deployed user repositories can open PRs from upstream `main/deploy-template` while preserving local `wrangler.toml` by default.
- Rework README around Quick Deploy, Smoke Test, Private Mode, Updating, configuration variables, and trunk-stable release strategy.
- Add Agent-oriented `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` behavior.
- Add machine-readable errors and suggested recovery actions.
- Add multilingual ranking signals, source credibility, freshness, domain diversity, and bounded provider consensus scoring.
- Add deterministic search-quality benchmark and ranking diff reporter.
- Add CI, open-source contribution/security materials, and multilingual documentation entrypoints.
- Switch open-source license to Apache-2.0 with NOTICE.
- Add Cloudflare deployment workflow and one-click deployment documentation.
- Publish the Hermes integration under `integrations/hermes/`.
