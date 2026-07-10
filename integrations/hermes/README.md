# Hermes integration

This directory contains a Hermes Agent plugin for `search-gateway`.

## Install

The plugin is profile-scoped. Resolve the active profile's real directory through the Hermes CLI instead of assuming a fixed `~/.hermes` path:

```bash
PROFILE=<profile>
PROFILE_DIR="$(dirname "$(hermes -p "$PROFILE" config env-path)")"
install -Dm644 integrations/hermes/search-gateway/__init__.py \
  "$PROFILE_DIR/plugins/search-gateway/__init__.py"
hermes -p "$PROFILE" plugins enable search-gateway
```

Set `SEARCH_GATEWAY_URL` in the environment file printed by `hermes -p "$PROFILE" config env-path`. `SEARCH_GATEWAY_TOKEN` is optional for public Workers and required only when the Worker uses `SEARCH_GATEWAY_MODE=private`.

```env
SEARCH_GATEWAY_URL=https://<your-worker>.<your-subdomain>.workers.dev
# Private Workers only:
# SEARCH_GATEWAY_TOKEN=<your-worker-secret>
```

Restart the profile gateway when one is running:

```bash
hermes -p "$PROFILE" gateway restart
```

Hermes fixes tool schemas at session start. In an interactive TUI, run `/reset` (or open a new session) after enabling the plugin or changing its environment. The new session registers:

- `search_web`
- `fetch_url`
- `batch_fetch_urls`
- `search_and_fetch`

## Notes

The plugin is intentionally dependency-free and uses Python standard library HTTP clients. Test the Worker URL from the same network namespace that runs Hermes; a healthy Worker cannot compensate for a container with no public egress.
