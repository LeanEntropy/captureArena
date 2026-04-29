#!/usr/bin/env python3
"""
observations_cli.py — inspect and manage the raw observation stream.

The observation stream (memory/observations.jsonl) is the append-only log
written by tools/observe.py from Claude Code hooks. It is the raw tier:
every prompt, every tool use, every stop event.

Curation happens in two steps:
    raw observations → (distill) → learnings.jsonl → (promote) → hall entries

This CLI gives Jen (and the Director) tools to inspect the raw tier,
archive old content, and spot candidate learnings before they're distilled.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OBS_FILE = PROJECT_ROOT / "memory" / "observations.jsonl"
ARCHIVE_FILE = PROJECT_ROOT / "memory" / "observations.archive.jsonl"

VALID_TYPES = {"prompt", "tool", "stop", "custom", "unknown"}


def _read_all(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _fmt_ts(ts: str) -> str:
    return (ts or "")[:19].replace("T", " ")


def _fmt_obs(obs: dict, wide: bool = False) -> str:
    ts = _fmt_ts(obs.get("ts", ""))
    t = obs.get("type", "?")
    if t == "prompt":
        body = obs.get("prompt", "")
        if not wide and len(body) > 100:
            body = body[:99] + "…"
        return f"{ts}  prompt  {body}"
    if t == "tool":
        tool = obs.get("tool", "?")
        inp = obs.get("input", "")
        if not wide and len(inp) > 80:
            inp = inp[:79] + "…"
        return f"{ts}  tool    {tool:<14}  {inp}"
    if t == "stop":
        return f"{ts}  stop"
    return f"{ts}  {t:<7} {json.dumps(obs, ensure_ascii=False)[:200]}"


def cmd_status(_: argparse.Namespace) -> int:
    entries = _read_all(OBS_FILE)
    if not entries:
        print("no observations logged yet")
        if OBS_FILE.exists():
            print(f"  file exists but is empty: {OBS_FILE}")
        return 0
    by_type: dict[str, int] = {}
    by_tool: dict[str, int] = {}
    for e in entries:
        t = e.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
        if t == "tool":
            tool = e.get("tool", "unknown")
            by_tool[tool] = by_tool.get(tool, 0) + 1

    size_kb = OBS_FILE.stat().st_size / 1024
    first_ts = entries[0].get("ts", "")
    last_ts = entries[-1].get("ts", "")

    print(f"observations.jsonl: {len(entries)} events, {size_kb:.1f} KB")
    print(f"  range: {_fmt_ts(first_ts)} -> {_fmt_ts(last_ts)}")
    print(f"  by type: {dict(sorted(by_type.items()))}")
    if by_tool:
        top_tools = dict(sorted(by_tool.items(), key=lambda kv: -kv[1])[:8])
        print(f"  top tools: {top_tools}")

    archive_entries = _read_all(ARCHIVE_FILE)
    if archive_entries:
        print(f"  archive: {len(archive_entries)} events in observations.archive.jsonl")
    return 0


def cmd_tail(args: argparse.Namespace) -> int:
    entries = _read_all(OBS_FILE)
    if args.type:
        entries = [e for e in entries if e.get("type") == args.type]
    if args.tool:
        entries = [e for e in entries if e.get("tool") == args.tool]
    entries = entries[-args.limit:]
    if args.json_out:
        print(json.dumps(entries, indent=2, ensure_ascii=False))
        return 0
    for e in entries:
        print(_fmt_obs(e, wide=args.wide))
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    entries = _read_all(OBS_FILE)
    q = (args.query or "").lower()
    matches = []
    for e in entries:
        if args.type and e.get("type") != args.type:
            continue
        if args.tool and e.get("tool") != args.tool:
            continue
        if q:
            blob = json.dumps(e, ensure_ascii=False).lower()
            if q not in blob:
                continue
        matches.append(e)
    matches = matches[-args.limit:]
    if args.json_out:
        print(json.dumps(matches, indent=2, ensure_ascii=False))
        return 0
    for e in matches:
        print(_fmt_obs(e, wide=args.wide))
    print(f"\n{len(matches)} match(es)")
    return 0


def cmd_archive(args: argparse.Namespace) -> int:
    """Move observations older than --older-than-days to the archive file."""
    entries = _read_all(OBS_FILE)
    if not entries:
        return 0
    now = datetime.now(timezone.utc)
    cutoff_days = args.older_than_days
    kept: list[dict] = []
    archived: list[dict] = []
    for e in entries:
        ts_raw = e.get("ts", "")
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except ValueError:
            kept.append(e)
            continue
        age_days = (now - ts).days
        if age_days > cutoff_days:
            archived.append(e)
        else:
            kept.append(e)

    if args.dry_run:
        print(f"would archive {len(archived)} / {len(entries)} observations older than {cutoff_days}d")
        return 0

    if archived:
        ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with ARCHIVE_FILE.open("a", encoding="utf-8") as f:
            for e in archived:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        OBS_FILE.write_text(
            "\n".join(json.dumps(e, ensure_ascii=False) for e in kept) + ("\n" if kept else ""),
            encoding="utf-8",
        )
    print(f"archived {len(archived)} / {len(entries)} observations older than {cutoff_days}d; {len(kept)} active")
    return 0


def cmd_clear(args: argparse.Namespace) -> int:
    """Danger: truncate the observation stream. Use with --confirm only."""
    if not args.confirm:
        print("observations_cli clear: requires --confirm (destructive)")
        return 1
    if OBS_FILE.exists():
        OBS_FILE.write_text("", encoding="utf-8")
    print("observations.jsonl cleared")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Jen observation stream inspector")
    sub = p.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("status", help="counts and recent activity")
    st.set_defaults(func=cmd_status)

    t = sub.add_parser("tail", help="show the last N observations")
    t.add_argument("--limit", type=int, default=20)
    t.add_argument("--type", choices=sorted(VALID_TYPES))
    t.add_argument("--tool", help="filter to a specific tool name")
    t.add_argument("--wide", action="store_true", help="do not truncate long bodies")
    t.add_argument("--json-out", action="store_true")
    t.set_defaults(func=cmd_tail)

    s = sub.add_parser("search", help="substring search across observations")
    s.add_argument("--query")
    s.add_argument("--type", choices=sorted(VALID_TYPES))
    s.add_argument("--tool")
    s.add_argument("--limit", type=int, default=50)
    s.add_argument("--wide", action="store_true")
    s.add_argument("--json-out", action="store_true")
    s.set_defaults(func=cmd_search)

    a = sub.add_parser("archive", help="move old observations to archive file")
    a.add_argument("--older-than-days", type=int, default=14)
    a.add_argument("--dry-run", action="store_true")
    a.set_defaults(func=cmd_archive)

    c = sub.add_parser("clear", help="truncate observations.jsonl (destructive, needs --confirm)")
    c.add_argument("--confirm", action="store_true")
    c.set_defaults(func=cmd_clear)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
