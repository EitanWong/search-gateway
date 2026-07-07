# Hermes integration

This directory contains a Hermes Agent plugin for `search-gateway`.

## Install

Copy the plugin directory into your Hermes profile plugins directory:

```bash
mkdir -p ~/.hermes/profiles/<profile>/plugins/search-gateway
cp integrations/hermes/search-gateway/__init__.py \
  ~/.hermes/profiles/<profile>/plugins/search-gateway/__init__.py
```

Set the gateway URL for the Hermes process. `SEARCH_GATEWAY_TOKEN` is only needed if you configured that Worker secret after deployment:

```bash
export SEARCH_GATEWAY_URL=https://<your-worker>.<your-subdomain>.workers.dev
# Optional secure mode:
# export SEARCH_GATEWAY_TOKEN=<your-worker-secret>
```

Restart Hermes so the plugin can register these tools:

- `search_web`
- `fetch_url`
- `batch_fetch_urls`
- `search_and_fetch`

## Notes

The plugin is intentionally dependency-free and uses Python standard library HTTP clients.
