# Release and update policy

`search-gateway` uses a trunk-stable release model: `main` is always the latest stable version.

There is no long-lived `release/*` branch. The Cloudflare Deploy button points at `main/deploy-template`, so anything merged to `main` must be safe for new one-click deployments.

## Branch model

| Branch | Purpose | Merge target | Rules |
|---|---|---|---|
| `main` | Latest stable version and one-click deploy source | — | Must pass CI. Must be deployable. No experimental work. |
| `dev` | Integration branch for grouped changes before stabilization | `main` | Optional. Use when several feature branches need combined testing. |
| `feat/<short-name>` | New capability or behavior | `dev` or `main` | Small, scoped, tested. Prefer PR. |
| `fix/<short-name>` | Bug fix | `main` | Must include regression test or explicit verification. |
| `docs/<short-name>` | Documentation-only update | `main` | Must not change runtime behavior. |
| `chore/<short-name>` | Tooling, CI, dependency, repo maintenance | `main` | Must keep deploy flow green. |
| `hotfix/<short-name>` | Urgent production/deploy breakage fix | `main` | Smallest safe patch. Verify and merge quickly. |

Recommended default:

```text
feat/* -> PR -> main
```

Use `dev` only when a change needs multi-branch integration before becoming stable.

## Definition of stable

A commit is stable enough for `main` only when all applicable gates pass:

```bash
npm run test:ci
```

This includes:

- JavaScript syntax checks.
- Worker behavior tests.
- Search-quality deterministic benchmark cases.
- Hermes plugin tests.
- Root Wrangler dry-run using `worker-config.toml`.
- `deploy-template/` dry-run using `deploy-template/wrangler.toml`.

For ranking changes, also inspect the ranking diff:

```bash
npm run ranking:diff
npm run test:search-quality
```

## Versioning

The source of truth for deployed users is `main`. `main` always points at the latest stable version and is the default upstream target for the user update workflow.

Current iteration line: `0.1.x`. Use patch releases (`v0.1.1`, `v0.1.2`, ...) for deploy-template lifecycle work, documentation polish, setup UX, provider/ranking fixes, and backwards-compatible hardening. Reserve `0.2.0` for a clear capability step-change or compatibility-impacting behavior change.

`package.json` and `deploy-template/package.json` carry a metadata version surfaced by `GET /health.version`. Bump them when user-visible runtime behavior, deploy flow, or configuration defaults change.

Git tags/releases are professional milestone records, not a separate release branch and not the primary deploy channel. They are useful for auditability, rollback references, and human-readable upgrade notes.

Recommended tag format:

```text
v0.1.0
v0.1.1
v0.1.2
```

Release notes should include:

- Summary: what changed and why it matters.
- Upgrade notes: whether users should run **Update from upstream**.
- Configuration changes: new/changed variables, secrets, KV bindings, or `wrangler.toml` snippets.
- Compatibility notes: any endpoint/response/default behavior changes.
- Verification: CI, dry-run deploy, or manual Cloudflare import checks.

Tagging does not change the deploy source: one-click deploy and default user updates still track `main/deploy-template`. Users who want conservative updates may run the updater workflow against a tag instead of `main`.

## Cloudflare deploy template contract

`deploy-template/` is the public template surface. Keep it minimal and stable:

```text
deploy-template/
  package.json
  package-lock.json
  wrangler.toml
  src/index.js
```

Rules:

1. The Deploy button must point to `https://github.com/EitanWong/search-gateway/tree/main/deploy-template`.
2. `deploy-template/wrangler.toml` must stay importer-friendly and account-agnostic.
3. Root development config must not be named `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc`; use `worker-config.toml`.
4. Do not add mandatory deploy-time secrets to the template.
5. Default mode remains `SEARCH_GATEWAY_MODE=public` so one-click deployment works immediately.

## User repository update policy

Cloudflare creates a new repository from the template instead of a GitHub fork. User deployments do not automatically receive upstream changes.

Recommended update flow for user repositories:

```text
Run "Update from upstream" workflow
-> default: copy upstream main/deploy-template
-> optional: use a specific v* tag for conservative updates
-> open PR in the user's repo
-> user reviews and merges
-> Cloudflare auto-deploys the user's production branch
```

Do not auto-push upstream changes directly to a user's production branch.

### Files safe to sync automatically

| File | Policy |
|---|---|
| `src/index.js` | Sync from upstream. Core Worker implementation. |
| `package-lock.json` | Sync from upstream when dependencies change. |
| `README.md` | Sync or replace if the user did not heavily customize docs. |
| `LICENSE`, `NOTICE`, `SECURITY.md` | Sync from upstream. |

### Files requiring care

| File | Policy |
|---|---|
| `package.json` | Sync scripts/dependencies, but preserve user repo `name` when possible. |
| `wrangler.toml` | Do not blindly overwrite. Preserve Worker name, vars, routes, and user bindings. |
| `.dev.vars`, `.env`, Cloudflare secrets | Never sync or commit. |

When upstream requires a `wrangler.toml` change, document it in `CHANGELOG.md` and in the update PR body.

## Breaking changes

Breaking changes are allowed only when they are clearly justified and documented.

A breaking change includes:

- Removing or renaming an endpoint.
- Changing default auth mode.
- Requiring a new mandatory Cloudflare binding or secret.
- Changing response fields that clients rely on.
- Changing provider behavior in a way that disables no-key search by default.

Breaking changes require:

1. `CHANGELOG.md` entry with migration notes.
2. README / docs update.
3. Test coverage or explicit verification.
4. If `wrangler.toml` changes are required, a copy-paste migration snippet.

## Security fixes

Security fixes should use `hotfix/<short-name>` and merge to `main` as quickly as safely possible.

Security-sensitive areas:

- SSRF protection.
- URL validation and redirect handling.
- Secret handling and auth mode.
- Provider endpoint configuration.
- Rate limiting and abuse controls.

After merging a security fix:

1. Add a short `CHANGELOG.md` note unless disclosure must be delayed.
2. If users should update quickly, pin that in README or GitHub Release notes.
3. Prefer a user-update PR workflow over silent auto-updates.

## Maintainer release checklist

Before merging to `main`:

- [ ] Branch name is scoped (`feat/*`, `fix/*`, `docs/*`, `chore/*`, `hotfix/*`).
- [ ] `npm run test:ci` passes locally or in CI.
- [ ] `deploy-template/` still contains exactly one Cloudflare config: `deploy-template/wrangler.toml`.
- [ ] Deploy button still points to `main/deploy-template`.
- [ ] No secrets, `.dev.vars`, `.env`, `.wrangler/`, or `dist/` are committed.
- [ ] `CHANGELOG.md` documents user-visible behavior changes.
- [ ] Docs list any new Cloudflare variables, secrets, bindings, or provider keys.

After merging to `main`:

- [ ] Confirm GitHub Actions CI is green.
- [ ] Confirm remote `deploy-template/wrangler.toml` has the expected public defaults.
- [ ] For deploy-flow changes, test Cloudflare Deploy to Workers manually.
