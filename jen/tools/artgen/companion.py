"""Integration with the visual companion server."""

import json
import os
import signal
import subprocess
import time

from . import db


def _server_info_path(screen_dir):
    return os.path.join(screen_dir, ".server-info")


def _server_pid_path(screen_dir):
    return os.path.join(screen_dir, ".server.pid")


def _events_path(screen_dir):
    return os.path.join(screen_dir, ".events")


def start_server(screen_dir, images_dir, port=None):
    """Start the companion server. Returns dict with process, url, port."""
    os.makedirs(screen_dir, exist_ok=True)

    # Find server.js relative to artgen package
    artgen_root = os.path.dirname(os.path.abspath(__file__))
    server_js = os.path.join(artgen_root, "server", "server.js")

    cmd = ["node", server_js, "--screen-dir", screen_dir,
           "--images-dir", images_dir]
    if port:
        cmd.extend(["--port", str(port)])

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    # Write PID for later cleanup
    with open(_server_pid_path(screen_dir), "w") as f:
        f.write(str(proc.pid))

    # Wait for .server-info to appear (max 5s)
    info_path = _server_info_path(screen_dir)
    for _ in range(50):
        if os.path.exists(info_path):
            with open(info_path) as f:
                info = json.loads(f.read())
            info["process"] = proc
            return info
        time.sleep(0.1)

    return {"process": proc, "url": f"http://localhost:{port or 3333}",
            "port": port or 3333}


def stop_server(screen_dir):
    """Stop the companion server."""
    pid_path = _server_pid_path(screen_dir)
    if not os.path.exists(pid_path):
        return

    with open(pid_path) as f:
        pid = int(f.read().strip())

    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, OSError):
        pass

    try:
        os.remove(pid_path)
    except OSError:
        pass

    info_path = _server_info_path(screen_dir)
    if os.path.exists(info_path):
        try:
            os.remove(info_path)
        except OSError:
            pass


def is_running(screen_dir):
    """Check if the companion server is running."""
    info_path = _server_info_path(screen_dir)
    if not os.path.exists(info_path):
        return False
    pid_path = _server_pid_path(screen_dir)
    if not os.path.exists(pid_path):
        return False
    with open(pid_path) as f:
        pid = int(f.read().strip())
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, OSError):
        return False


def push_page(screen_dir, filename, html_content):
    """Write an HTML content fragment to the screen dir."""
    os.makedirs(screen_dir, exist_ok=True)
    path = os.path.join(screen_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html_content)


def read_events(screen_dir):
    """Read and parse .events file. Returns list of event dicts."""
    events_path = _events_path(screen_dir)
    if not os.path.exists(events_path):
        return []
    events = []
    with open(events_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events


def clear_events(screen_dir):
    """Clear the events file."""
    events_path = _events_path(screen_dir)
    if os.path.exists(events_path):
        with open(events_path, "w") as f:
            f.write("")


def sync_events(screen_dir, db_path):
    """Read events, apply ratings/comments to DB, clear events.

    Returns count of events processed.
    """
    events = read_events(screen_dir)
    if not events:
        return 0

    count = 0
    for evt in events:
        evt_type = evt.get("type", "")
        if evt_type == "rate":
            image_id = evt.get("image_id", "")
            rating = evt.get("rating", "")
            if image_id and rating:
                db.update_rating(db_path, image_id, rating)
                count += 1
        elif evt_type == "comment":
            image_id = evt.get("image_id")
            text = evt.get("text", "")
            if text:
                db.add_comment(db_path, image_id=image_id, text=text)
                count += 1
        elif evt_type == "feedback":
            session_id = evt.get("session_id")
            text = evt.get("text", "")
            if text:
                db.add_comment(db_path, session_id=session_id, text=text)
                count += 1

    clear_events(screen_dir)
    return count
