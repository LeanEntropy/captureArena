#!/bin/bash
# Check for new Telegram exchanges and display them in the CLI session.
# Called manually or via /afkoff to surface Telegram conversations.
#
# Note: In relay mode (director not AFK), the PostToolUse hook in
# .hooks/check-telegram-pending.sh automatically injects pending
# Telegram messages into the conversation. This script is mainly
# useful when returning from AFK to catch up on standalone-mode exchanges.

PENDING="comms/.telegram_pending"

if [ -s "$PENDING" ]; then
    echo "=== NEW TELEGRAM EXCHANGES ==="
    cat "$PENDING"
    echo "=== END TELEGRAM EXCHANGES ==="
    > "$PENDING"
else
    echo "(No pending Telegram messages.)"
fi
