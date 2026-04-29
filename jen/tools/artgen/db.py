"""SQLite schema and query helpers for artgen."""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone


def get_connection(db_path):
    """Return a configured connection with Row factory."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path):
    """Create all tables and indexes."""
    conn = get_connection(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            created_at  TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            status      TEXT DEFAULT 'active'
                        CHECK(status IN ('active', 'complete', 'archived'))
        );

        CREATE TABLE IF NOT EXISTS images (
            id            TEXT PRIMARY KEY,
            created_at    TEXT NOT NULL,
            prompt        TEXT NOT NULL,
            negative      TEXT DEFAULT '',
            model         TEXT DEFAULT '',
            loras         TEXT DEFAULT '[]',
            seed          INTEGER,
            cfg           REAL DEFAULT 3.5,
            steps         INTEGER DEFAULT 28,
            sampler       TEXT DEFAULT 'euler',
            scheduler     TEXT DEFAULT 'normal',
            width         INTEGER DEFAULT 1024,
            height        INTEGER DEFAULT 1024,
            aspect_ratio  TEXT DEFAULT '1:1',
            backend       TEXT DEFAULT 'runcomfy',
            request_id    TEXT DEFAULT '',
            model_api_id  TEXT DEFAULT '',
            file_path     TEXT DEFAULT '',
            file_size_kb  INTEGER DEFAULT 0,
            session_id    TEXT,
            experiment    TEXT DEFAULT '',
            asset_type    TEXT DEFAULT '',
            asset_name    TEXT DEFAULT '',
            tribe         TEXT DEFAULT '',
            rating        TEXT DEFAULT 'unrated'
                          CHECK(rating IN (
                              'unrated', 'reject', 'maybe',
                              'approved', 'reference')),
            tags          TEXT DEFAULT '[]',
            notes         TEXT DEFAULT '',
            approved_at   TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS lineage (
            child_id    TEXT NOT NULL,
            parent_id   TEXT NOT NULL,
            iteration   INTEGER DEFAULT 1,
            change_note TEXT DEFAULT '',
            PRIMARY KEY (child_id, parent_id),
            FOREIGN KEY (child_id)  REFERENCES images(id),
            FOREIGN KEY (parent_id) REFERENCES images(id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id          TEXT PRIMARY KEY,
            created_at  TEXT NOT NULL,
            image_id    TEXT,
            session_id  TEXT,
            text        TEXT NOT NULL,
            source      TEXT DEFAULT 'browser'
                        CHECK(source IN ('browser', 'cli')),
            FOREIGN KEY (image_id)   REFERENCES images(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_images_session
            ON images(session_id);
        CREATE INDEX IF NOT EXISTS idx_images_rating
            ON images(rating);
        CREATE INDEX IF NOT EXISTS idx_images_asset_type
            ON images(asset_type);
        CREATE INDEX IF NOT EXISTS idx_images_experiment
            ON images(experiment);
        CREATE INDEX IF NOT EXISTS idx_comments_image
            ON comments(image_id);
        CREATE INDEX IF NOT EXISTS idx_comments_session
            ON comments(session_id);
    """)
    conn.close()


def _ensure_db(db_path):
    """Initialize DB if it doesn't exist yet."""
    if not os.path.exists(db_path):
        init_db(db_path)


def _now():
    return datetime.now(timezone.utc).isoformat()


# ── Sessions ─────────────────────────────────────────────────

def create_session(db_path, name, description=""):
    """Create a new session. Returns session id."""
    _ensure_db(db_path)
    sid = str(uuid.uuid4())
    conn = get_connection(db_path)
    conn.execute(
        "INSERT INTO sessions (id, created_at, name, description) "
        "VALUES (?, ?, ?, ?)",
        (sid, _now(), name, description),
    )
    conn.commit()
    conn.close()
    return sid


def list_sessions(db_path):
    """List all sessions, newest first."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM sessions ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return rows


def get_session(db_path, session_id):
    """Get a single session by id."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT * FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    conn.close()
    return row


def resolve_id(db_path, prefix, table="sessions"):
    """Resolve a short prefix to a full UUID. Returns full id or None."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    rows = conn.execute(
        f"SELECT id FROM {table} WHERE id LIKE ?", (prefix + "%",)
    ).fetchall()
    conn.close()
    if len(rows) == 1:
        return rows[0]["id"]
    return None


# ── Images ───────────────────────────────────────────────────

def insert_image(db_path, **kwargs):
    """Insert an image record. Returns the image id (UUID)."""
    _ensure_db(db_path)
    image_id = str(uuid.uuid4())
    created_at = _now()

    # Serialize list/dict fields
    for key in ("loras", "tags"):
        if key in kwargs and not isinstance(kwargs[key], str):
            kwargs[key] = json.dumps(kwargs[key])

    cols = ["id", "created_at"] + list(kwargs.keys())
    vals = [image_id, created_at] + list(kwargs.values())
    placeholders = ", ".join(["?"] * len(vals))
    col_names = ", ".join(cols)

    conn = get_connection(db_path)
    conn.execute(
        f"INSERT INTO images ({col_names}) VALUES ({placeholders})", vals
    )
    conn.commit()
    conn.close()
    return image_id


def get_image(db_path, image_id):
    """Get a single image by id."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT * FROM images WHERE id = ?", (image_id,)
    ).fetchone()
    conn.close()
    return row


def query_images(db_path, session_id=None, rating=None,
                 asset_type=None, experiment=None, limit=100):
    """Query images with optional filters."""
    _ensure_db(db_path)
    clauses = []
    params = []
    if session_id:
        clauses.append("session_id = ?")
        params.append(session_id)
    if rating:
        clauses.append("rating = ?")
        params.append(rating)
    if asset_type:
        clauses.append("asset_type = ?")
        params.append(asset_type)
    if experiment:
        clauses.append("experiment = ?")
        params.append(experiment)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"SELECT * FROM images{where} ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    conn = get_connection(db_path)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return rows


def update_rating(db_path, image_id, rating, notes=None):
    """Update the rating (and optionally notes) for an image."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    if notes is not None:
        conn.execute(
            "UPDATE images SET rating = ?, notes = ?, approved_at = ? "
            "WHERE id = ?",
            (rating, notes,
             _now() if rating == "approved" else None,
             image_id),
        )
    else:
        conn.execute(
            "UPDATE images SET rating = ?, approved_at = ? WHERE id = ?",
            (rating,
             _now() if rating == "approved" else None,
             image_id),
        )
    conn.commit()
    conn.close()


def delete_image(db_path, image_id):
    """Delete an image record AND its file from disk."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT file_path FROM images WHERE id = ?", (image_id,)
    ).fetchone()
    if row and row["file_path"] and os.path.exists(row["file_path"]):
        os.remove(row["file_path"])
    conn.execute("DELETE FROM lineage WHERE child_id = ? OR parent_id = ?",
                 (image_id, image_id))
    conn.execute("DELETE FROM comments WHERE image_id = ?", (image_id,))
    conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
    conn.commit()
    conn.close()


# ── Comments ─────────────────────────────────────────────────

def add_comment(db_path, image_id=None, session_id=None,
                text="", source="browser"):
    """Add a comment. Returns comment id."""
    _ensure_db(db_path)
    cid = str(uuid.uuid4())
    conn = get_connection(db_path)
    conn.execute(
        "INSERT INTO comments (id, created_at, image_id, session_id, "
        "text, source) VALUES (?, ?, ?, ?, ?, ?)",
        (cid, _now(), image_id, session_id, text, source),
    )
    conn.commit()
    conn.close()
    return cid


def get_session_comments(db_path, session_id):
    """Get all comments for a session (direct + via images)."""
    _ensure_db(db_path)
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM comments WHERE session_id = ? "
        "OR image_id IN (SELECT id FROM images WHERE session_id = ?) "
        "ORDER BY created_at ASC",
        (session_id, session_id),
    ).fetchall()
    conn.close()
    return rows
