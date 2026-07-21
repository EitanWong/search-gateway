---
name: search-gateway-deploy
summary: Guide a user through deploying Search Gateway to Cloudflare and installing it as a Codex/Claude Code stdio MCP.
---

# Search Gateway agent onboarding

Use this skill when the user asks to deploy this repository to Cloudflare, make a coding agent use it for web search, or configure search providers.

## Core rules

- Ask **one group of questions at a time**. Do not request Cloudflare credentials and provider keys in one giant form.
- Default to `private` mode. Explain that `public` is appropriate only for a short demo because anyone with the URL can use it.
- No paid provider is required for the first deployment: DuckDuckGo/Bing fallback works without a provider key.
- Never put secrets in Git, `wrangler.toml`, a command-line argument, a committed file, tool output, or a final summary.
- Receive secrets only to place them in the setup process environment. Do not repeat or display them.
- Do not invent provider setup rules, pricing, permissions, or URLs. For a provider the user selects, use its official dashboard/documentation to guide key creation.
- The MCP is read-only. Do not expose Cloudflare deployment or secret-writing as an MCP tool.

## First message to the user

Say, in the user’s language:

> I can deploy a private Search Gateway and install it as your Codex/Claude Code search MCP. First, which clients should I configure: Codex, Claude Code, or both? Do you want the recommended private mode, or a short-lived public demo?

Wait for the answer before asking for credentials.

## Step 1 — Cloudflare credentials

After the user chooses client(s) and mode, ask for these two values only:

1. Cloudflare **Account ID**.
2. A dedicated, least-privilege Cloudflare API token that can deploy/edit Workers in that account.

Give the official token page: <https://dash.cloudflare.com/profile/api-tokens>.

Do not ask for their global API key. Tell them the token is used only for this local deployment command and is not saved by this repository.

## Step 2 — provider choice

After Cloudflare credentials are available, state:

> Search works now without paid providers. Optional providers improve recall, freshness, or reranking. Pick any of: `zhipu`, `bocha`, `brave`, `serper`, `tavily`, `firecrawl`, `cohere`, `jina`, `voyage`, `siliconflow`; or say `none`.

Ask the user to obtain each selected key from that provider’s **official** account/dashboard and provide it directly to the agent. Do not push them to a third-party key broker.

Map choices to setup environment names:

| Choice | Environment variable | Gateway role |
|---|---|---|
| `zhipu` | `ZHIPU_API_KEY` | web search |
| `bocha` | `BOCHA_API_KEY` | web search / rerank |
| `brave` | `BRAVE_SEARCH_API_KEY` | web search |
| `serper` | `SERPER_API_KEY` | web search |
| `tavily` | `TAVILY_API_KEY` | web search |
| `firecrawl` | `FIRECRAWL_API_KEY` | web search (v2 search, no implicit scrape) |
| `cohere` | `COHERE_API_KEY` | rerank |
| `jina` | `JINA_API_KEY` | rerank |
| `voyage` | `VOYAGE_API_KEY` | rerank |
| `siliconflow` | `SILICONFLOW_API_KEY` | rerank |

`duckduckgo` needs no key and is already a fallback.

## Step 3 — execute safely

Use the repository checkout. Pass credential values only through environment variables; never use `--token`, `--api-key`, or similar command-line flags.

First run a no-side-effect plan:

```bash
CLOUDFLARE_API_TOKEN="..." \
CLOUDFLARE_ACCOUNT_ID="..." \
node scripts/agent-setup.mjs \
  --worker-name "<lowercase-worker-name>" \
  --mode "<private-or-public>" \
  --agent "<codex-or-claude-or-both>" \
  --provider "<comma-separated-provider-choices>" \
  --dry-run
```

Review the plan with the user. Then run the same command without `--dry-run`, with selected provider keys added as environment variables. Do not echo command history or output containing sensitive values.

The script will:

1. deploy the Worker with the requested access mode;
2. generate a private bearer token locally when private mode is selected and no token was supplied;
3. store gateway/provider values as Cloudflare Worker Secrets;
4. verify authenticated `/health`;
5. store endpoint/token only in a local mode-0600 config file;
6. install the `search-gateway` stdio MCP into the selected Codex and/or Claude Code client.

If a `search-gateway` MCP configuration already exists, report that and ask before rerunning with `--replace-agent`. Never replace it silently.

## Step 4 — verify client configuration

Run the relevant command(s):

```bash
codex mcp get search-gateway
claude mcp get search-gateway
```

Then initialize the MCP or start a new client session. Confirm it exposes these read-only tools:

- `search_web`
- `fetch_url`
- `batch_fetch_urls`
- `search_and_fetch`

Perform one small search request and report only whether it worked; do not include bearer tokens in the output.

## GitHub instruction users can paste into an agent

```text
Read and follow https://github.com/EitanWong/search-gateway/blob/main/integrations/agent-onboarding/SKILL.md . Guide me one step at a time, deploy Search Gateway to my Cloudflare account, then configure this coding agent to use it via MCP. Never commit, print, or pass my credentials as command-line arguments.
```
