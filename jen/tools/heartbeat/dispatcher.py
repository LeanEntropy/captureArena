"""
Dispatcher — reads backlog, picks eligible work, assembles prompt for proactive session.

No LLM calls. Pure Python. Zero tokens burned if no work available.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent.parent
BACKLOG_PATH = PROJECT_DIR / "docs" / "backlog.md"
STATE_PATH = SCRIPT_DIR / "state.json"
TEMPLATE_PATH = SCRIPT_DIR / "prompt_template.md"


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"items": {}, "consecutive_sessions_without_interaction": 0}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


def parse_backlog() -> list[dict]:
    """Parse backlog.md into structured items."""
    if not BACKLOG_PATH.exists():
        return []

    text = BACKLOG_PATH.read_text(encoding="utf-8")
    items = []
    current = None

    for line in text.splitlines():
        # Match item headers: ### RB-XXX: Title
        m = re.match(r"^### (RB-\d+):\s*(.+)", line)
        if m:
            if current:
                items.append(current)
            current = {"id": m.group(1), "title": m.group(2).strip(), "raw_lines": [line]}
            continue

        if current:
            current["raw_lines"].append(line)

            # Parse fields
            if line.startswith("- **Status:**"):
                status = line.split(":**")[1].strip().lower()
                # Extract just the status word (before any parenthetical)
                current["status"] = status.split("(")[0].strip().rstrip(")")
            elif line.startswith("- **Gate:**"):
                current["gate"] = line.split(":**")[1].strip().lower()
            elif line.startswith("- **Priority:**"):
                prio = line.split(":**")[1].strip()
                current["priority"] = prio.split()[0].upper()  # P0, P1, P2
            elif line.startswith("- **Description:**"):
                current["description"] = line.split(":**")[1].strip()
            elif line.startswith("- **Depends on:**"):
                deps = line.split(":**")[1].strip()
                current["depends_on"] = [d.strip() for d in deps.split(",") if d.strip()]
            elif line.startswith("- **Deliverable:**"):
                current["deliverable"] = line.split(":**")[1].strip()
            elif line.startswith("- **Acceptance:**"):
                current["acceptance"] = line.split(":**")[1].strip()

    if current:
        items.append(current)

    return items


def pick_work_item(state: dict) -> dict | None:
    """Pick the highest-priority eligible work item."""
    items = parse_backlog()
    done_ids = {i["id"] for i in items if i.get("status", "").startswith("done")}

    eligible = []
    for item in items:
        status = item.get("status", "")
        gate = item.get("gate", "none")
        item_id = item["id"]

        # Only pending or in-progress items
        if status not in ("pending", "in-progress"):
            continue

        # Check dependencies
        deps = item.get("depends_on", [])
        if deps and not all(d in done_ids for d in deps):
            continue

        # Check gate approval
        if gate in ("plan", "decision", "budget"):
            item_state = state.get("items", {}).get(item_id, {})
            if item_state.get("status") != "approved":
                continue

        eligible.append(item)

    if not eligible:
        return None

    # Sort by priority
    prio_order = {"P0": 0, "P1": 1, "P2": 2}
    eligible.sort(key=lambda i: prio_order.get(i.get("priority", "P2"), 2))

    return eligible[0]


def read_context_file(path: str, max_lines: int = 100) -> str:
    """Read a context file, truncated to max_lines."""
    p = PROJECT_DIR / path
    if not p.exists():
        return ""
    lines = p.read_text(encoding="utf-8").splitlines()
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    return "\n".join(lines)


def build_prompt(item: dict) -> str:
    """Assemble the full prompt for a proactive claude -p session."""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    today = datetime.now().strftime("%Y-%m-%d")

    context = {
        "memory_md": read_context_file("MEMORY.md"),
        "session_notes": read_context_file("docs/session-notes.md"),
        "daily_log": read_context_file(f"memory/{today}.md", max_lines=80),
        "recent_telegram": read_context_file("comms/telegram_log.md", max_lines=60),
        "task_id": item["id"],
        "task_title": item.get("title", ""),
        "task_description": item.get("description", ""),
        "task_deliverable": item.get("deliverable", ""),
        "task_acceptance": item.get("acceptance", ""),
        "task_raw": "\n".join(item.get("raw_lines", [])),
        "today": today,
    }

    for key, value in context.items():
        template = template.replace(f"{{{{{key}}}}}", value)

    return template


def dispatch() -> tuple[dict | None, str | None]:
    """Main dispatch: pick work and build prompt. Returns (item, prompt) or (None, None)."""
    state = load_state()

    # Check consecutive session cap
    max_consecutive = state.get("max_consecutive_sessions", 3)
    if state.get("consecutive_sessions_without_interaction", 0) >= max_consecutive:
        return None, None  # Paused until director interacts

    item = pick_work_item(state)
    if not item:
        return None, None

    prompt = build_prompt(item)
    return item, prompt


if __name__ == "__main__":
    item, prompt = dispatch()
    if item:
        print(f"Selected: {item['id']} — {item.get('title', '')}")
        print(f"Prompt length: {len(prompt)} chars")
    else:
        print("No eligible work items found.")
