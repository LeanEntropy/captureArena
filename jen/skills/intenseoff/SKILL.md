---
name: intenseoff
description: Deactivate intense work mode. Stops the proactive work cycle, kills the watchdog, and returns to normal mode.
---

# Deactivate Intense Mode

When invoked, do the following:

1. Kill the watchdog process:
```bash
python -c "
import json, os, signal
f='comms/session_state.json'
d=json.load(open(f))
pid=d.get('watchdog_pid')
if pid:
    try:
        os.kill(pid, signal.SIGTERM)
        print(f'Watchdog (PID {pid}) killed.')
    except ProcessLookupError:
        print('Watchdog already stopped.')
"
```

2. Reset session state:
```python
import json
state = {
    "mode": "normal",
    "session_name": None,
    "goal": None,
    "started_at": None,
    "last_activity": 0,
    "afk": False,
    "watchdog_pid": None
}
with open("comms/session_state.json", "w") as f:
    json.dump(state, f, indent=2)
```

3. Clear `comms/intense_goal.md`:
```markdown
# Intense Session Goal

> This file persists the current intense session goal so it survives context compaction.
> Written by `/intense`, cleared by `/intense-off`.

**Mode:** inactive
**Goal:** (none)
**Session:** (none)
```

4. Send Telegram notification:
```bash
python tools/telegram_bot/jen_bot.py --push "🔴 Intense session ended. Returning to normal mode."
```

5. Announce to CLI: "Intense mode deactivated. Back to normal."
