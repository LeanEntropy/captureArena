---
name: afk
description: Switch to AFK mode — Jen uses Telegram for communication, heartbeat sends reports there. Use /afk to go AFK, /afkoff to return.
user_invocable: true
---

# AFK Mode

Sets the director's AFK status. When AFK, Jen sends reports and gate requests to Telegram. When not AFK, Jen only communicates in the CLI session.

## /afk
Director is going AFK. Activate Telegram communication:
1. Write `afk` to `comms/.afk_status`
2. Send a confirmation to Telegram: "Director is AFK. Jen will communicate via Telegram."
3. Tell the director: "AFK mode on. I'll use Telegram from now. Say /afkoff when you're back."

## /afkoff
Director is back at the computer. Deactivate Telegram communication:
1. Delete or clear `comms/.afk_status`
2. Run `bash tools/telegram_bot/check_telegram.sh` to surface any Telegram exchanges that happened while AFK
3. Tell the director: "Welcome back. Here's what happened while you were away:" followed by the check_telegram output (if any).
