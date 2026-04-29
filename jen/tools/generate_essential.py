#!/usr/bin/env python3
"""
generate_essential.py — build memory/essential.md from the halls.

Scores every hall entry (and any structured memory file with the hall frontmatter
contract) by:

    score = importance × recency × recall_factor

Where:
    importance   = confidence / 10            (0.0–1.0)
    recency      = max(0.1, 1 - age_days/90)  (decays to 0.1 over 90 days)
    recall_factor = 1.0                        (placeholder; future: count timeline mentions)

Picks the top entries until the total character budget (MAX_CHARS) is hit,
then writes them into memory/essential.md grouped by hall. This is the L1
"essential memory" tier — small enough to load at every wake, curated enough
to carry real signal.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HALLS_DIR = PROJECT_ROOT / "memory" / "halls"
OUTPUT_FILE = PROJECT_ROOT / "memory" / "essential.md"

MAX_CHARS = 3200
MAX_ENTRIES = 15
HALL_ORDER = ["facts", "preferences", "discoveries", "advice", "events"]


@dataclass
class Entry:
    path: Path
    hall: str
    key: str
    title: str
    body: str
    confidence: int
    last_verified: date | None
    score: float


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Very small YAML-ish frontmatter parser — no pyyaml dep."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    meta: dict = {}
    for line in raw.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        # strip optional surrounding quotes
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        meta[k.strip()] = v
    return meta, body


def parse_date(s: str) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def extract_title(body: str, fallback: str) -> str:
    for line in body.splitlines():
        line = line.strip()
        if line.startswith("#"):
            return line.lstrip("#").strip()
    return fallback


def compact_body(body: str, max_chars: int = 350) -> str:
    """Strip the first heading line and truncate to max_chars for the summary view."""
    lines = body.splitlines()
    # drop leading empty lines and the first heading
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].lstrip().startswith("#"):
        i += 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    trimmed = "\n".join(lines[i:]).strip()
    # prefer the first paragraph
    first_para = re.split(r"\n\s*\n", trimmed, maxsplit=1)[0].strip()
    if len(first_para) > max_chars:
        first_para = first_para[: max_chars - 1].rstrip() + "…"
    return first_para


def score_entry(confidence: int, last_verified: date | None) -> float:
    importance = max(0.0, min(confidence, 10)) / 10.0
    if last_verified is None:
        recency = 0.5
    else:
        age_days = (date.today() - last_verified).days
        recency = max(0.1, 1.0 - (age_days / 90.0))
    return importance * recency * 1.0  # recall_factor placeholder


def load_entries() -> list[Entry]:
    entries: list[Entry] = []
    if not HALLS_DIR.exists():
        return entries
    for path in sorted(HALLS_DIR.rglob("*.md")):
        if path.name == "README.md":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, body = parse_frontmatter(text)
        if not meta.get("hall"):
            continue
        hall = meta.get("hall", "").strip()
        key = meta.get("key", path.stem)
        title = extract_title(body, key)
        confidence_raw = meta.get("confidence", "5")
        try:
            confidence = int(confidence_raw)
        except ValueError:
            confidence = 5
        last_verified = parse_date(meta.get("last_verified", ""))
        score = score_entry(confidence, last_verified)
        entries.append(Entry(
            path=path,
            hall=hall,
            key=key,
            title=title,
            body=body,
            confidence=confidence,
            last_verified=last_verified,
            score=score,
        ))
    return entries


def pick_top(entries: list[Entry]) -> list[Entry]:
    entries.sort(key=lambda e: e.score, reverse=True)
    picked: list[Entry] = []
    total = 0
    for entry in entries:
        if len(picked) >= MAX_ENTRIES:
            break
        size = len(entry.key) + len(entry.title) + len(compact_body(entry.body))
        if total + size > MAX_CHARS:
            continue
        picked.append(entry)
        total += size
    return picked


def render(picked: list[Entry]) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = [
        "# Essential memory",
        f"*Regenerated {now} — top {len(picked)} entries from halls, budget {MAX_CHARS} chars*",
        "",
        "This is the L1 curated view of long-lived project knowledge. It is regenerated at session start. For the full halls, search memory/halls/.",
        "",
    ]
    by_hall: dict[str, list[Entry]] = {}
    for e in picked:
        by_hall.setdefault(e.hall, []).append(e)

    for hall in HALL_ORDER:
        if hall not in by_hall:
            continue
        lines.append(f"## {hall.title()}")
        for entry in by_hall[hall]:
            lv = entry.last_verified.isoformat() if entry.last_verified else "—"
            lines.append(f"### [{entry.key}] {entry.title}")
            lines.append(f"*conf {entry.confidence}/10 · verified {lv} · score {entry.score:.2f}*")
            lines.append("")
            lines.append(compact_body(entry.body))
            lines.append("")
    # any halls not in HALL_ORDER
    for hall, hall_entries in by_hall.items():
        if hall in HALL_ORDER:
            continue
        lines.append(f"## {hall.title()}")
        for entry in hall_entries:
            lv = entry.last_verified.isoformat() if entry.last_verified else "—"
            lines.append(f"### [{entry.key}] {entry.title}")
            lines.append(f"*conf {entry.confidence}/10 · verified {lv} · score {entry.score:.2f}*")
            lines.append("")
            lines.append(compact_body(entry.body))
            lines.append("")

    if not picked:
        lines.append("*(halls are empty — nothing to promote to essential yet)*")
        lines.append("")

    lines.append("---")
    lines.append("*Generated by tools/generate_essential.py. Do not edit by hand.*")
    return "\n".join(lines) + "\n"


def main() -> int:
    entries = load_entries()
    picked = pick_top(entries)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(render(picked), encoding="utf-8")
    print(f"essential.md: {len(picked)} entries selected from {len(entries)} candidates")
    return 0


if __name__ == "__main__":
    sys.exit(main())
