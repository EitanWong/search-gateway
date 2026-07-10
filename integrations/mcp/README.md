# Search Gateway MCP

`server.mjs` is a dependency-free, local stdio MCP adapter for the existing Search Gateway Worker. It is intended for Codex CLI and Claude Code.

It exposes only read-only gateway operations:

- `search_web`
- `fetch_url`
- `batch_fetch_urls`
- `search_and_fetch`

Cloudflare deployment and secret management deliberately stay outside the MCP surface. Use the guided workflow in [`../agent-onboarding/SKILL.md`](../agent-onboarding/SKILL.md) or run `npm run agent:setup -- --help` from the repository root.

## Local configuration

The setup script writes a local configuration file at:

```text
$XDG_CONFIG_HOME/search-gateway/config.json
# or ~/.config/search-gateway/config.json
```

The directory is mode `0700` and the file mode `0600`. Codex and Claude Code receive only the config-file path, not an embedded bearer token.

For development or tests, `SEARCH_GATEWAY_URL`, `SEARCH_GATEWAY_TOKEN`, and `SEARCH_GATEWAY_CONFIG` override the default configuration location.
