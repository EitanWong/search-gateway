import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_RESPONSE_BYTES = 512 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const FETCH_MODES = ["full", "text", "metadata", "chunks"];

function configPath() {
  return process.env.SEARCH_GATEWAY_CONFIG
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "search-gateway", "config.json");
}

function validGatewayUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function gatewayConfig() {
  let stored = {};
  try {
    stored = JSON.parse(await readFile(configPath(), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { error: "Search Gateway local configuration is unreadable." };
    }
  }

  const url = validGatewayUrl(process.env.SEARCH_GATEWAY_URL || stored.url);
  const token = String(process.env.SEARCH_GATEWAY_TOKEN || stored.token || "").trim();
  if (!url) {
    return { error: "Search Gateway URL is missing or is not an HTTP(S) URL. Run the agent setup workflow first." };
  }
  return { url, token };
}

function boundedInt(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, minimum), maximum);
}

function requiredString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function fetchMode(value, fallback) {
  const mode = String(value || fallback);
  if (!FETCH_MODES.includes(mode)) throw new Error(`mode must be one of ${FETCH_MODES.join(", ")}`);
  return mode;
}

const searchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query." },
    limit: { type: "integer", description: "Max results, default 8, max 20." },
    provider: { type: "string", description: "auto, searxng, zhipu, bocha, bocha_ai, brave, serper, tavily, duckduckgo, or bing. Default auto." },
    mode: { type: "string", description: "fast, balanced, or thorough. Default balanced." },
    freshness: { type: "string", description: "none, auto, day, week, month, or year. Default none." },
    language: { type: "string", description: "auto, zh-CN, en-US, or provider-supported locale/market. Default auto." },
  },
  required: ["query"],
};

const fetchSchema = {
  type: "object",
  properties: {
    url: { type: "string", description: "HTTP(S) URL to fetch and extract." },
    mode: { type: "string", enum: FETCH_MODES, description: "full=text+metadata, metadata=source/title/date only, text=body only, chunks=RAG-ready content." },
    max_chars: { type: "integer", description: "Max extracted text chars/window, default 8000, max 30000." },
    offset: { type: "integer", description: "Resume extraction from this character offset." },
    chunk_chars: { type: "integer", description: "Approximate chars per chunk in chunks mode, default 1800, max 6000." },
    cache_ttl: { type: "integer", description: "Worker cache TTL seconds, default 300, 0 disables, max 3600." },
  },
  required: ["url"],
};

const batchSchema = {
  type: "object",
  properties: {
    urls: { type: "array", items: { type: "string" }, description: "HTTP(S) URLs to fetch; empty strings are ignored, max 10." },
    mode: { type: "string", enum: FETCH_MODES, description: "Shared fetch mode; metadata is useful for triage." },
    max_chars: { type: "integer", description: "Shared extracted text limit, default 8000, max 30000." },
    chunk_chars: { type: "integer", description: "Shared chunk size, default 1800, max 6000." },
    cache_ttl: { type: "integer", description: "Shared cache TTL seconds, default 300, max 3600." },
  },
  required: ["urls"],
};

const searchFetchSchema = {
  type: "object",
  properties: {
    ...searchSchema.properties,
    fetch_top: { type: "integer", description: "How many top search results to fetch, default 2, max 10." },
    fetch_mode: { type: "string", enum: FETCH_MODES, description: "Mode used to fetch selected results; chunks is useful for deep reading." },
    max_chars: { type: "integer", description: "Max extracted text chars/window per fetched result, default 8000, max 30000." },
    chunk_chars: { type: "integer", description: "Chars per chunk in fetch_mode, default 1800, max 6000." },
    cache_ttl: { type: "integer", description: "Worker cache TTL seconds, default 300, max 3600." },
  },
  required: ["query"],
};

const tools = [
  { name: "search_web", description: "Search the web through Search Gateway. Use freshness for recency and thorough for high recall.", inputSchema: searchSchema },
  { name: "fetch_url", description: "Fetch and extract one page through Search Gateway.", inputSchema: fetchSchema },
  { name: "batch_fetch_urls", description: "Fetch up to ten pages in one Search Gateway call.", inputSchema: batchSchema },
  { name: "search_and_fetch", description: "Search then fetch top results through Search Gateway.", inputSchema: searchFetchSchema },
];

function searchPayload(args) {
  return {
    query: requiredString(args.query, "query"),
    limit: boundedInt(args.limit, 8, 1, 20),
    provider: String(args.provider || "auto"),
    mode: String(args.mode || "balanced"),
    freshness: String(args.freshness || "none"),
    language: String(args.language || "auto"),
  };
}

function fetchPayload(args) {
  return {
    url: requiredString(args.url, "url"),
    mode: fetchMode(args.mode, "full"),
    max_chars: boundedInt(args.max_chars, 8000, 500, 30000),
    offset: boundedInt(args.offset, 0, 0, 300000),
    chunk_chars: boundedInt(args.chunk_chars, 1800, 300, 6000),
    cache_ttl: boundedInt(args.cache_ttl, 300, 0, 3600),
  };
}

function batchPayload(args) {
  if (!Array.isArray(args.urls)) throw new Error("urls must be an array");
  const urls = args.urls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 10);
  if (!urls.length) throw new Error("urls is required");
  const shared = {
    mode: fetchMode(args.mode, "metadata"),
    max_chars: boundedInt(args.max_chars, 8000, 500, 30000),
    chunk_chars: boundedInt(args.chunk_chars, 1800, 300, 6000),
    cache_ttl: boundedInt(args.cache_ttl, 300, 0, 3600),
  };
  return { requests: urls.map((url) => ({ url, ...shared })) };
}

function searchFetchPayload(args) {
  const search = searchPayload(args);
  return {
    ...search,
    fetch_top: boundedInt(args.fetch_top, 2, 1, 10),
    fetch_mode: fetchMode(args.fetch_mode, "chunks"),
    max_chars: boundedInt(args.max_chars, 8000, 500, 30000),
    chunk_chars: boundedInt(args.chunk_chars, 1800, 300, 6000),
    cache_ttl: boundedInt(args.cache_ttl, 300, 0, 3600),
  };
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("gateway response too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function callGateway(path, payload) {
  const config = await gatewayConfig();
  if (config.error) throw new Error(config.error);
  const headers = { "content-type": "application/json", "user-agent": "search-gateway-mcp/0.1" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(path === "/search_and_fetch" ? 75_000 : path === "/batch_fetch" ? 60_000 : path === "/fetch" ? 45_000 : 30_000),
    });
    const text = await readResponse(response);
    let body;
    try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 1000) }; }
    if (response.ok) return body;
    return typeof body === "object" && body ? { ok: false, status: response.status, ...body } : { ok: false, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "gateway request failed" };
  }
}

function toolResult(payload, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError };
}

async function callTool(name, args = {}) {
  try {
    if (name === "search_web") return toolResult(await callGateway("/search", searchPayload(args)));
    if (name === "fetch_url") return toolResult(await callGateway("/fetch", fetchPayload(args)));
    if (name === "batch_fetch_urls") return toolResult(await callGateway("/batch_fetch", batchPayload(args)));
    if (name === "search_and_fetch") return toolResult(await callGateway("/search_fetch", searchFetchPayload(args)));
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return toolResult({ ok: false, error: error instanceof Error ? error.message : "invalid tool arguments" }, true);
  }
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function rpcError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })}\n`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    rpcError(message?.id, -32600, "Invalid Request");
    return;
  }
  const { id, method, params = {} } = message;
  if (method === "notifications/initialized") return;
  if (method === "initialize") {
    const requested = String(params.protocolVersion || "");
    respond(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "search-gateway", version: "0.1.0" },
    });
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools });
    return;
  }
  if (method === "tools/call") {
    respond(id, await callTool(String(params.name || ""), params.arguments || {}));
    return;
  }
  if (id !== undefined) rpcError(id, -32601, "Method not found");
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    await handle(JSON.parse(line));
  } catch {
    rpcError(null, -32700, "Parse error");
  }
}
