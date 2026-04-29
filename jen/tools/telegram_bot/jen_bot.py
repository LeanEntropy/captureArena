"""
Jen Telegram Bot — Remote channel to the Gen AI Art Director.

Operates in two modes based on AFK status:

1. **Relay mode** (director NOT AFK = CLI session active):
   - Writes director messages to comms/.telegram_pending
   - Sends a short acknowledgment on Telegram
   - The CLI session's PostToolUse hook picks up pending messages
     and injects them into the active conversation
   - Jen replies via the CLI session using --push

2. **Standalone mode** (director IS AFK = no CLI session):
   - Spawns its own Claude session via `claude -p`
   - Full conversation with context, same as before

This makes Telegram "another input method" for the active CLI session.

Usage:
    1. Copy .env.example to .env and fill in your tokens
    2. pip install requests python-dotenv
    3. python jen_bot.py
"""

import subprocess
import requests
import time
import sys
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

# --- CONFIG ---
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent.parent  # tools/telegram_bot/../../ = project root
ENV_PATH = SCRIPT_DIR / ".env"

load_dotenv(ENV_PATH)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
CLAUDE_TIMEOUT = int(os.getenv("CLAUDE_TIMEOUT", "600"))  # 10 min default
CLAUDE_BYPASS_PERMISSIONS = os.getenv("CLAUDE_BYPASS_PERMISSIONS", "true").lower() in ("true", "1", "yes")
LOG_FILE = PROJECT_DIR / "comms" / "telegram_log.md"
PENDING_FILE = PROJECT_DIR / "comms" / ".telegram_pending"
AFK_FILE = PROJECT_DIR / "comms" / ".afk_status"
MAX_LOG_LINES = 150  # rolling window of conversation context

if not TOKEN or not CHAT_ID:
    print("ERROR: Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
    sys.exit(1)

# --- AFK STATUS ---

def is_afk():
    """Check if the director is AFK (Telegram is the active channel)."""
    return AFK_FILE.exists() and AFK_FILE.read_text(encoding="utf-8").strip() == "afk"


def set_afk(active):
    """Set or clear AFK status."""
    AFK_FILE.parent.mkdir(parents=True, exist_ok=True)
    if active:
        AFK_FILE.write_text("afk", encoding="utf-8")
    elif AFK_FILE.exists():
        AFK_FILE.unlink()


# --- TELEGRAM API ---

def send_telegram(text, parse_mode="Markdown"):
    """Send message to director, chunking if needed. Falls back to plain text on parse error."""
    chunks = []
    for i in range(0, max(1, len(text)), 4000):
        chunks.append(text[i:i + 4000])

    for chunk in chunks:
        resp = requests.post(
            f"https://api.telegram.org/bot{TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": chunk, "parse_mode": parse_mode},
            timeout=10,
        )
        # If markdown parsing fails, retry as plain text
        if not resp.json().get("ok") and parse_mode == "Markdown":
            requests.post(
                f"https://api.telegram.org/bot{TOKEN}/sendMessage",
                json={"chat_id": CHAT_ID, "text": chunk},
                timeout=10,
            )


def send_image(image_path, caption=None):
    """Send an image to the director via Telegram."""
    p = Path(image_path)
    if not p.exists():
        send_telegram(f"_Could not send image: {image_path} not found_")
        return False
    try:
        data = {"chat_id": CHAT_ID}
        if caption:
            data["caption"] = caption[:1024]  # Telegram caption limit
            data["parse_mode"] = "Markdown"
        with open(p, "rb") as f:
            resp = requests.post(
                f"https://api.telegram.org/bot{TOKEN}/sendPhoto",
                data=data,
                files={"photo": (p.name, f, "image/png")},
                timeout=30,
            )
        return resp.json().get("ok", False)
    except Exception as e:
        send_telegram(f"_Error sending image: {e}_")
        return False


def send_document(file_path, caption=None):
    """Send a file/document to the director via Telegram (for large or non-image files)."""
    p = Path(file_path)
    if not p.exists():
        send_telegram(f"_Could not send file: {file_path} not found_")
        return False
    try:
        data = {"chat_id": CHAT_ID}
        if caption:
            data["caption"] = caption[:1024]
        with open(p, "rb") as f:
            resp = requests.post(
                f"https://api.telegram.org/bot{TOKEN}/sendDocument",
                data=data,
                files={"document": (p.name, f)},
                timeout=60,
            )
        return resp.json().get("ok", False)
    except Exception as e:
        send_telegram(f"_Error sending file: {e}_")
        return False


def send_typing():
    """Show typing indicator in Telegram."""
    try:
        requests.post(
            f"https://api.telegram.org/bot{TOKEN}/sendChatAction",
            json={"chat_id": CHAT_ID, "action": "typing"},
            timeout=5,
        )
    except Exception:
        pass


# --- CONVERSATION LOG ---

def ensure_log():
    """Create comms directory and log file if they don't exist."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not LOG_FILE.exists():
        LOG_FILE.write_text(
            "# Telegram Conversation Log\n\n"
            "> Rolling log of Telegram exchanges with Jen.\n"
            "> Loaded as context for each Telegram message.\n"
            "> Trimmed to last ~150 lines automatically.\n\n"
        )


def append_log(role, message, write_pending=True):
    """Append a message to the conversation log and optionally the pending queue.

    Args:
        role: "Director" or "Jen"
        message: The message text
        write_pending: If True, also write to .telegram_pending for CLI hook pickup.
                       Set to False for Jen's own responses (to avoid feedback loops
                       where the CLI hook re-injects Jen's reply back into context).
    """
    ensure_log()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = f"**[{role} | {timestamp}]**\n{message.strip()}\n\n"

    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry)

    # Write to pending queue for CLI session visibility (director messages only)
    if write_pending:
        with open(PENDING_FILE, "a", encoding="utf-8") as f:
            f.write(entry)

    trim_log()


def trim_log():
    """Keep log under MAX_LOG_LINES."""
    lines = LOG_FILE.read_text(encoding="utf-8").splitlines()
    if len(lines) > MAX_LOG_LINES:
        # Keep header (first 5 lines) + tail
        header = lines[:5]
        tail = lines[-(MAX_LOG_LINES - 5):]
        LOG_FILE.write_text("\n".join(header + ["", "_(older messages trimmed)_", ""] + tail) + "\n", encoding="utf-8")


def get_recent_log():
    """Get recent conversation log for context injection."""
    ensure_log()
    return LOG_FILE.read_text(encoding="utf-8")


# --- GATE CONTEXT ---

def get_pending_gates():
    """Check heartbeat state for any pending approval gates."""
    state_path = PROJECT_DIR / "tools" / "heartbeat" / "state.json"
    if not state_path.exists():
        return ""
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        pending = []
        for task_id, info in state.get("items", {}).items():
            if info.get("status") == "awaiting_approval":
                gate = info.get("gate_request", {})
                pending.append(f"PENDING GATE on {task_id}: {gate.get('question', 'Awaiting approval')}")
                if gate.get("options"):
                    for i, opt in enumerate(gate["options"], 1):
                        pending.append(f"  {i}. {opt}")
                if gate.get("recommendation"):
                    pending.append(f"  Recommendation: {gate['recommendation']}")
        if pending:
            return "\n\nPENDING APPROVAL GATES (from proactive sessions):\n" + "\n".join(pending) + "\n\nIf the director is responding to a gate, help them decide. When they make a clear decision, include this marker in your response: GATE_RESOLVED:{task_id}:{decision_summary}\n"
        return ""
    except Exception:
        return ""


# --- CLAUDE CODE INTEGRATION ---

def ask_jen(message):
    """Send a message to Jen via Claude Code CLI with conversation context."""
    recent_log = get_recent_log()
    gate_context = get_pending_gates()

    # Build the prompt with conversation context
    prompt = f"""You are responding via Telegram to the project director.
This is an alternative communication channel — you are the same Jen as in the CLI.
Keep responses concise and mobile-friendly. Use short paragraphs.

Recent Telegram conversation for context:
---
{recent_log}
---
{gate_context}
Director's message: {message}"""

    try:
        cmd = ["claude", "-p", prompt]
        if CLAUDE_BYPASS_PERMISSIONS:
            cmd = ["claude", "-p", "--dangerously-skip-permissions", prompt]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(PROJECT_DIR),
            timeout=CLAUDE_TIMEOUT,
        )
        output = result.stdout.strip()
        if result.returncode != 0 and result.stderr:
            stderr_snippet = result.stderr.strip()[:500]
            output += f"\n\n_stderr: {stderr_snippet}_"
        return output or "(no output from Jen)"
    except subprocess.TimeoutExpired:
        return "_Session timed out after {CLAUDE_TIMEOUT}s. Jen may still be working — check the CLI._"
    except FileNotFoundError:
        return "_Error: `claude` CLI not found in PATH._"
    except Exception as e:
        return f"_Error: {e}_"


# --- JEN-INITIATED MESSAGES ---

def jen_push(message):
    """Jen sends a message to the director unprompted.
    Call this from other scripts/hooks when Jen needs to notify the director.
    Does NOT write to pending queue — Jen's own messages don't need to be
    re-injected into the CLI session (she already knows what she said).

    Supports inline --image markers: text before the marker is sent as a message,
    then the image is sent via sendPhoto with any remaining text as caption.
    """
    import re
    append_log("Jen", message, write_pending=False)

    # Parse --image markers from the message
    image_pattern = re.compile(r'--image\s+(\S+)')
    match = image_pattern.search(message)

    if match:
        image_path = match.group(1)
        # Resolve relative paths against project root
        p = Path(image_path)
        if not p.is_absolute():
            p = PROJECT_DIR / image_path

        # Text before the --image marker becomes the caption
        caption = message[:match.start()].strip()
        # Text after the image path (if any)
        after = message[match.end():].strip()
        if after:
            caption = f"{caption}\n{after}".strip() if caption else after

        # Send text portion first if it's long, otherwise use as caption
        if len(caption) > 1024:
            send_telegram(caption)
            send_image(str(p))
        elif caption:
            send_image(str(p), caption)
        else:
            send_image(str(p))
    else:
        send_telegram(message)


# --- GATE RESOLUTION ---

def resolve_gate_if_present(response):
    """Check if Jen's response contains a gate resolution marker."""
    import re
    match = re.search(r"GATE_RESOLVED:(\S+):(.+)", response)
    if match:
        task_id = match.group(1)
        decision = match.group(2).strip()
        state_path = PROJECT_DIR / "tools" / "heartbeat" / "state.json"
        if state_path.exists():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                if task_id in state.get("items", {}):
                    state["items"][task_id]["status"] = "approved"
                    state["items"][task_id]["decision"] = decision
                    state["items"][task_id]["approved_at"] = datetime.now(timezone.utc).isoformat()
                    state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
                    print(f"  Gate resolved for {task_id}: {decision}")
            except Exception as e:
                print(f"  Error resolving gate: {e}")


def reset_interaction_counter():
    """Reset the consecutive sessions counter — director is actively interacting."""
    state_path = PROJECT_DIR / "tools" / "heartbeat" / "state.json"
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["consecutive_sessions_without_interaction"] = 0
            state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
        except Exception:
            pass


# --- BOT COMMANDS ---

def read_file_safe(path, max_lines=50):
    """Read a file, return last N lines or error message."""
    try:
        p = PROJECT_DIR / path
        lines = p.read_text(encoding="utf-8").splitlines()
        if len(lines) > max_lines:
            return "\n".join(lines[-max_lines:])
        return "\n".join(lines)
    except Exception as e:
        return f"_Could not read {path}: {e}_"


HELP_TEXT = """*Jen Bot — Commands*

`/status` — Current project status (session notes)
`/backlog` — Current sprint items
`/memory` — Permanent research facts
`/log` — Today's session log
`/help` — This message

Anything else → sent to Jen as conversation.

*Mode:* When a CLI session is active (not AFK), messages relay to the live session. When AFK, Jen responds directly."""


def handle_command(text):
    """Handle bot commands. Returns response or None if not a command."""
    cmd = text.strip().lower()

    if cmd == "/help":
        return HELP_TEXT

    if cmd == "/status":
        return f"*Session Notes*\n\n{read_file_safe('docs/session-notes.md')}"

    if cmd == "/backlog":
        return f"*Backlog (Active Sprint)*\n\n{read_file_safe('docs/backlog.md', max_lines=80)}"

    if cmd == "/memory":
        return f"*Research Memory*\n\n{read_file_safe('MEMORY.md')}"

    if cmd == "/log":
        today = datetime.now().strftime("%Y-%m-%d")
        return f"*Session Log {today}*\n\n{read_file_safe(f'memory/{today}.md')}"

    return None  # Not a command


# --- MAIN LOOP ---

def main():
    ensure_log()
    print(f"Jen Bot started. Project: {PROJECT_DIR}")
    print(f"Telegram Chat ID: {CHAT_ID}")
    print(f"Claude timeout: {CLAUDE_TIMEOUT}s")
    print("Waiting for messages...\n")

    mode = "standalone (AFK)" if is_afk() else "relay (CLI session active)"
    send_telegram(f"_Jen Bot online in {mode} mode. Send /help for commands._")

    offset = 0
    while True:
        try:
            r = requests.get(
                f"https://api.telegram.org/bot{TOKEN}/getUpdates",
                params={"offset": offset, "timeout": 30},
                timeout=35,
            ).json()

            for update in r.get("result", []):
                offset = update["update_id"] + 1
                msg = update.get("message", {})

                # Security: only respond to configured chat ID
                if str(msg.get("chat", {}).get("id")) != str(CHAT_ID):
                    continue

                text = msg.get("text", "").strip()
                if not text:
                    continue

                print(f"[{datetime.now().strftime('%H:%M:%S')}] Director: {text[:80]}")

                # Try as command first
                cmd_response = handle_command(text)
                if cmd_response:
                    send_telegram(cmd_response)
                    continue

                # Regular message → route based on mode
                append_log("Director", text)
                reset_interaction_counter()

                if is_afk():
                    # STANDALONE MODE: No CLI session active, spawn own Claude
                    print(f"  [standalone mode — director is AFK]")
                    send_typing()

                    response = ask_jen(text)

                    # Check if response resolves a pending gate
                    resolve_gate_if_present(response)

                    # In standalone mode, log both sides to pending so the CLI
                    # session can catch up on the full exchange via /afkoff
                    append_log("Jen", response)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Jen: {response[:80]}...")
                    send_telegram(response)
                else:
                    # RELAY MODE: CLI session is active, queue for PostToolUse hook
                    print(f"  [relay mode — routing to CLI session]")
                    # Message is already in .telegram_pending via append_log
                    # Send short ack so director knows it was received
                    send_telegram(
                        "_Message relayed to active CLI session. "
                        "Jen will see it on her next action._"
                    )

        except KeyboardInterrupt:
            print("\nShutting down.")
            send_telegram("_Jen Bot going offline._")
            sys.exit(0)
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(5)


# --- PUSH API (for external scripts/hooks) ---

if __name__ == "__main__":
    # --push "message" → send text and exit
    if len(sys.argv) >= 3 and sys.argv[1] == "--push":
        load_dotenv(ENV_PATH)
        TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
        CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
        jen_push(" ".join(sys.argv[2:]))
        print("Message pushed to Telegram.")
        sys.exit(0)

    # --image <path> [caption] → send image and exit
    if len(sys.argv) >= 3 and sys.argv[1] == "--image":
        load_dotenv(ENV_PATH)
        TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
        CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
        img_path = sys.argv[2]
        caption = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else None
        if send_image(img_path, caption):
            print(f"Image sent: {img_path}")
        else:
            print(f"Failed to send image: {img_path}")
        sys.exit(0)

    # --file <path> [caption] → send document and exit
    if len(sys.argv) >= 3 and sys.argv[1] == "--file":
        load_dotenv(ENV_PATH)
        TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
        CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
        file_path = sys.argv[2]
        caption = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else None
        if send_document(file_path, caption):
            print(f"File sent: {file_path}")
        else:
            print(f"Failed to send file: {file_path}")
        sys.exit(0)

    main()
