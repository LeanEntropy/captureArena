"""
Postprocessor — parses Claude output from proactive sessions,
sends Telegram notifications, updates state.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent.parent
STATE_PATH = SCRIPT_DIR / "state.json"
BOT_SCRIPT = PROJECT_DIR / "tools" / "telegram_bot" / "jen_bot.py"
AFK_FILE = PROJECT_DIR / "comms" / ".afk_status"


def is_afk() -> bool:
    """Check if the director is AFK (Telegram is the active channel)."""
    return AFK_FILE.exists() and AFK_FILE.read_text(encoding="utf-8").strip() == "afk"


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"items": {}}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


def parse_epilogue(output: str) -> dict | None:
    """Extract the HEARTBEAT_EPILOGUE JSON from Claude's output."""
    match = re.search(
        r"<!--\s*HEARTBEAT_EPILOGUE\s*\n(.*?)\n\s*-->",
        output,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def send_telegram(message: str) -> None:
    """Push a message to Telegram via the bot. Only sends if director is AFK."""
    if not is_afk():
        return
    if BOT_SCRIPT.exists():
        subprocess.run(
            [sys.executable, str(BOT_SCRIPT), "--push", message],
            timeout=30,
        )


def send_telegram_image(path: str, caption: str) -> None:
    """Send an image to Telegram via the bot. Only sends if director is AFK."""
    if not is_afk():
        return
    if BOT_SCRIPT.exists():
        subprocess.run(
            [sys.executable, str(BOT_SCRIPT), "--image", path, caption],
            timeout=30,
        )


def process(output: str, task_id: str) -> None:
    """Process Claude output from a proactive session."""
    state = load_state()
    now = datetime.now(timezone.utc).isoformat()

    epilogue = parse_epilogue(output)

    if epilogue:
        status = epilogue.get("status", "error")
        summary = epilogue.get("summary", "No summary provided.")
        next_rec = epilogue.get("next_recommendation", "")
        gate_req = epilogue.get("gate_request")
        files = epilogue.get("files_changed", [])
        images = epilogue.get("images_generated", [])

        # Update state
        if "items" not in state:
            state["items"] = {}
        state["items"][task_id] = {
            "status": "awaiting_approval" if status == "gate_hit" else status,
            "last_session": now,
            "summary": summary,
        }

        if gate_req:
            state["items"][task_id]["gate_request"] = gate_req

        # Build Telegram message
        status_emoji = {
            "completed": "[DONE]",
            "in_progress": "[IN PROGRESS]",
            "gate_hit": "[GATE - NEED YOUR INPUT]",
            "blocked": "[BLOCKED]",
            "error": "[ERROR]",
        }

        msg = f"*Proactive Session Report*\n\n"
        msg += f"*{task_id}*: {status_emoji.get(status, status)}\n\n"
        msg += f"{summary}\n"

        if gate_req:
            msg += f"\n*Gate ({gate_req.get('type', 'unknown')}):*\n"
            msg += f"{gate_req.get('question', '')}\n\n"
            if gate_req.get("options"):
                for i, opt in enumerate(gate_req["options"], 1):
                    msg += f"{i}. {opt}\n"
            if gate_req.get("recommendation"):
                msg += f"\n*My recommendation:* {gate_req['recommendation']}\n"
            if gate_req.get("context"):
                msg += f"\n_{gate_req['context']}_\n"
            msg += "\nReply with your decision or ask me questions about this."

        if next_rec:
            msg += f"\n\n*Next:* {next_rec}"

        if files:
            msg += f"\n\n*Files changed:* {', '.join(files)}"

        send_telegram(msg)

        # Send any generated images
        for img_path in images:
            full_path = PROJECT_DIR / img_path
            if full_path.exists():
                send_telegram_image(str(full_path), f"Generated: {img_path}")

    else:
        # No epilogue found — send truncated output as fallback
        truncated = output[-500:] if len(output) > 500 else output
        msg = f"*Proactive Session Report*\n\n"
        msg += f"*{task_id}*: [NO STRUCTURED OUTPUT]\n\n"
        msg += f"Session completed but no epilogue block found. Last output:\n\n"
        msg += f"_{truncated}_"

        state.setdefault("items", {})[task_id] = {
            "status": "error",
            "last_session": now,
            "summary": "No epilogue in output",
        }

        send_telegram(msg)

    # Update session counters
    state["last_heartbeat"] = now
    state["consecutive_sessions_without_interaction"] = (
        state.get("consecutive_sessions_without_interaction", 0) + 1
    )

    # Track daily sessions
    today = datetime.now().strftime("%Y-%m-%d")
    daily = state.get("daily_sessions", {})
    if today not in daily:
        daily[today] = {"count": 0, "approx_tokens": 0}
    daily[today]["count"] += 1
    daily[today]["approx_tokens"] += len(output)  # rough approximation
    state["daily_sessions"] = daily

    save_state(state)


if __name__ == "__main__":
    # For testing: python postprocess.py <task_id> < output.txt
    if len(sys.argv) >= 2:
        task_id = sys.argv[1]
        output = sys.stdin.read()
        process(output, task_id)
    else:
        print("Usage: python postprocess.py <task_id> < output.txt")
