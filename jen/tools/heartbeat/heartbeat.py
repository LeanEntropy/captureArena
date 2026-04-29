"""
Heartbeat — Entry point for Jen's proactive autonomous sessions.

Called by Windows Task Scheduler (or manually). Orchestrates:
  1. Acquire lock (prevent overlapping sessions)
  2. Dispatch: pick work item, build prompt
  3. Run: claude -p with assembled prompt
  4. Postprocess: parse output, send Telegram report, update state

Usage:
    python tools/heartbeat/heartbeat.py          # Normal run
    python tools/heartbeat/heartbeat.py --dry-run # Show what would be picked, don't run
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent.parent
LOCK_FILE = SCRIPT_DIR / ".heartbeat.lock"
STATE_PATH = SCRIPT_DIR / "state.json"
LOG_DIR = PROJECT_DIR / "memory"
CLAUDE_TIMEOUT = 900  # 15 minutes max per session
CLAUDE_BYPASS_PERMISSIONS = os.environ.get("CLAUDE_BYPASS_PERMISSIONS", "true").lower() in ("true", "1", "yes")


def acquire_lock() -> bool:
    """Acquire a lockfile. Returns True if lock acquired, False if already locked."""
    if LOCK_FILE.exists():
        # Check if lock is stale (older than 20 minutes)
        try:
            lock_age = time.time() - LOCK_FILE.stat().st_mtime
            if lock_age > 1200:  # 20 minutes
                print(f"Stale lock detected ({lock_age:.0f}s old), removing.")
                LOCK_FILE.unlink()
            else:
                return False
        except Exception:
            return False

    LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")
    return True


def release_lock() -> None:
    """Release the lockfile."""
    try:
        LOCK_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def check_consecutive_cap() -> bool:
    """Check if we've hit the consecutive session cap. Returns True if OK to proceed."""
    state = json.loads(STATE_PATH.read_text(encoding="utf-8")) if STATE_PATH.exists() else {}
    max_consecutive = state.get("max_consecutive_sessions", 3)
    current = state.get("consecutive_sessions_without_interaction", 0)

    if current >= max_consecutive:
        # Send check-in message
        bot_script = PROJECT_DIR / "tools" / "telegram_bot" / "jen_bot.py"
        if bot_script.exists():
            subprocess.run([
                sys.executable, str(bot_script), "--push",
                f"Jen here — I've completed {current} proactive sessions without hearing from you. "
                f"Pausing until you respond. Send any message to resume."
            ], timeout=30)
        return False

    return True


def check_daily_limit() -> bool:
    """Check if daily token limit exceeded. Returns True if OK to proceed."""
    state = json.loads(STATE_PATH.read_text(encoding="utf-8")) if STATE_PATH.exists() else {}
    today = datetime.now().strftime("%Y-%m-%d")
    daily = state.get("daily_sessions", {}).get(today, {})
    limit = state.get("daily_token_limit", 200000)

    if daily.get("approx_tokens", 0) >= limit:
        return False

    return True


def run_claude(prompt: str) -> str:
    """Run claude -p with the assembled prompt, return output."""
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
            output += f"\n\nSTDERR: {result.stderr.strip()[:500]}"
        return output or "(no output)"
    except subprocess.TimeoutExpired:
        return "ERROR: Session timed out after {CLAUDE_TIMEOUT}s"
    except FileNotFoundError:
        return "ERROR: claude CLI not found in PATH"
    except Exception as e:
        return f"ERROR: {e}"


def main():
    dry_run = "--dry-run" in sys.argv

    print(f"[{datetime.now().isoformat()}] Heartbeat starting...")

    # Step 1: Acquire lock
    if not dry_run and not acquire_lock():
        print("Another heartbeat is running. Exiting.")
        return

    try:
        # Step 2: Safety checks
        if not check_consecutive_cap():
            print("Consecutive session cap reached. Paused.")
            return

        if not check_daily_limit():
            print("Daily token limit reached. Skipping.")
            return

        # Step 3: Dispatch
        from dispatcher import dispatch
        item, prompt = dispatch()

        if not item:
            print("No eligible work items. Nothing to do.")
            return

        print(f"Selected: {item['id']} — {item.get('title', '')}")
        print(f"Prompt: {len(prompt)} chars")

        if dry_run:
            print("\n--- DRY RUN: Would send this prompt ---")
            print(prompt[:1000] + "..." if len(prompt) > 1000 else prompt)
            return

        # Step 4: Run Claude
        print("Running claude -p...")
        output = run_claude(prompt)
        print(f"Output: {len(output)} chars")

        # Step 5: Postprocess
        from postprocess import process
        process(output, item["id"])
        print("Postprocessing complete.")

    finally:
        if not dry_run:
            release_lock()

    print(f"[{datetime.now().isoformat()}] Heartbeat complete.")


if __name__ == "__main__":
    main()
