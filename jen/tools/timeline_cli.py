#!/usr/bin/env python3
"""
timeline_cli.py — append-only event stream for Jen's session timeline.

Storage: memory/timeline.jsonl

Schema per line:
    {
      "ts": ISO8601,
      "kind": str,          # skill_start | skill_end | gate | decision | discovery | custom
      "skill": str,          # skill name if applicable
      "summary": str,        # one-line human summary
      "meta": dict           # arbitrary tags
    }
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TIMELINE_FILE = PROJECT_ROOT / "memory" / "timeline.jsonl"

VALID_KINDS = {"skill_start", "skill_end", "gate", "decision", "discovery", "custom"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_file() -> None:
    TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    TIMELINE_FILE.touch(exist_ok=True)


def _read_all() -> list[dict]:
    if not TIMELINE_FILE.exists():
        return []
    out: list[dict] = []
    for line in TIMELINE_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def cmd_append(args: argparse.Namespace) -> int:
    _ensure_file()
    if args.kind not in VALID_KINDS:
        print(f"timeline_cli: kind must be one of {sorted(VALID_KINDS)}", file=sys.stderr)
        return 1
    try:
        meta = json.loads(args.meta) if args.meta else {}
    except json.JSONDecodeError as exc:
        print(f"timeline_cli: invalid --meta json: {exc}", file=sys.stderr)
        return 1
    entry = {
        "ts": _now_iso(),
        "kind": args.kind,
        "skill": args.skill or "",
        "summary": args.summary or "",
        "meta": meta,
    }
    with TIMELINE_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return 0


def cmd_last(args: argparse.Namespace) -> int:
    entries = _read_all()
    if args.kind:
        entries = [e for e in entries if e.get("kind") == args.kind]
    entries = entries[-args.limit :]
    if args.json_out:
        print(json.dumps(entries, indent=2, ensure_ascii=False))
        return 0
    for e in entries:
        ts = e.get("ts", "")[:19].replace("T", " ")
        skill = e.get("skill", "")
        tag = f"[{skill}] " if skill else ""
        print(f"{ts}  {e.get('kind', ''):<12}  {tag}{e.get('summary', '')}")
    return 0


def cmd_pattern_detect(args: argparse.Namespace) -> int:
    """
    Cheap pattern detector: find recurring (skill, kind) pairs in the tail.

    Purpose: feed welcome-back briefings with "you've run X three times this week"
    style signals and proactive-loop with "you keep doing Y" nudges.
    """
    entries = _read_all()
    tail = entries[-args.window :]
    counts: dict[tuple[str, str], int] = {}
    for e in tail:
        key = (e.get("skill", ""), e.get("kind", ""))
        counts[key] = counts.get(key, 0) + 1

    repeats = [
        (skill, kind, n)
        for (skill, kind), n in counts.items()
        if n >= args.threshold and skill
    ]
    repeats.sort(key=lambda r: r[2], reverse=True)

    if args.json_out:
        print(json.dumps(
            [{"skill": s, "kind": k, "count": n} for s, k, n in repeats],
            indent=2,
        ))
        return 0

    if not repeats:
        return 0
    print(f"Patterns in last {len(tail)} events (threshold {args.threshold}):")
    for skill, kind, n in repeats:
        print(f"  {skill:<24}  {kind:<12}  x{n}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Jen session timeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("append", help="append a timeline event")
    a.add_argument("--kind", required=True, choices=sorted(VALID_KINDS))
    a.add_argument("--skill")
    a.add_argument("--summary")
    a.add_argument("--meta", help="JSON object string")
    a.set_defaults(func=cmd_append)

    l = sub.add_parser("last", help="show tail of timeline")
    l.add_argument("--limit", type=int, default=10)
    l.add_argument("--kind", choices=sorted(VALID_KINDS))
    l.add_argument("--json-out", action="store_true")
    l.set_defaults(func=cmd_last)

    d = sub.add_parser("pattern-detect", help="detect recurring skill usage")
    d.add_argument("--window", type=int, default=50, help="events to scan from tail")
    d.add_argument("--threshold", type=int, default=3)
    d.add_argument("--json-out", action="store_true")
    d.set_defaults(func=cmd_pattern_detect)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
