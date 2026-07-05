#!/usr/bin/env python3
"""Autonomous release loop for search-gateway.

Policy:
- Claude Fable audits architecture/release readiness.
- Codex implements concrete fixes.
- Local verification gates every round.
- Stop when Fable says RELEASE_READY and verification passes, or on explicit blocker.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path("/opt/data/projects/typescript/cloudflare-workers/search-gateway")
PLUGIN = Path("/opt/data/profiles/lucky/plugins/search-gateway/__init__.py")
CLAUDE_ENV = Path("/opt/data/profiles/lucky/scripts/claude-env.sh")
CODEX_ENV = Path("/opt/data/profiles/lucky/scripts/codex-env.sh")
BIN_DIR = Path("/opt/data/profiles/lucky/home/.local/bin")
STATE_DIR = PROJECT / ".release-loop"
LOG_DIR = STATE_DIR / "logs"
STATE_FILE = STATE_DIR / "state.json"
MAX_ROUNDS = int(os.environ.get("SEARCH_GATEWAY_RELEASE_MAX_ROUNDS", "8"))

RELEASE_CRITERIA = """
Release standard for this Cloudflare Worker Search Gateway:
1. Functional: /search and /fetch work with Bearer auth; /search works without paid search providers via no-key fallback where possible.
2. Security: no obvious SSRF/redirect bypass, no credential leakage, bounded request/response reads, health diagnostics gated appropriately.
3. Reliability: deterministic tests pass; syntax checks pass; wrangler dry-run succeeds; live smoke succeeds unless external network is clearly unavailable.
4. Agent quality: /fetch returns agent-readable Markdown-ish main content, metadata, truncation/dynamic-page hints; avoids obvious nav/related-content noise.
5. Deployability: wrangler.toml/docs/env examples are coherent. Actual Cloudflare deploy may be blocked only by missing CLOUDFLARE credentials, not code quality.
6. Maintainability: no unnecessary abstractions, no large rewrites without justification, docs updated for public/open-source use.
""".strip()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ensure_dirs() -> None:
    STATE_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)
    (PROJECT / "scripts").mkdir(exist_ok=True)


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {
        "status": "running",
        "started_at": now(),
        "round": 0,
        "events": [],
        "last_decision": None,
        "blocker": None,
    }


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def event(state: dict, msg: str) -> None:
    line = f"[{now()}] {msg}"
    print(line, flush=True)
    state.setdefault("events", []).append(line)
    save_state(state)


def run(cmd: str, name: str, timeout: int = 600, env_extra: dict | None = None) -> tuple[int, str]:
    log_path = LOG_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{name}.log"
    env = os.environ.copy()
    env["PATH"] = f"{BIN_DIR}:{env.get('PATH','')}"
    if env_extra:
        env.update(env_extra)
    proc = subprocess.run(
        cmd,
        cwd=str(PROJECT),
        shell=True,
        executable="/bin/bash",
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    log_path.write_text(output)
    return proc.returncode, output


def verify() -> tuple[bool, str]:
    checks: list[tuple[str, str, int]] = [
        ("node-check-src", "node --check src/index.js", 120),
        ("node-check-tests", "node --check tests/test-worker.mjs && node --check tests/live-smoke.mjs", 120),
        ("unit-tests", "npm test", 300),
        ("dry-run", "npm run dry-run", 420),
        ("live-smoke", "npm run test:live", 420),
    ]
    if PLUGIN.exists():
        checks.append(("plugin-compile", f"python3 -m py_compile {shlex.quote(str(PLUGIN))}", 120))

    summary = []
    ok = True
    for name, cmd, timeout in checks:
        rc, out = run(cmd, f"verify_{name}", timeout=timeout)
        tail = "\n".join(out.strip().splitlines()[-20:])
        if rc != 0:
            ok = False
            summary.append(f"FAIL {name} rc={rc}\n{tail}")
        else:
            summary.append(f"PASS {name}\n{tail}")
    return ok, "\n\n".join(summary)


def git_snapshot(label: str) -> str:
    rc, out = run("git status --short && git diff --stat", f"git_{label}", timeout=120)
    return out.strip()


def run_fable_audit(round_no: int, verify_summary: str, phase: str) -> tuple[bool, str, str]:
    prompt = f"""
You are Claude Fable 5 acting as release architect/auditor for a Cloudflare Worker web search gateway.

Project path: {PROJECT}
Phase: {phase}
Round: {round_no}

Read the important files only:
- src/index.js
- tests/test-worker.mjs
- tests/live-smoke.mjs
- package.json
- wrangler.toml
- README.md
- .dev.vars.example
- {PLUGIN if PLUGIN.exists() else 'Hermes plugin path absent'}

Release criteria:
{RELEASE_CRITERIA}

Latest verification summary:
{verify_summary[:8000]}

Audit rules:
- Be blockers-only. Do NOT invent style/cosmetic work.
- P0/P1 blockers only: security, correctness, deployability, serious reliability, tests that should exist but are missing for a real risk.
- If Cloudflare credentials are missing, mention it as DEPLOY_BLOCKER, but do not mark code unready solely for missing credentials.
- If no P0/P1 code blockers remain and verification passes, output DECISION: RELEASE_READY.
- If work remains, output DECISION: NEEDS_WORK and provide a precise NEXT_CODEX_TASK.
- Codex will implement your NEXT_CODEX_TASK literally, so make it small and concrete.

Required output format exactly:
DECISION: RELEASE_READY | NEEDS_WORK | BLOCKED
SUMMARY: <one paragraph>
BLOCKERS:
- <P0/P1 blocker or NONE>
NEXT_CODEX_TASK:
<concrete implementation task for Codex, or NONE>
""".strip()
    prompt_file = LOG_DIR / f"round_{round_no}_{phase}_fable_prompt.txt"
    prompt_file.write_text(prompt)
    source = f"source {shlex.quote(str(CLAUDE_ENV))} && " if CLAUDE_ENV.exists() else ""
    cmd = (
        f"{source}claude --bare -p \"$(cat {shlex.quote(str(prompt_file))})\" "
        "--model claude-fable-5 --effort max --allowedTools 'Read,Bash' "
        "--max-turns 16 --output-format json --no-session-persistence"
    )
    rc, out = run(cmd, f"round_{round_no}_{phase}_fable", timeout=1800)
    if rc != 0:
        return False, "BLOCKED", f"Fable command failed rc={rc}\n{out[-4000:]}"

    text = out
    try:
        data = json.loads(out)
        text = data.get("result") or data.get("message") or out
    except Exception:
        pass
    decision_match = re.search(r"DECISION:\s*(RELEASE_READY|NEEDS_WORK|BLOCKED)", text)
    decision = decision_match.group(1) if decision_match else "NEEDS_WORK"
    ok = decision == "RELEASE_READY"
    return ok, decision, text


def extract_next_task(audit_text: str) -> str:
    m = re.search(r"NEXT_CODEX_TASK:\s*(.*)\Z", audit_text, re.S)
    if not m:
        return ""
    task = m.group(1).strip()
    if not task or task.upper() == "NONE":
        return ""
    return task


def run_codex(round_no: int, audit_text: str, verify_summary: str) -> tuple[bool, str]:
    task = extract_next_task(audit_text)
    if not task:
        return False, "No NEXT_CODEX_TASK found in audit."

    prompt = f"""
You are Codex implementing one focused release-readiness fix for the Search Gateway project.

Project: {PROJECT}

IMPORTANT RULES:
- Follow the existing architecture. Surgical changes only.
- Do not remove no-key fallback search support.
- Preserve security boundaries: SSRF guard, redirect guard, bounded reads, auth.
- Do not commit. Do not deploy. Do not print secrets.
- Update deterministic tests and docs if behavior changes.
- After implementation, run: node --check src/index.js && node --check tests/test-worker.mjs && npm test.

Release criteria:
{RELEASE_CRITERIA}

Fable audit finding:
{audit_text[:12000]}

Current verification summary:
{verify_summary[:5000]}

YOUR TASK:
{task}
""".strip()
    prompt_file = LOG_DIR / f"round_{round_no}_codex_prompt.txt"
    prompt_file.write_text(prompt)
    source = ""
    if CODEX_ENV.exists():
        source += f"source {shlex.quote(str(CODEX_ENV))} && "
    cmd = f"{source}codex exec --dangerously-bypass-approvals-and-sandbox \"$(cat {shlex.quote(str(prompt_file))})\""
    rc, out = run(cmd, f"round_{round_no}_codex", timeout=3600)
    if rc != 0 and ("unexpected argument" in out or "unknown option" in out or "unrecognized" in out):
        # Fallback for Codex versions without this flag.
        cmd2 = f"{source}codex exec \"$(cat {shlex.quote(str(prompt_file))})\""
        rc, out2 = run(cmd2, f"round_{round_no}_codex_fallback", timeout=3600)
        out += "\n--- fallback output ---\n" + out2
    return rc == 0, out[-6000:]


def credential_status() -> str:
    keys = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SEARCH_GATEWAY_URL", "SEARCH_GATEWAY_TOKEN"]
    return "\n".join(f"{k}: {'SET' if os.getenv(k) else 'MISSING'}" for k in keys)


def main() -> int:
    ensure_dirs()
    state = load_state()
    event(state, f"release loop started/continued; max_rounds={MAX_ROUNDS}")
    event(state, "credential status:\n" + credential_status())

    for round_no in range(state.get("round", 0) + 1, MAX_ROUNDS + 1):
        state["round"] = round_no
        save_state(state)
        event(state, f"round {round_no}: verification gate")
        verify_ok, verify_summary = verify()
        (LOG_DIR / f"round_{round_no}_verify_summary.txt").write_text(verify_summary)
        event(state, f"round {round_no}: verify_ok={verify_ok}")

        event(state, f"round {round_no}: fable audit")
        ready, decision, audit_text = run_fable_audit(round_no, verify_summary, phase="audit")
        (LOG_DIR / f"round_{round_no}_fable_audit.txt").write_text(audit_text)
        state["last_decision"] = decision
        save_state(state)
        event(state, f"round {round_no}: fable decision={decision}")

        if decision == "BLOCKED":
            state["status"] = "blocked"
            state["blocker"] = audit_text[-4000:]
            save_state(state)
            print("\n=== RELEASE LOOP BLOCKED ===\n" + audit_text[-4000:])
            return 2

        if ready and verify_ok:
            state["status"] = "release_ready"
            state["completed_at"] = now()
            state["git_snapshot"] = git_snapshot("release_ready")
            save_state(state)
            print("\n=== RELEASE_READY ===")
            print(audit_text[-4000:])
            print("\nCredential/deploy status:\n" + credential_status())
            return 0

        event(state, f"round {round_no}: codex implementation")
        codex_ok, codex_out = run_codex(round_no, audit_text, verify_summary)
        (LOG_DIR / f"round_{round_no}_codex_tail.txt").write_text(codex_out)
        event(state, f"round {round_no}: codex_ok={codex_ok}")
        event(state, f"round {round_no}: post-codex git snapshot\n{git_snapshot(f'round_{round_no}_post_codex')}")

        event(state, f"round {round_no}: post-codex verification")
        post_ok, post_summary = verify()
        (LOG_DIR / f"round_{round_no}_post_verify_summary.txt").write_text(post_summary)
        event(state, f"round {round_no}: post_verify_ok={post_ok}")

        event(state, f"round {round_no}: post-codex fable audit")
        post_ready, post_decision, post_audit = run_fable_audit(round_no, post_summary, phase="post_codex")
        (LOG_DIR / f"round_{round_no}_post_fable_audit.txt").write_text(post_audit)
        state["last_decision"] = post_decision
        save_state(state)
        event(state, f"round {round_no}: post_fable_decision={post_decision}")

        if post_decision == "BLOCKED":
            state["status"] = "blocked"
            state["blocker"] = post_audit[-4000:]
            save_state(state)
            print("\n=== RELEASE LOOP BLOCKED ===\n" + post_audit[-4000:])
            return 2

        if post_ready and post_ok:
            state["status"] = "release_ready"
            state["completed_at"] = now()
            state["git_snapshot"] = git_snapshot("release_ready_post")
            save_state(state)
            print("\n=== RELEASE_READY ===")
            print(post_audit[-4000:])
            print("\nCredential/deploy status:\n" + credential_status())
            return 0

        time.sleep(2)

    state["status"] = "max_rounds_reached"
    state["completed_at"] = now()
    state["git_snapshot"] = git_snapshot("max_rounds")
    save_state(state)
    print("\n=== MAX_ROUNDS_REACHED ===")
    print(f"Reached {MAX_ROUNDS} rounds without release-ready convergence. Check logs: {LOG_DIR}")
    print("Credential/deploy status:\n" + credential_status())
    return 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.TimeoutExpired as e:
        print(f"TIMEOUT: {e}", file=sys.stderr)
        raise SystemExit(124)
