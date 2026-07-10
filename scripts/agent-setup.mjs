import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SERVER = join(ROOT, "integrations", "mcp", "server.mjs");
const CONFIG_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "search-gateway", "config.json");

const PROVIDERS = {
  zhipu: "ZHIPU_API_KEY",
  bocha: "BOCHA_API_KEY",
  brave: "BRAVE_SEARCH_API_KEY",
  serper: "SERPER_API_KEY",
  tavily: "TAVILY_API_KEY",
  cohere: "COHERE_API_KEY",
  jina: "JINA_API_KEY",
  voyage: "VOYAGE_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  duckduckgo: null,
};

const HELP = `Usage:
  node scripts/agent-setup.mjs --worker-name NAME [options]

Options:
  --mode public|private       Worker access mode (default: private)
  --agent codex|claude|both   Install MCP configuration for these clients (default: both)
  --provider NAME[,NAME]      Optional: zhipu, bocha, brave, serper, tavily, cohere, jina, voyage, siliconflow, duckduckgo
  --replace-agent             Replace an existing search-gateway MCP configuration
  --no-install                Deploy/configure Worker but do not install an MCP client configuration
  --dry-run                   Validate inputs and print a secret-free plan without side effects
  --help                      Print this help

Required environment variables:
  CLOUDFLARE_API_TOKEN        Least-privilege Worker deploy token
  CLOUDFLARE_ACCOUNT_ID       Target Cloudflare account ID

Optional secret environment variables:
  SEARCH_GATEWAY_TOKEN        Private Worker token; generated locally when omitted
  ZHIPU_API_KEY, BOCHA_API_KEY, BRAVE_SEARCH_API_KEY, SERPER_API_KEY, TAVILY_API_KEY,
  COHERE_API_KEY, JINA_API_KEY, VOYAGE_API_KEY, SILICONFLOW_API_KEY
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { mode: "private", agent: "both", providers: [], replaceAgent: false, noInstall: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--replace-agent") options.replaceAgent = true;
    else if (arg === "--no-install") options.noInstall = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (["--worker-name", "--mode", "--agent", "--provider"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      index += 1;
      if (arg === "--worker-name") options.workerName = value;
      if (arg === "--mode") options.mode = value;
      if (arg === "--agent") options.agent = value;
      if (arg === "--provider") options.providers.push(...value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function validate(options) {
  if (!options.workerName || !/^[a-z][a-z0-9-]{0,62}$/.test(options.workerName)) {
    fail("--worker-name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 63 chars)");
  }
  if (!["public", "private"].includes(options.mode)) fail("--mode must be public or private");
  if (!["codex", "claude", "both"].includes(options.agent)) fail("--agent must be codex, claude, or both");
  options.providers = [...new Set(options.providers)];
  for (const provider of options.providers) {
    if (!(provider in PROVIDERS)) fail(`Unknown provider: ${provider}`);
    const variable = PROVIDERS[provider];
    if (variable && !String(process.env[variable] || "").trim()) fail(`${variable} is required when --provider includes ${provider}`);
  }
  if (!String(process.env.CLOUDFLARE_API_TOKEN || "").trim()) fail("CLOUDFLARE_API_TOKEN is required");
  if (!String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim()) fail("CLOUDFLARE_ACCOUNT_ID is required");
}

function commandLabel(command, args) {
  return [command, ...args.map((value) => /\s/.test(value) ? JSON.stringify(value) : value)].join(" ");
}

function run(command, args, { input, capture = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", "inherit"] });
    let stdout = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
    }
    child.on("error", (error) => rejectRun(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`${command} exited with status ${code}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function commandExists(command) {
  try {
    await run(command, ["--version"], { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function mcpExists(agent) {
  try {
    await run(agent, ["mcp", "get", "search-gateway"], { capture: true });
    return true;
  } catch {
    return false;
  }
}

function selectedAgents(agent) {
  return agent === "both" ? ["codex", "claude"] : [agent];
}

async function preflight(options) {
  for (const command of ["npx", ...(!options.noInstall ? selectedAgents(options.agent) : [])]) {
    if (!await commandExists(command)) fail(`${command} is required but was not found on PATH`);
  }
  if (!options.noInstall && !options.replaceAgent) {
    for (const agent of selectedAgents(options.agent)) {
      if (await mcpExists(agent)) fail(`${agent} already has a search-gateway MCP configuration; rerun with --replace-agent to replace it`);
    }
  }
}

function workerUrlFromDeploy(output) {
  const urls = output.match(/https:\/\/[^\s)'"`]+\.workers\.dev/g) || [];
  return urls.at(-1)?.replace(/\/$/, "") || null;
}

async function putSecret(name, workerName, value) {
  await run("npx", ["wrangler", "secret", "put", name, "--config", "worker-config.toml", "--name", workerName], { input: `${value}\n` });
}

async function verifyHealth(url, token) {
  let latestError = "health endpoint did not return a valid response";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${url}/health`, { headers, signal: AbortSignal.timeout(15_000) });
      const health = await response.json();
      if (response.ok && health?.ok === true && health?.service === "search-gateway") return;
      latestError = `health endpoint returned HTTP ${response.status}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : latestError;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  fail(`Worker deployed but health verification failed: ${latestError}`);
}

async function writeConfig(url, token) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await chmod(dirname(CONFIG_PATH), 0o700);
  await writeFile(CONFIG_PATH, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

async function installMcp(agent, replaceAgent) {
  if (replaceAgent && await mcpExists(agent)) await run(agent, ["mcp", "remove", "search-gateway"]);
  if (agent === "codex") {
    await run("codex", ["mcp", "add", "search-gateway", "--env", `SEARCH_GATEWAY_CONFIG=${CONFIG_PATH}`, "--", process.execPath, MCP_SERVER]);
  } else {
    await run("claude", ["mcp", "add", "-s", "user", "search-gateway", "-e", `SEARCH_GATEWAY_CONFIG=${CONFIG_PATH}`, "--", process.execPath, MCP_SERVER]);
  }
}

function printPlan(options) {
  const providers = options.providers.filter((provider) => PROVIDERS[provider]);
  let step = 1;
  const printStep = (message) => console.log(`${step++}. ${message}`);
  console.log("Dry run plan (no files, secrets, MCP settings, or Cloudflare resources will change):");
  printStep(commandLabel("npx", ["wrangler", "deploy", "--config", "worker-config.toml", "--name", options.workerName, "--var", `SEARCH_GATEWAY_MODE:${options.mode}`, "--keep-vars"]));
  if (options.mode === "private") printStep("Store SEARCH_GATEWAY_TOKEN as a Cloudflare Worker secret (value is generated or read from environment, never printed).");
  if (providers.length) printStep(`Store selected provider secrets: ${providers.map((provider) => PROVIDERS[provider]).join(", ")}.`);
  printStep(`Verify https://<workers.dev>/health and write local mode-0600 configuration at ${CONFIG_PATH}.`);
  if (!options.noInstall) {
    if (options.agent === "codex" || options.agent === "both") printStep("codex mcp add search-gateway --env SEARCH_GATEWAY_CONFIG=<local-config> -- node <mcp-server>");
    if (options.agent === "claude" || options.agent === "both") printStep("claude mcp add -s user search-gateway -e SEARCH_GATEWAY_CONFIG=<local-config> -- node <mcp-server>");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  validate(options);
  if (options.dryRun) {
    printPlan(options);
    return;
  }
  await preflight(options);

  const deployOutput = await run("npx", ["wrangler", "deploy", "--config", "worker-config.toml", "--name", options.workerName, "--var", `SEARCH_GATEWAY_MODE:${options.mode}`, "--keep-vars"], { capture: true });
  process.stderr.write(deployOutput);
  const url = workerUrlFromDeploy(deployOutput);
  if (!url) fail("Wrangler completed but did not report a workers.dev URL; no local agent configuration was written");

  const token = options.mode === "private" ? String(process.env.SEARCH_GATEWAY_TOKEN || randomBytes(32).toString("hex")) : "";
  if (options.mode === "private") await putSecret("SEARCH_GATEWAY_TOKEN", options.workerName, token);
  for (const provider of options.providers) {
    const variable = PROVIDERS[provider];
    if (variable) await putSecret(variable, options.workerName, process.env[variable]);
  }
  await verifyHealth(url, token);
  await writeConfig(url, token);

  if (!options.noInstall) {
    for (const agent of selectedAgents(options.agent)) await installMcp(agent, options.replaceAgent);
  }
  console.log(`Search Gateway is ready at ${url}. Local MCP credentials are stored in ${CONFIG_PATH}.`);
}

main().catch((error) => {
  process.stderr.write(`Setup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
