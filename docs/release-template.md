# Release notes template

Use this template for every `0.1.x` release. Keep releases professional, user-oriented, and upgrade-focused.

```markdown
## Summary

One or two sentences describing what changed and why users should care.

Example: `v0.1.1` improves post-deploy update guidance, rate-limit setup documentation, and release note consistency for long-running Cloudflare deployments.

## Highlights

- User-visible change 1.
- User-visible change 2.
- User-visible change 3.

## Upgrade notes

For new users:

- Use the Deploy to Cloudflare button from the README.

For existing deployments:

1. Open your generated repository.
2. Go to Actions → Update from upstream.
3. Use `upstream_ref=main` for latest stable, or a `v0.1.x` tag for a pinned update.
4. Keep `preserve_wrangler=true` unless release notes explicitly say otherwise.
5. Review and merge the generated PR.
6. Smoke test `/health` and `/search` after Cloudflare deploys.

## Configuration changes

List all new, changed, or deprecated Cloudflare variables, secrets, bindings, and `wrangler.toml` snippets.

| Name | Kind | Status | Action required? |
|---|---|---|---|
| `EXAMPLE_VAR` | Variable | Added / Changed / Deprecated | Yes / No |

If there are no config changes, say:

> No configuration changes are required.

## Compatibility notes

State whether this release changes endpoint behavior, response shape, defaults, auth, rate limits, or provider behavior.

Recommended phrasing for patch releases:

- No breaking endpoint changes.
- No required `wrangler.toml` changes.
- Existing public/private deployments keep working.

## Security notes

Mention security-relevant changes, especially around:

- auth mode
- bearer tokens
- SSRF protection
- provider endpoint validation
- rate limiting
- secret handling

If none:

> No security-sensitive behavior changes.

## Verification

Before publishing, paste the real verification evidence:

- `npm run test:ci`
- root Wrangler dry-run deploy
- `deploy-template/` Wrangler dry-run deploy
- GitHub Actions CI on `main`
- Optional: manual Cloudflare Deploy button smoke test

## Known limitations

List anything users should know before upgrading.

Example:

- KV rate limiting is best-effort and not atomic under high burst concurrency.
- Public mode remains open to anyone with the Worker URL.
```

## Maintainer checklist

Before creating a release:

- [ ] `main` is green in CI.
- [ ] `CHANGELOG.md` has an Unreleased entry for user-visible changes.
- [ ] README/docs mention any new configuration.
- [ ] `deploy-template/` still dry-runs with Wrangler.
- [ ] Deploy button still points to `main/deploy-template`.
- [ ] Release notes include upgrade notes.
- [ ] Release notes explicitly say whether config changes are required.

Create the release:

```bash
git fetch origin main
git checkout main
git pull --ff-only origin main
npm run test:ci

git tag -a v0.1.x -m "v0.1.x"
git push origin v0.1.x
gh release create v0.1.x \
  --repo EitanWong/search-gateway \
  --title "v0.1.x" \
  --notes-file <release-notes-file.md>
```

After publishing:

```bash
gh release view v0.1.x --repo EitanWong/search-gateway
```
