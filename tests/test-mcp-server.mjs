import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const serverPath = join(repoRoot, 'integrations', 'mcp', 'server.mjs');

function startStub() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers["authorization"] ?? "",
      body: body ? JSON.parse(body) : null,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      path: req.url,
      received: body ? JSON.parse(body) : null,
      large: 'x'.repeat(700_000),
    }));
  });
  return new Promise((resolveStart) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({ server, requests, url: `http://127.0.0.1:${port}` });
    });
  });
}

function startMcp(env) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SEARCH_GATEWAY_URL: "",
      SEARCH_GATEWAY_TOKEN: "",
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index === -1) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) lines.push(JSON.parse(line));
    }
  });
  return {
    child,
    async request(method, params) {
      const id = lines.length + 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      for (;;) {
        const found = lines.find((line) => line.id === id);
        if (found) return found;
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async close() {
      child.stdin.end();
      child.kill();
      await once(child, 'exit').catch(() => {});
    },
  };
}

const tmp = await mkdtemp(join(tmpdir(), 'search-gateway-mcp-'));
const stub = await startStub();

try {
  const configPath = join(tmp, 'config.json');
  await writeFile(configPath, JSON.stringify({ url: stub.url, token: 'secret-token' }), { mode: 0o600 });
  const mcp = startMcp({ SEARCH_GATEWAY_CONFIG: configPath });
  try {
    const init = await mcp.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '0.0.0' },
      capabilities: {},
    });
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.equal(init.result.serverInfo.name, 'search-gateway');

    mcp.notify('notifications/initialized', {});

    const listed = await mcp.request('tools/list', {});
    const tools = listed.result.tools;
    assert.deepEqual(tools.map((tool) => tool.name), [
      'search_web',
      'fetch_url',
      'batch_fetch_urls',
      'search_and_fetch',
    ]);
    assert.equal(tools.find((tool) => tool.name === 'search_web').inputSchema.properties.limit.description, 'Max results, default 8, max 20.');
    assert.equal(tools.find((tool) => tool.name === 'fetch_url').inputSchema.properties.mode.enum.includes('chunks'), true);

    const called = await mcp.request('tools/call', {
      name: 'search_web',
      arguments: { query: 'node test', limit: 99, provider: 'auto' },
    });
    assert.equal(called.result.isError, false);
    assert.equal(called.result.content.length, 1);
    assert.equal(called.result.content[0].type, 'text');
    assert.ok(called.result.content[0].text.length < 530_000);
    const parsed = JSON.parse(called.result.content[0].text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, 'gateway response too large');

    assert.equal(stub.requests[0].url, '/search');
    assert.equal(stub.requests[0].authorization, 'Bearer secret-token');
    assert.equal(stub.requests[0].body.limit, 20);

    const batch = await mcp.request('tools/call', {
      name: 'batch_fetch_urls',
      arguments: { urls: ['https://a.test', '', 'https://b.test'], mode: 'metadata' },
    });
    assert.equal(batch.result.isError, false);
    assert.match(batch.result.content[0].text, /gateway response too large/);
    assert.equal(stub.requests[1].url, '/batch_fetch');
    assert.deepEqual(stub.requests[1].body.requests.map((item) => item.url), ['https://a.test', 'https://b.test']);
  } finally {
    await mcp.close();
  }

  const badConfig = join(tmp, 'bad.json');
  await writeFile(badConfig, JSON.stringify({ url: 'file:///tmp/gateway', token: 'hidden' }), { mode: 0o600 });
  const bad = startMcp({ SEARCH_GATEWAY_CONFIG: badConfig });
  try {
    const response = await bad.request('tools/call', {
      name: 'fetch_url',
      arguments: { url: 'https://example.com' },
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /HTTP\(S\)/);
    assert.doesNotMatch(response.result.content[0].text, /hidden/);
  } finally {
    await bad.close();
  }
} finally {
  stub.server.close();
  await rm(tmp, { recursive: true, force: true });
}
