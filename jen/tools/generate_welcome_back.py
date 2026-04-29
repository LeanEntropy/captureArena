#!/usr/bin/env python3
"""
generate_welcome_back.py — build memory/welcome_back.md at session start.

Reads:
- last 5 entries from memory/timeline.jsonl
- pattern-detect output from timeline (recurring skills)
- last 3 high-confidence learnings from memory/learnings.jsonl

Writes a single short paragraph to memory/welcome_back.md that Jen loads on wake.
Run from the SessionStart hook.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TIMELINE_FILE = PROJECT_ROOT / "memory" / "timeline.jsonl"
LEARNINGS_FILE = PROJECT_ROOT / "memory" / "learnings.jsonl"
OUTPUT_FILE = PROJECT_ROOT / "memory" / "welcome_back.md"
ESSENTIAL_GENERATOR = PROJECT_ROOT / "tools" / "generate_essential.py"

TIMELINE_TAIL = 5
LEARNINGS_TOP = 3
PATTERN_WINDOW = 40
PATTERN_THRESHOLD = 3


def _read_jsonl_tail(path: Path, n: int) -> list[dict]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    out: list[dict] = []
    for line in lines[-n * 3 :]:  # oversample in case of decode errors
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out[-n:]


def _fmt_timeline_event(e: dict) -> str:
    ts = e.get("ts", "")[:10]
    skill = e.get("skill") or "-"
    summary = (e.get("summary") or "").strip()
    return f"- {ts} · {skill} · {summary}" if summary else f"- {ts} · {skill}"


def _detect_patterns() -> list[str]:
    """Shell out to timeline_cli to reuse its pattern detection."""
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(PROJECT_ROOT / "tools" / "timeline_cli.py"),
                "pattern-detect",
                "--window",
                str(PATTERN_WINDOW),
                "--threshold",
                str(PATTERN_THRESHOLD),
                "--json-out",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        patterns = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    return [f"{p['skill']} x{p['count']}" for p in patterns[:5]]


def _top_learnings() -> list[str]:
    """Shell out to learnings_cli search for the highest-confidence items."""
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(PROJECT_ROOT / "tools" / "learnings_cli.py"),
                "search",
                "--limit",
                str(LEARNINGS_TOP),
                "--min-confidence",
                "7",
                "--json-out",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        items = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    out: list[str] = []
    for item in items:
        key = item.get("key", "")
        insight = (item.get("insight") or "").strip()
        if key and insight:
            out.append(f"- [{key}] {insight}")
    return out


def build_welcome_back() -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    timeline = _read_jsonl_tail(TIMELINE_FILE, TIMELINE_TAIL)
    patterns = _detect_patterns()
    learnings = _top_learnings()

    lines: list[str] = []
    lines.append(f"# Welcome back")
    lines.append(f"*Generated {now}*")
    lines.append("")

    if timeline:
        lines.append("## Recent timeline")
        for e in timeline:
            lines.append(_fmt_timeline_event(e))
        lines.append("")
    else:
        lines.append("## Recent timeline")
        lines.append("- (empty — no timeline events yet)")
        lines.append("")

    if patterns:
        lines.append("## Patterns detected")
        lines.append("You've been running: " + ", ".join(patterns))
        lines.append("")

    if learnings:
        lines.append("## Top learnings")
        lines.extend(learnings)
        lines.append("")

    lines.append("---")
    lines.append("*This file is regenerated at every SessionStart. Do not edit by hand.*")
    return "\n".join(lines) + "\n"


def regenerate_essential() -> None:
    """Refresh memory/essential.md as part of the L1 wake-up layer."""
    if not ESSENTIAL_GENERATOR.exists():
        return
    try:
        subprocess.run(
            [sys.executable, str(ESSENTIAL_GENERATOR)],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return


def main() -> int:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Regenerate essential.md first so welcome-back reflects the freshest
    # curated view of the halls.
    regenerate_essential()
    OUTPUT_FILE.write_text(build_welcome_back(), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
