import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const template = join(root, "deploy-template");

async function read(relativePath) {
  return readFile(join(template, relativePath), "utf8");
}

const [packageJson, gitignore, ci, deploy, update, bootstrap] = await Promise.all([
  read("package.json"),
  read(".gitignore"),
  read(".github/workflows/ci.yml"),
  read(".github/workflows/deploy-cloudflare.yml"),
  read(".github/workflows/update-from-upstream.yml"),
  read("scripts/bootstrap-github-actions.mjs"),
]);

const pkg = JSON.parse(packageJson);
assert.equal(pkg.scripts.build, "node --check src/index.js && node --check scripts/bootstrap-github-actions.mjs");
assert.equal(pkg.scripts["bootstrap:github-actions"], "node scripts/bootstrap-github-actions.mjs");
assert.equal(pkg.scripts["dry-run"], "wrangler deploy --dry-run --outdir dist");

for (const ignoredPath of ["node_modules/", "dist/", ".wrangler/", ".dev.vars", ".env"]) {
  assert.match(gitignore, new RegExp(`^${ignoredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
}

assert.match(ci, /npm run build/);
assert.match(ci, /npm run dry-run/);
assert.match(deploy, /CLOUDFLARE_AUTO_DEPLOY/);
assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(deploy, /CLOUDFLARE_API_TOKEN/);
assert.match(deploy, /npm run build && npm run dry-run/);
assert.match(update, /PRESERVE_WRANGLER/);
assert.match(update, /LOCAL_PACKAGE_NAME/);
assert.match(update, /persist-credentials: false/);
assert.match(update, /UPSTREAM_SHA/);
assert.doesNotMatch(update, /- name: Validate updated template/);
assert.match(bootstrap, /EitanWong\/search-gateway/);
assert.match(bootstrap, /resolve\("\.github\/workflows"\)/);
assert.match(bootstrap, /--force/);

console.log("ok");
