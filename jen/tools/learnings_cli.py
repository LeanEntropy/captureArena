#!/usr/bin/env python3
"""
learnings_cli.py — append-only project learnings store for Jen.

Ported from gstack-learnings-log + gstack-learnings-search (Garry Tan, MIT),
rewritten in Python stdlib for Jen's project-scoped workflow.

Storage: memory/learnings.jsonl (project-local, append-only)

Schema per line (JSON):
    {
      "ts": ISO8601 timestamp,
      "skill": str,               # which skill/workflow produced this
      "type": str,                # pattern|pitfall|preference|architecture|tool|operational
      "key": str,                 # stable dedupe key (kebab-case)
      "insight": str,             # the learning itself, 1-3 sentences
      "confidence": int (0-10),   # initial confidence score
      "source": str,              # observed|inferred|user-supplied
      "files": [str]              # optional related file paths
    }

Dedup is at READ time: latest-winner per (key, type).
Decay is at READ time:
    observed     -1 pt per 30 days
    inferred     -1 pt per 15 days
    user-supplied no decay
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LEARNINGS_FILE = PROJECT_ROOT / "memory" / "learnings.jsonl"

VALID_TYPES = {"pattern", "pitfall", "preference", "architecture", "tool", "operational"}
VALID_SOURCES = {"observed", "inferred", "user-supplied"}

# Jen's domain taxonomy — adapted from Homunculus's 7 domains for an art-director agent.
# Used by the cluster detector (5+ learnings in a domain = evolution signal for proactive-loop).
VALID_DOMAINS = {
    "art-direction",   # palette, style, composition, cohesion, ART_ETHOS principles in practice
    "generation",      # ComfyUI workflows, model choices, prompt patterns, LoRA discipline
    "research",        # methodology, source evaluation, repo eval patterns
    "tooling",         # CLI, pipeline, file org, hooks, MCP, git workflow
    "communication",   # director dialogue, gate framing, Telegram, reporting shape
    "debugging",       # gen failures, pipeline issues, investigation patterns
    "process",         # session structure, skill creation, self-improvement habits
}

CLUSTER_THRESHOLD = 5  # 5+ learnings in a domain = evolution signal

DECAY_DAYS = {
    "observed": 30,
    "inferred": 15,
    "user-supplied": None,
}


@dataclass
class Learning:
    ts: str
    skill: str
    type: str
    key: str
    insight: str
    confidence: int = 5
    source: str = "observed"
    files: list[str] = field(default_factory=list)
    domain: str = ""  # optional — one of VALID_DOMAINS; empty = uncategorized

    @classmethod
    def from_dict(cls, d: dict) -> "Learning":
        return cls(
            ts=d.get("ts") or _now_iso(),
            skill=d.get("skill", "unknown"),
            type=d.get("type", "pattern"),
            key=d.get("key", ""),
            insight=d.get("insight", ""),
            confidence=int(d.get("confidence", 5)),
            source=d.get("source", "observed"),
            files=list(d.get("files") or []),
            domain=d.get("domain", ""),
        )

    def to_jsonl(self) -> str:
        out: dict = {
            "ts": self.ts,
            "skill": self.skill,
            "type": self.type,
            "key": self.key,
            "insight": self.insight,
            "confidence": self.confidence,
            "source": self.source,
            "files": self.files,
        }
        if self.domain:
            out["domain"] = self.domain
        return json.dumps(out, ensure_ascii=False)

    def effective_confidence(self, now: datetime | None = None) -> int:
        """Apply decay based on source + age."""
        decay_days = DECAY_DAYS.get(self.source)
        if decay_days is None:
            return self.confidence
        now = now or datetime.now(timezone.utc)
        try:
            entry_ts = datetime.fromisoformat(self.ts.replace("Z", "+00:00"))
        except ValueError:
            return self.confidence
        age_days = (now - entry_ts).days
        return max(0, self.confidence - (age_days // decay_days))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_file() -> None:
    LEARNINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    LEARNINGS_FILE.touch(exist_ok=True)


def _read_all() -> list[Learning]:
    if not LEARNINGS_FILE.exists():
        return []
    entries: list[Learning] = []
    for line in LEARNINGS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(Learning.from_dict(json.loads(line)))
        except (json.JSONDecodeError, ValueError):
            continue
    return entries


def _dedupe(entries: list[Learning]) -> list[Learning]:
    """Latest-winner per (key, type)."""
    seen: dict[tuple[str, str], Learning] = {}
    for e in entries:
        k = (e.key, e.type)
        if k not in seen or e.ts > seen[k].ts:
            seen[k] = e
    return list(seen.values())


def cmd_log(args: argparse.Namespace) -> int:
    _ensure_file()

    if args.json:
        try:
            payload = json.loads(args.json)
        except json.JSONDecodeError as exc:
            print(f"learnings_cli: invalid --json payload: {exc}", file=sys.stderr)
            return 1
    else:
        payload = {
            "skill": args.skill,
            "type": args.type,
            "key": args.key,
            "insight": args.insight,
            "confidence": args.confidence,
            "source": args.source,
            "domain": args.domain,
            "files": args.file or [],
        }

    if not payload.get("key"):
        print("learnings_cli: --key (or json.key) is required", file=sys.stderr)
        return 1
    if payload.get("type") not in VALID_TYPES:
        print(f"learnings_cli: type must be one of {sorted(VALID_TYPES)}", file=sys.stderr)
        return 1
    if payload.get("source") not in VALID_SOURCES:
        print(f"learnings_cli: source must be one of {sorted(VALID_SOURCES)}", file=sys.stderr)
        return 1
    domain = payload.get("domain", "")
    if domain and domain not in VALID_DOMAINS:
        print(f"learnings_cli: domain must be one of {sorted(VALID_DOMAINS)} (or omitted)", file=sys.stderr)
        return 1

    learning = Learning.from_dict(payload)
    if not learning.ts or args.fresh_ts:
        learning.ts = _now_iso()

    with LEARNINGS_FILE.open("a", encoding="utf-8") as f:
        f.write(learning.to_jsonl() + "\n")

    print(f"[V] logged learning [{learning.type}] {learning.key} (confidence {learning.confidence})")
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    entries = _dedupe(_read_all())
    if not entries:
        return 0

    now = datetime.now(timezone.utc)
    for e in entries:
        e.confidence = e.effective_confidence(now)

    if args.type:
        entries = [e for e in entries if e.type == args.type]

    if args.domain:
        entries = [e for e in entries if e.domain == args.domain]

    if args.query:
        q = args.query.lower()
        entries = [
            e for e in entries
            if q in e.key.lower()
            or q in e.insight.lower()
            or any(q in f.lower() for f in e.files)
        ]

    if args.min_confidence is not None:
        entries = [e for e in entries if e.confidence >= args.min_confidence]

    entries.sort(key=lambda e: (-e.confidence, e.ts), reverse=False)
    entries.sort(key=lambda e: (-e.confidence, e.ts))
    entries = entries[: args.limit]

    if args.json_out:
        print(json.dumps([e.__dict__ for e in entries], indent=2, ensure_ascii=False))
        return 0

    if not entries:
        return 0

    by_type: dict[str, list[Learning]] = {}
    for e in entries:
        by_type.setdefault(e.type, []).append(e)

    counts = ", ".join(f"{len(v)} {k}{'s' if len(v) != 1 else ''}" for k, v in by_type.items())
    print(f"LEARNINGS: {len(entries)} loaded ({counts})\n")
    for t, arr in by_type.items():
        print(f"## {t.title()}s")
        for e in arr:
            date = e.ts.split("T")[0]
            files = f" (files: {', '.join(e.files)})" if e.files else ""
            print(f"- [{e.key}] (confidence: {e.confidence}/10, {e.source}, {date})")
            print(f"  {e.insight}{files}")
        print()
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    """Drop zero-confidence observations older than --older-than days."""
    entries = _read_all()
    if not entries:
        return 0
    now = datetime.now(timezone.utc)
    kept: list[Learning] = []
    dropped = 0
    for e in entries:
        eff = e.effective_confidence(now)
        if eff == 0 and e.source != "user-supplied":
            dropped += 1
            continue
        kept.append(e)
    if args.dry_run:
        print(f"would drop {dropped} / {len(entries)} entries")
        return 0
    LEARNINGS_FILE.write_text("\n".join(e.to_jsonl() for e in kept) + ("\n" if kept else ""), encoding="utf-8")
    print(f"pruned {dropped} entries, {len(kept)} remain")
    return 0


def cmd_status(_: argparse.Namespace) -> int:
    entries = _read_all()
    if not entries:
        print("no learnings logged yet")
        return 0
    dedup = _dedupe(entries)
    by_type: dict[str, int] = {}
    by_source: dict[str, int] = {}
    by_domain: dict[str, int] = {}
    for e in dedup:
        by_type[e.type] = by_type.get(e.type, 0) + 1
        by_source[e.source] = by_source.get(e.source, 0) + 1
        if e.domain:
            by_domain[e.domain] = by_domain.get(e.domain, 0) + 1
    print(f"learnings.jsonl: {len(entries)} raw, {len(dedup)} after dedup")
    print(f"  by type:   {dict(sorted(by_type.items()))}")
    print(f"  by source: {dict(sorted(by_source.items()))}")
    if by_domain:
        print(f"  by domain: {dict(sorted(by_domain.items()))}")
    return 0


def cmd_clusters(args: argparse.Namespace) -> int:
    """Cluster detector: find domains with >=threshold learnings.

    This is the Homunculus evolution signal adapted for Jen's file-based store.
    When a domain accumulates enough learnings, proactive-loop surfaces it as
    a "maybe promote to a skill" signal.
    """
    entries = _dedupe(_read_all())
    now = datetime.now(timezone.utc)
    # Apply decay so zero-confidence stale entries don't inflate clusters
    active = [e for e in entries if e.effective_confidence(now) > 0 and e.domain]

    by_domain: dict[str, list[Learning]] = {}
    for e in active:
        by_domain.setdefault(e.domain, []).append(e)

    threshold = args.threshold or CLUSTER_THRESHOLD
    clusters = [
        (domain, items)
        for domain, items in by_domain.items()
        if len(items) >= threshold
    ]
    clusters.sort(key=lambda c: len(c[1]), reverse=True)

    if args.json_out:
        print(json.dumps([
            {
                "domain": domain,
                "count": len(items),
                "keys": [e.key for e in items],
                "top_key": max(items, key=lambda e: e.confidence).key if items else "",
            }
            for domain, items in clusters
        ], indent=2))
        return 0

    if not clusters:
        print(f"no domain has reached the cluster threshold ({threshold})")
        return 0

    print(f"CLUSTERS: {len(clusters)} domain(s) at or above threshold {threshold}")
    print()
    for domain, items in clusters:
        print(f"## {domain} ({len(items)})")
        for e in sorted(items, key=lambda x: -x.confidence):
            print(f"  - [{e.key}] conf {e.confidence}/10 ({e.source})")
        print()
    print("-> These are evolution candidates: consider promoting to a skill via skill-creator,")
    print("   or wiring into the next proactive-loop run as a high-priority signal.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Jen project learnings store")
    sub = p.add_subparsers(dest="cmd", required=True)

    log = sub.add_parser("log", help="append a learning")
    log.add_argument("--json", help="full learning as JSON string (overrides flags)")
    log.add_argument("--skill", default="unknown")
    log.add_argument("--type", default="pattern", choices=sorted(VALID_TYPES))
    log.add_argument("--key", help="stable kebab-case dedupe key")
    log.add_argument("--insight", default="")
    log.add_argument("--confidence", type=int, default=5)
    log.add_argument("--source", default="observed", choices=sorted(VALID_SOURCES))
    log.add_argument("--domain", default="", choices=sorted(VALID_DOMAINS) + [""],
                     help="Jen domain taxonomy; empty = uncategorized")
    log.add_argument("--file", action="append", help="related file (repeatable)")
    log.add_argument("--fresh-ts", action="store_true", help="force a fresh timestamp")
    log.set_defaults(func=cmd_log)

    s = sub.add_parser("search", help="read + decay + dedup")
    s.add_argument("--type", choices=sorted(VALID_TYPES))
    s.add_argument("--domain", choices=sorted(VALID_DOMAINS))
    s.add_argument("--query", help="substring match on key/insight/files")
    s.add_argument("--min-confidence", type=int)
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--json-out", action="store_true")
    s.set_defaults(func=cmd_search)

    pr = sub.add_parser("prune", help="drop zero-confidence observations")
    pr.add_argument("--dry-run", action="store_true")
    pr.set_defaults(func=cmd_prune)

    st = sub.add_parser("status", help="show store stats")
    st.set_defaults(func=cmd_status)

    cl = sub.add_parser("clusters", help="find domains with >=threshold learnings (evolution signal)")
    cl.add_argument("--threshold", type=int, help=f"cluster size (default {CLUSTER_THRESHOLD})")
    cl.add_argument("--json-out", action="store_true")
    cl.set_defaults(func=cmd_clusters)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
