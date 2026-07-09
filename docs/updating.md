# Updating a deployed search-gateway Worker

This guide is for users who already deployed `search-gateway` through the Cloudflare Deploy button.

Cloudflare's template import creates **your own repository**, not a GitHub fork. That means your Worker will keep running, but it will not automatically receive upstream fixes unless you run the included updater workflow.

## Recommended update path

```text
GitHub Actions → Update from upstream → Run workflow
→ workflow validates the updated template
→ workflow opens an update PR
→ you review and merge
→ Cloudflare deploys from your repository
```

The workflow does **not** push directly to your production branch.

The workflow also runs weekly as a safety net. If upstream changed, it opens the same reviewable PR. If nothing changed, it exits with **Already up to date**.

## Before you start

You need:

- A repository created by the Cloudflare Deploy button.
- GitHub Actions enabled in that repository.
- Cloudflare connected to the repository so merges deploy automatically.

Optional but recommended:

- Know your Worker URL.
- Open your current `wrangler.toml` so you can confirm local settings are preserved.

## Step-by-step update

### 1. Open your generated repository

Go to the GitHub repository Cloudflare created for your deployment.

You should see files similar to:

```text
.github/workflows/update-from-upstream.yml
src/index.js
package.json
wrangler.toml
README.md
```

If `update-from-upstream.yml` is missing, your deployment was created before the updater workflow existed. Update once manually by copying the workflow from upstream `deploy-template/.github/workflows/update-from-upstream.yml`, or redeploy from the latest template.

### 2. Open the Actions tab

In GitHub, open:

```text
Repository → Actions → Update from upstream
```

Expected screen:

```text
Actions
└─ Update from upstream
   └─ Run workflow
```

### 3. Run the workflow

Click **Run workflow**.

Recommended inputs:

| Input | Recommended value | Why |
|---|---|---|
| `upstream_repository` | `EitanWong/search-gateway` | Official upstream repository. |
| `upstream_ref` | `main` | Latest stable source. Use a tag such as `v0.1.0` only for conservative pinned updates. |
| `preserve_wrangler` | `true` | Keeps your Worker name, routes, variables, and bindings. |

The safest default is:

```text
upstream_repository = EitanWong/search-gateway
upstream_ref = main
preserve_wrangler = true
```

You can also do nothing and let the weekly scheduled run check upstream automatically.

### 4. Wait for the workflow result

The workflow downloads upstream `deploy-template/`, copies template files into an update branch, validates the result, and opens a pull request. The pull request body includes a changed-files summary and the validation commands that already ran.

Validation before PR creation:

```bash
npm ci
npm run build
npm run dry-run
```

Expected result:

```text
chore: update search-gateway from upstream main
```

If the workflow says **Already up to date**, no action is needed.

### 5. Review the pull request

Review these files carefully:

| File | What to check |
|---|---|
| `src/index.js` | Worker implementation updates. Usually safe to accept. |
| `package.json` / `package-lock.json` | Dependency or script changes. Usually safe to accept. |
| `README.md` | Local instructions may be overwritten by upstream template docs. |
| `wrangler.toml` | Should be unchanged when `preserve_wrangler=true`. If changed, verify Worker name/routes/bindings before merging. |

The generated repository also includes a lightweight CI workflow for pull requests and pushes:

```bash
npm ci
npm run build
npm run dry-run
```

Wait for the green CI check before merging the update PR.

Never commit secrets such as `.dev.vars`, `.env`, provider API keys, or bearer tokens.

### 6. Merge and let Cloudflare deploy

After reviewing, merge the PR.

If your Cloudflare project is connected to GitHub, Cloudflare should deploy the merged commit automatically.

### 7. Smoke test after deploy

Replace `WORKER_URL` with your deployed Worker URL:

```bash
export WORKER_URL="https://search-gateway.<your-subdomain>.workers.dev"

curl -s "$WORKER_URL/health"

curl -s "$WORKER_URL/search" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

For private mode:

```bash
curl -s "$WORKER_URL/search" \
  -H "authorization: Bearer ***" \
  -H 'content-type: application/json' \
  -d '{"query":"Cloudflare Workers docs","limit":3}'
```

## Updating from a tag instead of main

`main` is the latest stable deploy source. Tags are milestone snapshots.

Use a tag when you want a conservative, repeatable update:

```text
upstream_ref = v0.1.0
```

Use `main` when you want the newest stable template:

```text
upstream_ref = main
```

## Troubleshooting

### The workflow is missing

Your generated repo may have been created from an older template. Copy this file from upstream:

```text
deploy-template/.github/workflows/update-from-upstream.yml
```

Commit it to your generated repo, then rerun Actions → Update from upstream.

### The workflow cannot open a PR

Check repository settings:

```text
Settings → Actions → General → Workflow permissions
```

Recommended:

```text
Read and write permissions
Allow GitHub Actions to create and approve pull requests
```

### The weekly update check is too noisy

Open `.github/workflows/update-from-upstream.yml` and remove the `schedule:` block. You can still run updates manually from the Actions tab.

### The workflow fails during validation

Open the failed Actions run and inspect the `Validate updated template` step. Common causes:

- A local `wrangler.toml` customization is invalid with the new Worker code.
- Your generated repository has local edits that conflict with upstream template assumptions.
- Upstream introduced a configuration migration; check upstream release notes before merging.

The update PR is intentionally not opened when validation fails, so broken template updates do not reach your production branch by accident.

### The update PR changes `wrangler.toml`

If you used `preserve_wrangler=false`, the upstream template may replace local Worker settings.

Before merging, check:

- `name`
- `routes`
- `workers_dev`
- `[vars]`
- `[[kv_namespaces]]`
- any custom bindings

For normal personal deployments, use `preserve_wrangler=true`.

### Cloudflare did not deploy after merge

Open Cloudflare Dashboard and check:

```text
Workers & Pages → your Worker → Deployments
```

If Git integration is disconnected, either reconnect it or deploy manually from your generated repository:

```bash
npm ci
npm run deploy
```

## Manual update fallback

If GitHub Actions is unavailable, you can update manually:

1. Download upstream `deploy-template/` from `EitanWong/search-gateway`.
2. Copy `src/index.js`, `package.json`, `package-lock.json`, and template docs into your repo.
3. Preserve your existing `wrangler.toml` unless upstream release notes explicitly require a config change.
4. Commit, push, and let Cloudflare deploy.

Prefer the workflow when possible; it is safer and easier to review.
