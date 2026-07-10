import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const upstreamRepository = "EitanWong/search-gateway";
const requestedRef = process.env.SEARCH_GATEWAY_UPSTREAM_REF || "main";
const force = process.argv.includes("--force");
const workflowNames = ["ci.yml", "deploy-cloudflare.yml", "update-from-upstream.yml"];
const workflowDirectory = resolve(".github/workflows");

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "search-gateway-bootstrap" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

const commit = await fetchText(`https://api.github.com/repos/${upstreamRepository}/commits/${encodeURIComponent(requestedRef)}`)
  .then((body) => JSON.parse(body).sha);
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`Could not resolve ${upstreamRepository}@${requestedRef} to a commit SHA.`);
}

await mkdir(workflowDirectory, { recursive: true });
const written = [];
const skipped = [];
for (const name of workflowNames) {
  const destination = resolve(workflowDirectory, name);
  if (!force) {
    try {
      await readFile(destination, "utf8");
      skipped.push(name);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const source = `https://raw.githubusercontent.com/${upstreamRepository}/${commit}/deploy-template/.github/workflows/${name}`;
  const workflow = await fetchText(source);
  if (!workflow.startsWith("name:")) throw new Error(`Unexpected workflow content from ${source}`);
  await writeFile(destination, workflow);
  written.push(name);
}

console.log(`Resolved ${upstreamRepository}@${requestedRef} to ${commit}.`);
if (written.length) console.log(`Installed: ${written.join(", ")}`);
if (skipped.length) console.log(`Kept existing: ${skipped.join(", ")}`);
console.log("Review the files, then commit and push .github/workflows to enable CI, safe upstream updates, and opt-in deployment.");
