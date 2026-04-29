# Jen Telegram Bot

Remote communication channel to Jen when the director is AFK. Same Jen as in the CLI — just a different pipe.

## Setup

### 1. Create the Telegram Bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Name it (e.g. "Jen Art Director") and give it a username ending in `_bot`
4. Copy the bot token

### 2. Get Your Chat ID

1. Send any message to your new bot
2. Open in browser: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find the `chat.id` number in the JSON response

### 3. Configure

```bash
cd tools/telegram_bot
cp .env.example .env
# Edit .env with your token and chat ID
```

### 4. Install Dependencies

```bash
pip install requests python-dotenv
```

### 5. Run

```bash
python tools/telegram_bot/jen_bot.py
```

## Commands

| Command | What it does |
|---------|-------------|
| `/status` | Show current session notes |
| `/backlog` | Show active sprint items |
| `/memory` | Show permanent research memory |
| `/log` | Show today's session log |
| `/help` | List commands |
| Anything else | Sent to Jen as conversation |

## Jen-Initiated Messages (Push API)

Other scripts/hooks can make Jen push a message to Telegram:

```bash
python tools/telegram_bot/jen_bot.py --push "Hit an approval gate on RB-002. Need your input."
```

This is used by hooks and the research-session skill when Jen needs to notify the director.

## How Conversation Persists

Telegram exchanges are logged to `comms/telegram_log.md` (rolling, last ~150 lines). This log is injected as context into each `claude -p` call, giving Jen memory of the Telegram conversation.

For cross-channel persistence (Telegram → CLI), the real persistence is the memory system: session-notes.md, daily logs, and MEMORY.md. Jen captures important decisions from Telegram exchanges into these files, so the next CLI session has full context.
