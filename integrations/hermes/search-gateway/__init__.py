"""Hermes plugin: generic Search Gateway client.

Backs generic tools `search_web` and `fetch_url` with a Cloudflare Worker
Search Gateway. Configuration comes from the profile environment:

- SEARCH_GATEWAY_URL=https://...workers.dev
- SEARCH_GATEWAY_TOKEN=...
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


DEFAULT_TIMEOUT = 30
MAX_RESPONSE_BYTES = 512 * 1024


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _config() -> tuple[str | None, str | None]:
    url = (os.getenv("SEARCH_GATEWAY_URL") or "").strip().rstrip("/")
    token = (os.getenv("SEARCH_GATEWAY_TOKEN") or "").strip()
    if url:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            url = ""
    return url or None, token or None


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value if value is not None else default)
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)


def _post(path: str, payload: dict[str, Any], timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any]:
    base_url, token = _config()
    if not base_url or not token:
        return {
            "ok": False,
            "error": "SEARCH_GATEWAY_URL and SEARCH_GATEWAY_TOKEN must be configured in the Hermes profile environment",
            "missing": [name for name, value in [("SEARCH_GATEWAY_URL", base_url), ("SEARCH_GATEWAY_TOKEN", token)] if not value],
        }
    url = base_url + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": "Bearer " + token,
            "user-agent": "Hermes search-gateway plugin/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                return {"ok": False, "error": "gateway response too large", "status": response.status}
            text = raw.decode("utf-8", "ignore")
            try:
                return json.loads(text)
            except Exception:
                return {"ok": False, "error": "gateway returned non-json", "status": response.status, "text": text[:1000]}
    except urllib.error.HTTPError as exc:
        raw = exc.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            return {"ok": False, "error": "gateway error response too large", "status": exc.code}
        text = raw.decode("utf-8", "ignore")
        try:
            body = json.loads(text)
        except Exception:
            body = {"text": text[:1000]}
        if isinstance(body, dict):
            return {"ok": False, "status": exc.code, **body}
        return {"ok": False, "error": f"gateway HTTP {exc.code}", "status": exc.code, "body": body}
    except Exception as exc:
        return {"ok": False, "error": repr(exc)}


SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search query."},
        "limit": {"type": "integer", "description": "Max results, default 8, max 20."},
        "provider": {"type": "string", "description": "auto, searxng, brave, serper, tavily, duckduckgo, or bing. Default auto. `auto` works even with zero paid provider keys via DuckDuckGo/Bing HTML fallback."},
        "strategy": {"type": "string", "description": "fallback for low-cost sequential fallback, or aggregate for parallel multi-provider merge/dedupe/ranking. Default fallback."},
        "freshness": {"type": "string", "description": "none, auto, day, week, month, or year. Default none. auto detects recency intent from the query."},
        "language": {"type": "string", "description": "auto, zh-CN, en-US, or provider-supported locale/market. Default auto."},
    },
    "required": ["query"],
}

FETCH_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string", "description": "HTTP(S) URL to fetch and extract."},
        "mode": {
            "type": "string",
            "enum": ["full", "text", "metadata", "chunks"],
            "description": "full=text+metadata (default), metadata=source/title/date only, text=body only, chunks=RAG-ready heading/paragraph chunks.",
        },
        "max_chars": {"type": "integer", "description": "Max extracted text chars/window, default 8000, max 30000."},
        "offset": {"type": "integer", "description": "Resume extraction from this character offset; use next_offset from a prior response."},
        "chunk_chars": {"type": "integer", "description": "Approximate chars per chunk in mode='chunks', default 1800, max 6000."},
        "cache_ttl": {"type": "integer", "description": "Worker cache TTL seconds for extracted result, default 300, 0 disables, max 3600."},
    },
    "required": ["url"],
}
BATCH_FETCH_SCHEMA = {
    "type": "object",
    "properties": {
        "urls": {
            "type": "array",
            "items": {"type": "string"},
            "description": "HTTP(S) URLs to fetch in one gateway call; empty strings are ignored, max 10.",
        },
        "mode": {
            "type": "string",
            "enum": ["full", "text", "metadata", "chunks"],
            "description": "Shared fetch mode for every URL. Use metadata for triage, chunks for RAG-ready reading.",
        },
        "max_chars": {"type": "integer", "description": "Shared max extracted text chars/window, default 8000, max 30000."},
        "chunk_chars": {"type": "integer", "description": "Shared chars per chunk in mode='chunks', default 1800, max 6000."},
        "cache_ttl": {"type": "integer", "description": "Shared Worker cache TTL seconds, default 300, 0 disables, max 3600."},
    },
    "required": ["urls"],
}
SEARCH_FETCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search query."},
        "limit": {"type": "integer", "description": "Max search results, default 8, max 20."},
        "fetch_top": {"type": "integer", "description": "How many top search results to fetch, default 3, max 10."},
        "provider": SEARCH_SCHEMA["properties"]["provider"],
        "strategy": SEARCH_SCHEMA["properties"]["strategy"],
        "freshness": SEARCH_SCHEMA["properties"]["freshness"],
        "language": SEARCH_SCHEMA["properties"]["language"],
        "fetch_mode": {
            "type": "string",
            "enum": ["full", "text", "metadata", "chunks"],
            "description": "Mode used when fetching selected search results. Use chunks for deep reading, metadata for triage.",
        },
        "max_chars": {"type": "integer", "description": "Max extracted text chars/window per fetched result, default 8000, max 30000."},
        "chunk_chars": {"type": "integer", "description": "Chars per chunk in fetch_mode='chunks', default 1800, max 6000."},
        "cache_ttl": {"type": "integer", "description": "Worker cache TTL seconds for fetched pages, default 300, 0 disables, max 3600."},
    },
    "required": ["query"],
}


def register(ctx):
    def search(args: dict[str, Any], **kwargs) -> str:
        del kwargs
        query = str(args.get("query", "")).strip()
        if not query:
            return _json({"ok": False, "error": "query is required"})
        payload = {
            "query": query,
            "limit": _bounded_int(args.get("limit"), 8, 1, 20),
            "provider": str(args.get("provider", "auto") or "auto"),
            "strategy": str(args.get("strategy", "fallback") or "fallback"),
            "freshness": str(args.get("freshness", "none") or "none"),
            "language": str(args.get("language", "auto") or "auto"),
        }
        return _json(_post("/search", payload))

    def fetch(args: dict[str, Any], **kwargs) -> str:
        del kwargs
        url = str(args.get("url", "")).strip()
        if not url:
            return _json({"ok": False, "error": "url is required"})
        mode = str(args.get("mode", "full") or "full")
        if mode not in {"full", "text", "metadata", "chunks"}:
            return _json({"ok": False, "error": "mode must be one of full, text, metadata, chunks"})
        payload = {
            "url": url,
            "mode": mode,
            "max_chars": _bounded_int(args.get("max_chars"), 8000, 500, 30000),
            "offset": _bounded_int(args.get("offset"), 0, 0, 300000),
            "chunk_chars": _bounded_int(args.get("chunk_chars"), 1800, 300, 6000),
            "cache_ttl": _bounded_int(args.get("cache_ttl"), 300, 0, 3600),
        }
        return _json(_post("/fetch", payload, timeout=45))

    def batch_fetch(args: dict[str, Any], **kwargs) -> str:
        del kwargs
        raw_urls = args.get("urls", [])
        if not isinstance(raw_urls, list):
            return _json({"ok": False, "error": "urls must be an array"})
        urls = [str(url).strip() for url in raw_urls if str(url).strip()][:10]
        if not urls:
            return _json({"ok": False, "error": "urls is required"})
        mode = str(args.get("mode", "metadata") or "metadata")
        if mode not in {"full", "text", "metadata", "chunks"}:
            return _json({"ok": False, "error": "mode must be one of full, text, metadata, chunks"})
        shared = {
            "mode": mode,
            "max_chars": _bounded_int(args.get("max_chars"), 8000, 500, 30000),
            "chunk_chars": _bounded_int(args.get("chunk_chars"), 1800, 300, 6000),
            "cache_ttl": _bounded_int(args.get("cache_ttl"), 300, 0, 3600),
        }
        payload = {"requests": [{"url": url, **shared} for url in urls]}
        return _json(_post("/batch_fetch", payload, timeout=60))

    def search_fetch(args: dict[str, Any], **kwargs) -> str:
        del kwargs
        query = str(args.get("query", "")).strip()
        if not query:
            return _json({"ok": False, "error": "query is required"})
        fetch_mode = str(args.get("fetch_mode", "chunks") or "chunks")
        if fetch_mode not in {"full", "text", "metadata", "chunks"}:
            return _json({"ok": False, "error": "fetch_mode must be one of full, text, metadata, chunks"})
        payload = {
            "query": query,
            "limit": _bounded_int(args.get("limit"), 8, 1, 20),
            "fetch_top": _bounded_int(args.get("fetch_top"), 3, 1, 10),
            "provider": str(args.get("provider", "auto") or "auto"),
            "strategy": str(args.get("strategy", "fallback") or "fallback"),
            "freshness": str(args.get("freshness", "none") or "none"),
            "language": str(args.get("language", "auto") or "auto"),
            "fetch_mode": fetch_mode,
            "max_chars": _bounded_int(args.get("max_chars"), 8000, 500, 30000),
            "chunk_chars": _bounded_int(args.get("chunk_chars"), 1800, 300, 6000),
            "cache_ttl": _bounded_int(args.get("cache_ttl"), 300, 0, 3600),
        }
        return _json(_post("/search_fetch", payload, timeout=75))

    ctx.register_tool(
        name="search_web",
        toolset="search_gateway",
        schema=SEARCH_SCHEMA,
        handler=search,
        description=(
            "Search the web and return ranked results with title, URL, snippet, source, provider diagnostics, "
            "and publication date when available. Use freshness='day' or 'week' for recent events, "
            "strategy='aggregate' for high-recall research, and follow promising results with fetch_url."
        ),
    )
    ctx.register_tool(
        name="fetch_url",
        toolset="search_gateway",
        schema=FETCH_SCHEMA,
        handler=fetch,
        description=(
            "Fetch and extract a web page through the Search Gateway. Use mode='metadata' to preflight many URLs, "
            "mode='chunks' for RAG-ready reading, mode='text' for body-only extraction, offset/next_offset "
            "to continue long pages, and chunk_chars to tune chunk size."
        ),
    )
    ctx.register_tool(
        name="batch_fetch_urls",
        toolset="search_gateway",
        schema=BATCH_FETCH_SCHEMA,
        handler=batch_fetch,
        description=(
            "Fetch up to 10 URLs in one gateway call. Use mode='metadata' to triage search results cheaply, "
            "or mode='chunks' to read several selected sources in parallel. Each result has its own ok/error_code/request_id."
        ),
    )
    ctx.register_tool(
        name="search_and_fetch",
        toolset="search_gateway",
        schema=SEARCH_FETCH_SCHEMA,
        handler=search_fetch,
        description=(
            "Agent-native research primitive: search the web, fetch the top results, and return search metadata plus fetched pages in one call. "
            "Use fetch_mode='chunks' for deep reading or fetch_mode='metadata' for fast source triage."
        ),
    )
