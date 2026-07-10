import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const scriptPath = join(repoRoot, 'scripts', 'agent-setup.mjs');

function run(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

const help = await run(['--help']);
assert.equal(help.status, 0);
assert.match(help.stdout, /--worker-name/);
assert.match(help.stdout, /--mode public\|private/);

const tmp = await mkdtemp(join(tmpdir(), 'search-gateway-setup-'));
try {
  const configHome = join(tmp, 'xdg');
  const env = {
    XDG_CONFIG_HOME: configHome,
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ACCOUNT_ID: 'cf-account',
    SEARCH_GATEWAY_TOKEN: 'gateway-token',
    BRAVE_SEARCH_API_KEY: 'brave-secret',
  };
  const dryRun = await run([
    '--worker-name', 'sg-test',
    '--mode', 'private',
    '--agent', 'both',
    '--provider', 'brave,duckduckgo',
    '--dry-run',
  ], env);

  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /Dry run plan/);
  assert.match(dryRun.stdout, /sg-test/);
  assert.match(dryRun.stdout, /SEARCH_GATEWAY_MODE:private/);
  assert.match(dryRun.stdout, /codex mcp add/);
  assert.match(dryRun.stdout, /claude mcp add -s user/);
  assert.doesNotMatch(dryRun.stdout + dryRun.stderr, /gateway-token|brave-secret|cf-token/);
  assert.equal(existsSync(join(configHome, 'search-gateway', 'config.json')), false);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
