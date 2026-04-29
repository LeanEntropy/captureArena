"""Command handlers for artgen CLI."""

import argparse
import json
import os
import sys
import time

from . import config, db, generator, companion
from .pages import session_review


def _resolve(db_path, prefix, table="sessions"):
    """Resolve a short ID prefix to full UUID, exit on failure."""
    full_id = db.resolve_id(db_path, prefix, table)
    if not full_id:
        print(f"Error: No {table[:-1]} matching '{prefix}'")
        sys.exit(1)
    return full_id


def _ensure_dirs(project_dir=None):
    """Ensure data directories exist and DB is initialized."""
    data_dir = config.get_data_dir(project_dir)
    os.makedirs(config.get_images_dir(project_dir), exist_ok=True)
    os.makedirs(config.get_companion_dir(project_dir), exist_ok=True)
    db_path = config.get_db_path(project_dir)
    db.init_db(db_path)
    return data_dir


def _push_session_review(project_dir, session_id):
    """Build and push a session review page to the companion."""
    db_path = config.get_db_path(project_dir)
    data_dir = config.get_data_dir(project_dir)
    screen_dir = config.get_companion_dir(project_dir)
    sess = db.get_session(db_path, session_id)
    images = db.query_images(db_path, session_id=session_id, limit=9999)
    html = session_review.render_session_review(sess, images, data_dir)
    companion.push_page(screen_dir, "session_review.html", html)


# ── Session commands ─────────────────────────────────────────

def cmd_session_new(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    sid = db.create_session(db_path, args.name, args.desc or "")
    print(f"Created session: {sid}")
    print(f"  Name: {args.name}")


def cmd_session_list(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    sessions = db.list_sessions(db_path)
    if not sessions:
        print("No sessions found.")
        return
    for s in sessions:
        count = len(db.query_images(db_path, session_id=s["id"], limit=9999))
        print(f"  {s['id'][:8]}  {s['status']:<10}  {s['name']}"
              f"  ({count} images)  {s['created_at'][:10]}")


def cmd_session_show(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    sid = _resolve(db_path, args.session_id)
    s = db.get_session(db_path, sid)
    if not s:
        print(f"Session not found: {args.session_id}")
        return
    images = db.query_images(db_path, session_id=s["id"], limit=9999)
    print(f"Session: {s['name']}")
    print(f"  ID:      {s['id']}")
    print(f"  Status:  {s['status']}")
    print(f"  Created: {s['created_at']}")
    print(f"  Images:  {len(images)}")
    for img in images:
        r = img['rating']
        print(f"    {img['id'][:8]}  {r:<10}  "
              f"seed={img['seed']}  {img['asset_name']}")


# ── Generate command ─────────────────────────────────────────

def cmd_gen(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    images_dir = config.get_images_dir(args.project)

    api_key = config.load_api_key()
    if not api_key:
        print("Error: No API key found in docs/data_from_director.txt")
        sys.exit(1)

    session_id = args.session
    if session_id:
        full_id = db.resolve_id(db_path, session_id, "sessions")
        if not full_id:
            print(f"Error: No session matching '{session_id}'")
            sys.exit(1)
        session_id = full_id
    else:
        session_id = db.create_session(db_path, f"gen-{int(time.time())}")
        print(f"Auto-created session: {session_id[:8]}")

    seeds = args.seed if args.seed else [None]
    backend = generator.RunComfyBackend(api_key, config.RUNCOMFY_API_BASE)

    for seed in seeds:
        params = generator.GenerationParams(
            prompt=args.prompt,
            seed=seed,
            model=args.model or "blackforestlabs/flux-2/dev/text-to-image",
            aspect_ratio=args.aspect_ratio or "1:1",
        )
        print(f"\n[seed={seed}]")
        result = backend.generate(params, images_dir)

        if result.success:
            db.insert_image(
                db_path, prompt=params.prompt, model=params.model,
                seed=result.seed_used, cfg=params.cfg, steps=params.steps,
                sampler=params.sampler, scheduler=params.scheduler,
                width=params.width, height=params.height,
                aspect_ratio=params.aspect_ratio, backend=params.backend,
                request_id=result.request_id, file_path=result.image_path,
                file_size_kb=result.file_size_kb, session_id=session_id,
                experiment=args.experiment or "",
                asset_type=args.asset_type or "",
                asset_name=args.asset_name or "",
                tribe=args.tribe or "",
            )
        else:
            print(f"  FAILED: {result.error}")

    screen_dir = config.get_companion_dir(args.project)
    if companion.is_running(screen_dir):
        _push_session_review(args.project, session_id)
        print("\nReview page pushed to companion.")


# ── Batch command ────────────────────────────────────────────

def cmd_batch(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)

    with open(args.batch_file) as f:
        batch = json.load(f)

    session_id = args.session
    if not session_id:
        name = batch.get("name", f"batch-{int(time.time())}")
        session_id = db.create_session(db_path, name,
                                       batch.get("description", ""))
        print(f"Created session: {session_id[:8]} ({name})")

    items = batch.get("items", [])
    print(f"Batch: {len(items)} items")

    for i, item in enumerate(items, 1):
        gen_args = argparse.Namespace(
            prompt=item["prompt"], seed=item.get("seeds", [None]),
            model=item.get("model"), aspect_ratio=item.get("aspect_ratio"),
            session=session_id, experiment=item.get("experiment", ""),
            asset_type=item.get("asset_type", ""),
            asset_name=item.get("asset_name", ""),
            tribe=item.get("tribe", ""), project=args.project,
        )
        print(f"\n--- Item {i}/{len(items)}: {item.get('asset_name', '')} ---")
        cmd_gen(gen_args)
        if i < len(items):
            time.sleep(2)


# ── Serve / Sync / Review ───────────────────────────────────

def cmd_serve(args):
    data_dir = _ensure_dirs(args.project)
    screen_dir = config.get_companion_dir(args.project)
    images_dir = config.get_images_dir(args.project)
    info = companion.start_server(screen_dir, images_dir, port=args.port)
    url = info.get("url", f"http://localhost:{args.port or 3333}")
    print(f"Companion server running at: {url}")
    print("Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping server...")
        companion.stop_server(screen_dir)


def cmd_sync(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    screen_dir = config.get_companion_dir(args.project)
    count = companion.sync_events(screen_dir, db_path)
    print(f"Synced {count} events from companion.")


def cmd_review_session(args):
    _ensure_dirs(args.project)
    screen_dir = config.get_companion_dir(args.project)
    images_dir = config.get_images_dir(args.project)
    db_path = config.get_db_path(args.project)
    sid = _resolve(db_path, args.session_id)
    _push_session_review(args.project, sid)

    if not companion.is_running(screen_dir):
        info = companion.start_server(screen_dir, images_dir, port=args.port)
        url = info.get("url", f"http://localhost:{args.port or 3333}")
        print(f"Companion server started at: {url}")
        print("Press Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping server...")
            companion.stop_server(screen_dir)
    else:
        print("Review page pushed to companion.")


# ── List / Show / Rate / Delete ──────────────────────────────

def cmd_list(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    sid = None
    if args.session:
        sid = _resolve(db_path, args.session)
    images = db.query_images(
        db_path, session_id=sid, rating=args.rating,
        asset_type=args.asset_type, experiment=args.experiment,
    )
    if not images:
        print("No images found.")
        return
    for img in images:
        print(f"  {img['id'][:8]}  {img['rating']:<10}  "
              f"seed={img['seed']}  {img['asset_name']:<20}  "
              f"{img['created_at'][:10]}")


def cmd_show(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    iid = _resolve(db_path, args.image_id, "images")
    img = db.get_image(db_path, iid)
    if not img:
        print(f"Image not found: {args.image_id}")
        return
    for key in img.keys():
        print(f"  {key}: {img[key]}")


def cmd_rate(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    iid = _resolve(db_path, args.image_id, "images")
    db.update_rating(db_path, iid, args.rating, args.note)
    print(f"Rated {iid[:8]} as {args.rating}")


def cmd_delete(args):
    _ensure_dirs(args.project)
    db_path = config.get_db_path(args.project)
    if args.image_id:
        iid = _resolve(db_path, args.image_id, "images")
        db.delete_image(db_path, iid)
        print(f"Deleted {iid[:8]}")
    elif args.rating:
        images = db.query_images(
            db_path, session_id=args.session, rating=args.rating, limit=9999)
        if not images:
            print("No matching images.")
            return
        print(f"Deleting {len(images)} images with rating={args.rating}...")
        for img in images:
            db.delete_image(db_path, img["id"])
        print(f"Deleted {len(images)} images.")
    else:
        print("Specify --image-id or --rating to delete.")
