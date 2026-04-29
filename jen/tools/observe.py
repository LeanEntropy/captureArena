#!/usr/bin/env python3
"""
observe.py — raw observation capture for Jen's learning loop.

Ported from Homunculus `plugins/homunculus/scripts/observe.sh` (MIT) with
ECC's secret-scrubbing regex lifted in. Rewritten in Python stdlib for the
file-based, no-deps Jen stack.

Called from Claude Code hooks. Reads hook JSON payload on stdin, appends a
sanitized observation to memory/observations.jsonl.

Event types:
    prompt — UserPromptSubmit    → capture user intent (truncated)
    tool   — PostToolUse         → capture tool name + scrubbed input/response
    stop   — Stop (turn end)     → capture session counter beat
    custom — anything else       → raw with type tag

**Always exits 0** — observer must never block or fail the session.

Usage:
    # From a hook command:
    python tools/observe.py prompt < hook_input.json
    python tools/observe.py tool   < hook_input.json
    python tools/observe.py stop   < hook_input.json
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OBSERVATIONS_FILE = PROJECT_ROOT / "memory" / "observations.jsonl"

PROMPT_MAX_CHARS = 500
RESPONSE_MAX_CHARS = 1000
INPUT_MAX_CHARS = 800

# Secret-scrubbing regex lifted from ECC's continuous-learning-v2/hooks/observe.sh
# (AGPL-ish region, MIT license; 10 lines). Catches the common key/value patterns.
_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization|credentials?|auth)"
    r"""(["'\s:=]+)"""
    r"([A-Za-z]+\s+)?"
    r"([A-Za-z0-9_\-/.+=]{8,})"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def scrub(val: object) -> object:
    """Recursively scrub secrets from strings, dicts, and lists. Non-destructive."""
    if val is None:
        return None
    if isinstance(val, str):
        return _SECRET_RE.sub(
            lambda m: m.group(1) + m.group(2) + (m.group(3) or "") + "[REDACTED]",
            val,
        )
    if isinstance(val, dict):
        return {k: scrub(v) for k, v in val.items()}
    if isinstance(val, list):
        return [scrub(x) for x in val]
    return val


def truncate(s: str | None, limit: int) -> str:
    if not s:
        return ""
    s = str(s)
    if len(s) <= limit:
        return s
    return s[: limit - 1] + "…"


def read_stdin_json() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw}


def build_prompt_observation(payload: dict) -> dict | None:
    prompt = payload.get("prompt") or ""
    if not prompt:
        return None
    return {
        "ts": _now_iso(),
        "type": "prompt",
        "prompt": truncate(scrub(prompt), PROMPT_MAX_CHARS),
    }


def build_tool_observation(payload: dict) -> dict | None:
    tool_name = payload.get("tool_name") or ""
    if not tool_name:
        return None
    tool_input = payload.get("tool_input") or {}
    tool_response = payload.get("tool_response") or {}

    obs: dict = {
        "ts": _now_iso(),
        "type": "tool",
        "tool": tool_name,
    }

    # Scrub and truncate input
    scrubbed_input = scrub(tool_input)
    try:
        input_str = json.dumps(scrubbed_input, ensure_ascii=False)
    except (TypeError, ValueError):
        input_str = str(scrubbed_input)
    obs["input"] = truncate(input_str, INPUT_MAX_CHARS)

    # Scrub and truncate response
    scrubbed_response = scrub(tool_response)
    try:
        response_str = json.dumps(scrubbed_response, ensure_ascii=False)
    except (TypeError, ValueError):
        response_str = str(scrubbed_response)
    obs["response"] = truncate(response_str, RESPONSE_MAX_CHARS)

    return obs


def build_stop_observation(payload: dict) -> dict:
    return {
        "ts": _now_iso(),
        "type": "stop",
        "stop_hook_active": bool(payload.get("stop_hook_active")),
    }


def build_custom_observation(event_type: str, payload: dict) -> dict:
    return {
        "ts": _now_iso(),
        "type": event_type or "custom",
        "raw": truncate(json.dumps(scrub(payload), ensure_ascii=False), INPUT_MAX_CHARS),
    }


def append_observation(obs: dict) -> None:
    OBSERVATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OBSERVATIONS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obs, ensure_ascii=False) + "\n")


def main() -> int:
    # Always exit 0 — never block the session on observer failure.
    try:
        event_type = sys.argv[1] if len(sys.argv) > 1 else "unknown"
        payload = read_stdin_json()

        if event_type == "prompt":
            obs = build_prompt_observation(payload)
        elif event_type == "tool":
            obs = build_tool_observation(payload)
        elif event_type == "stop":
            obs = build_stop_observation(payload)
        else:
            obs = build_custom_observation(event_type, payload)

        if obs is not None:
            append_observation(obs)
    except Exception:  # noqa: BLE001 — observer is non-blocking by design
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
