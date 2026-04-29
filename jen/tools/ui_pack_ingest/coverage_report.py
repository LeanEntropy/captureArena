"""Quick coverage stats for an ingested pack."""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path


def report(pack_out: Path) -> None:
    comp_types: collections.Counter = collections.Counter()
    unknown_guids: collections.Counter = collections.Counter()
    totals = {"nodes": 0, "screens": 0, "max_depth": 0}

    def walk(n, depth=0):
        totals["nodes"] += 1
        if depth > totals["max_depth"]:
            totals["max_depth"] = depth
        for c in n.get("components", []):
            comp_types[c["type"]] += 1
            if c["type"] == "UnknownBehaviour":
                unknown_guids[c.get("script_guid") or "?"] += 1
        for ch in n.get("children", []):
            walk(ch, depth + 1)

    for p in sorted((pack_out / "screens").glob("*.json")):
        totals["screens"] += 1
        walk(json.loads(p.read_text(encoding="utf-8"))["root"])

    print(f"screens:   {totals['screens']}")
    print(f"nodes:     {totals['nodes']}")
    print(f"max depth: {totals['max_depth']}")
    print("component types:")
    for k, v in comp_types.most_common():
        print(f"  {v:6d}  {k}")
    print("unknown script guids (top 10):")
    for k, v in unknown_guids.most_common(10):
        print(f"  {v:6d}  {k}")


if __name__ == "__main__":
    report(Path(sys.argv[1]))
