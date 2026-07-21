#!/usr/bin/env python3
"""Regression tests for the Hermes search-gateway plugin.

Run with:
    python3 tests/test-plugin.py
"""
from __future__ import annotations

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_PATH = ROOT / "integrations" / "hermes" / "search-gateway" / "__init__.py"


def load_plugin():
    spec = importlib.util.spec_from_file_location("search_gateway_plugin", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeCtx:
    def __init__(self):
        self.tools = {}

    def register_tool(self, **kwargs):
        self.tools[kwargs["name"]] = kwargs


def test_fetch_schema_exposes_agent_native_fields():
    plugin = load_plugin()
    props = plugin.FETCH_SCHEMA["properties"]
    for key in ["url", "mode", "max_chars", "offset", "chunk_chars", "cache_ttl"]:
        assert key in props, f"missing FETCH_SCHEMA property: {key}"
    assert props["mode"]["enum"] == ["full", "text", "metadata", "chunks"]


def test_fetch_handler_passes_agent_native_fields():
    plugin = load_plugin()
    calls = []

    def fake_post(path, payload, timeout=plugin.DEFAULT_TIMEOUT):
        calls.append({"path": path, "payload": payload, "timeout": timeout})
        return {"ok": True, "echo": payload}

    plugin._post = fake_post
    ctx = FakeCtx()
    plugin.register(ctx)
    result = json.loads(ctx.tools["fetch_url"]["handler"]({
        "url": "https://example.com/long",
        "mode": "chunks",
        "max_chars": 50000,
        "offset": 1234,
        "chunk_chars": 9000,
        "cache_ttl": 99999,
    }))

    assert result["ok"] is True
    assert calls == [{
        "path": "/fetch",
        "payload": {
            "url": "https://example.com/long",
            "mode": "chunks",
            "max_chars": 30000,
            "offset": 1234,
            "chunk_chars": 6000,
            "cache_ttl": 3600,
        },
        "timeout": 45,
    }]


def test_batch_fetch_tool_exposes_and_maps_shared_fields():
    plugin = load_plugin()
    calls = []

    def fake_post(path, payload, timeout=plugin.DEFAULT_TIMEOUT):
        calls.append({"path": path, "payload": payload, "timeout": timeout})
        return {"ok": True, "echo": payload}

    plugin._post = fake_post
    ctx = FakeCtx()
    plugin.register(ctx)
    assert "batch_fetch_urls" in ctx.tools
    props = ctx.tools["batch_fetch_urls"]["schema"]["properties"]
    for key in ["urls", "mode", "max_chars", "chunk_chars", "cache_ttl"]:
        assert key in props, f"missing batch_fetch_urls schema property: {key}"

    result = json.loads(ctx.tools["batch_fetch_urls"]["handler"]({
        "urls": ["https://a.test", "", "https://b.test"],
        "mode": "chunks",
        "max_chars": 50000,
        "chunk_chars": 9000,
        "cache_ttl": 99999,
    }))
    assert result["ok"] is True
    assert calls == [{
        "path": "/batch_fetch",
        "payload": {
            "requests": [
                {"url": "https://a.test", "mode": "chunks", "max_chars": 30000, "chunk_chars": 6000, "cache_ttl": 3600},
                {"url": "https://b.test", "mode": "chunks", "max_chars": 30000, "chunk_chars": 6000, "cache_ttl": 3600},
            ]
        },
        "timeout": 60,
    }]


def test_search_and_fetch_tool_exposes_and_maps_fields():
    plugin = load_plugin()
    calls = []

    def fake_post(path, payload, timeout=plugin.DEFAULT_TIMEOUT):
        calls.append({"path": path, "payload": payload, "timeout": timeout})
        return {"ok": True, "echo": payload}

    plugin._post = fake_post
    ctx = FakeCtx()
    plugin.register(ctx)
    assert "search_and_fetch" in ctx.tools
    props = ctx.tools["search_and_fetch"]["schema"]["properties"]
    for key in ["query", "limit", "fetch_top", "provider", "mode", "freshness", "language", "fetch_mode", "max_chars", "chunk_chars", "cache_ttl"]:
        assert key in props, f"missing search_and_fetch schema property: {key}"

    result = json.loads(ctx.tools["search_and_fetch"]["handler"]({
        "query": "agent native search",
        "limit": 50,
        "fetch_top": 99,
        "provider": "brave",
        "mode": "thorough",
        "freshness": "week",
        "language": "en-US",
        "fetch_mode": "chunks",
        "max_chars": 50000,
        "chunk_chars": 9000,
        "cache_ttl": 99999,
    }))
    assert result["ok"] is True
    assert calls == [{
        "path": "/search_fetch",
        "payload": {
            "query": "agent native search",
            "limit": 20,
            "fetch_top": 10,
            "provider": "brave",
            "mode": "thorough",
            "freshness": "week",
            "language": "en-US",
            "fetch_mode": "chunks",
            "max_chars": 30000,
            "chunk_chars": 6000,
            "cache_ttl": 3600,
        },
        "timeout": 75,
    }]



def test_search_schema_advertises_and_forwards_firecrawl():
    plugin = load_plugin()
    calls = []

    def fake_post(path, payload, timeout=plugin.DEFAULT_TIMEOUT):
        calls.append({"path": path, "payload": payload, "timeout": timeout})
        return {"ok": True, "echo": payload}

    setattr(plugin, "_post", fake_post)
    ctx = FakeCtx()
    plugin.register(ctx)
    assert "firecrawl" in ctx.tools["search_web"]["schema"]["properties"]["provider"]["description"]
    result = json.loads(ctx.tools["search_web"]["handler"]({
        "query": "Firecrawl Search API",
        "provider": "firecrawl",
    }))
    assert result["ok"] is True
    assert calls == [{
        "path": "/search",
        "payload": {
            "query": "Firecrawl Search API",
            "limit": 8,
            "provider": "firecrawl",
            "mode": "balanced",
            "freshness": "none",
            "language": "auto",
        },
        "timeout": plugin.DEFAULT_TIMEOUT,
    }]


def test_post_allows_public_mode_and_sends_optional_bearer_header():
    plugin = load_plugin()
    seen = []

    class FakeResponse:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc, tb):
            return False
        def read(self, n=-1):
            return b'{"ok": true}'

    def fake_urlopen(req, timeout=plugin.DEFAULT_TIMEOUT):
        seen.append({"url": req.full_url, "headers": dict(req.header_items()), "timeout": timeout})
        return FakeResponse()

    plugin.urllib.request.urlopen = fake_urlopen

    plugin._config = lambda: ("https://gateway.test", None)
    public_result = plugin._post("/search", {"query": "docs"})
    assert public_result["ok"] is True
    assert seen[0]["url"] == "https://gateway.test/search"
    assert "Authorization" not in seen[0]["headers"]

    plugin._config = lambda: ("https://gateway.test", "token")
    private_result = plugin._post("/search", {"query": "docs"})
    assert private_result["ok"] is True
    assert seen[1]["url"] == "https://gateway.test/search"
    assert seen[1]["headers"]["Authorization"] == "Bearer token"


def test_http_error_preserves_gateway_body_top_level():
    plugin = load_plugin()
    plugin._config = lambda: ("https://gateway.test", "token")
    body = {
        "ok": False,
        "status": 502,
        "error": "all batch fetches failed",
        "error_code": "FETCH_FAILED",
        "suggested_action": "try_another_result_or_retry_later",
        "results": [{"ok": False, "error_code": "BLOCKED_URL"}],
    }

    def fake_urlopen(req, timeout=plugin.DEFAULT_TIMEOUT):
        del req, timeout
        raise urllib.error.HTTPError(
            url="https://gateway.test/batch_fetch",
            code=502,
            msg="Bad Gateway",
            hdrs={},
            fp=io.BytesIO(json.dumps(body).encode("utf-8")),
        )

    plugin.urllib.request.urlopen = fake_urlopen
    result = plugin._post("/batch_fetch", {"requests": []})
    assert result["ok"] is False
    assert result["status"] == 502
    assert result["error_code"] == "FETCH_FAILED"
    assert result["suggested_action"] == "try_another_result_or_retry_later"
    assert result["results"][0]["error_code"] == "BLOCKED_URL"
    assert "body" not in result


def test_tool_descriptions_teach_agent_workflow():
    plugin = load_plugin()
    ctx = FakeCtx()
    plugin.register(ctx)
    search_desc = ctx.tools["search_web"]["description"]
    fetch_desc = ctx.tools["fetch_url"]["description"]
    assert "freshness" in search_desc
    assert "mode='thorough'" in search_desc
    assert "fetch_url" in search_desc
    assert "mode='chunks'" in fetch_desc
    assert "next_offset" in fetch_desc
    assert "RAG" in fetch_desc


def main():
    for test in [
        test_fetch_schema_exposes_agent_native_fields,
        test_fetch_handler_passes_agent_native_fields,
        test_batch_fetch_tool_exposes_and_maps_shared_fields,
        test_search_and_fetch_tool_exposes_and_maps_fields,
        test_search_schema_advertises_and_forwards_firecrawl,
        test_post_allows_public_mode_and_sends_optional_bearer_header,
        test_http_error_preserves_gateway_body_top_level,
        test_tool_descriptions_teach_agent_workflow,
    ]:
        test()
    print("ok")


if __name__ == "__main__":
    main()
