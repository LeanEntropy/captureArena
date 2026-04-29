"""Stage 6 — adaptation passes (text replacement + sprite swap).

After a place, the picker generates a per-import `adapt-<slug>-<name>.html`
page and prints its URL. The page lets the Director:
- Edit every text object's string inline (all rows).
- Swap flagged sprites (those whose object name matches logo/hero/icon
  heuristics) via a file picker; bytes are base64-embedded in the event.

Submission posts an `adapt` event to /event with this body:
  {
    "type": "adapt",
    "import_key": "<slug>/<name>",
    "mode": "figma" | "engine",
    "engine": "threejs" | "godot",
    "text_edits":   [ { "id": "<obj id>", "characters": "<new string>" }, ... ],
    "sprite_edits": [ { "id": "<obj id>", "png_b64": "<base64>" }, ... ]
  }

The picker's event handler calls `apply()` below, which:
1. Loads <import>/canonical.json.
2. Applies text_edits (match by object id).
3. Writes each sprite_edit's bytes to <import>/assets/<sha1>.png and points
   the matching image.path at it.
4. Writes updated canonical + bumps <import>/adaptation.json.
5. Re-runs the requested export (figma/threejs/godot) so the result is live.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import canonical_to_godot, config

_UI_PACK_INGEST = Path(__file__).resolve().parents[1] / "ui_pack_ingest"
import sys  # noqa: E402

if str(_UI_PACK_INGEST) not in sys.path:
    sys.path.insert(0, str(_UI_PACK_INGEST))

from threejs_to_figma import convert as scene_to_figma_bundle  # type: ignore  # noqa: E402

SWAPPABLE_NAME_RE = re.compile(
    r"(logo|hero|character|icon|avatar|portrait|mascot|banner|title)", re.IGNORECASE
)


@dataclass
class AdaptPlan:
    import_dir: Path
    import_key: str  # "<slug>/<name>"
    mode: str
    engine: str
    text_entries: list[dict] = field(default_factory=list)
    sprite_entries: list[dict] = field(default_factory=list)


def build_plan(
    game_dir: Path, slug: str, name: str, mode: str, engine: str
) -> AdaptPlan:
    import_dir = (game_dir / ".artgen" / "packs_imports" / slug / name).resolve()
    canonical = json.loads((import_dir / "canonical.json").read_text(encoding="utf-8"))

    text_entries = []
    sprite_entries = []
    for obj in canonical.get("objects") or []:
        kind = obj.get("kind")
        name_obj = obj.get("name") or ""
        if kind == "text":
            text_entries.append({
                "id": obj.get("id") or name_obj,
                "name": name_obj,
                "characters": (obj.get("text") or {}).get("characters") or "",
            })
        elif kind == "image" and SWAPPABLE_NAME_RE.search(name_obj):
            img = obj.get("image") or {}
            sprite_entries.append({
                "id": obj.get("id") or name_obj,
                "name": name_obj,
                "path": img.get("path") or "",
                "rect": obj.get("rect") or {},
            })
    return AdaptPlan(
        import_dir=import_dir,
        import_key=f"{slug}/{name}",
        mode=mode,
        engine=engine,
        text_entries=text_entries,
        sprite_entries=sprite_entries,
    )


def apply(
    game_dir: Path,
    import_key: str,
    mode: str,
    engine: str,
    text_edits: list[dict],
    sprite_edits: list[dict],
) -> dict:
    slug, name = import_key.split("/", 1)
    import_dir = (game_dir / ".artgen" / "packs_imports" / slug / name).resolve()
    canonical_path = import_dir / "canonical.json"
    scene = json.loads(canonical_path.read_text(encoding="utf-8"))

    by_id: dict[str, dict] = {}
    for obj in scene.get("objects") or []:
        oid = obj.get("id") or obj.get("name") or ""
        if oid:
            by_id[oid] = obj

    applied_text: list[dict] = []
    for edit in text_edits or []:
        oid = edit.get("id")
        new_text = edit.get("characters")
        obj = by_id.get(oid) if oid else None
        if not obj or obj.get("kind") != "text":
            continue
        t = obj.get("text") or {}
        old = t.get("characters") or ""
        if old != new_text:
            t["characters"] = new_text
            obj["text"] = t
            applied_text.append({"id": oid, "old": old, "new": new_text})

    applied_sprites: list[dict] = []
    assets_dir = import_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    for edit in sprite_edits or []:
        oid = edit.get("id")
        b64 = edit.get("png_b64")
        if not (oid and b64):
            continue
        obj = by_id.get(oid)
        if not obj or obj.get("kind") != "image":
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        sha1 = hashlib.sha1(raw).hexdigest()
        dst = assets_dir / f"{sha1}.png"
        if not dst.exists():
            dst.write_bytes(raw)
        old_path = (obj.get("image") or {}).get("path")
        img = obj.get("image") or {}
        img["path"] = f"assets/{sha1}.png"
        obj["image"] = img
        applied_sprites.append({"id": oid, "old_path": old_path, "new_path": img["path"]})

    canonical_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    adaptation_path = import_dir / "adaptation.json"
    adaptation = json.loads(adaptation_path.read_text(encoding="utf-8")) if adaptation_path.exists() else {"version": 1, "applied": []}
    adaptation["applied"].append({
        "text_edits": applied_text,
        "sprite_edits": applied_sprites,
    })
    adaptation_path.write_text(json.dumps(adaptation, indent=2), encoding="utf-8")

    export_paths = _reexport(scene, import_dir, name, mode, engine, game_dir)

    return {
        "import_dir": str(import_dir),
        "applied_text": applied_text,
        "applied_sprites": applied_sprites,
        "export_paths": export_paths,
    }


def _reexport(
    scene: dict, import_dir: Path, name: str, mode: str, engine: str, game_dir: Path
) -> dict:
    exports_dir = import_dir / "exports"
    out_paths: dict[str, str] = {}
    if mode == "figma":
        out_dir = exports_dir / "figma"
        out_dir.mkdir(parents=True, exist_ok=True)
        inlined = _inline(scene, import_dir)
        slug = (scene.get("metadata") or {}).get("source", {}).get("prefab", "pack").rsplit(".", 1)[0].lower()
        bundle = scene_to_figma_bundle(inlined, slug)
        out_path = out_dir / f"{name}_bundle.json"
        out_path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
        out_paths["figma"] = str(out_path)
    elif engine == "threejs":
        out_dir = exports_dir / "threejs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}.json"
        out_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
        out_paths["threejs"] = str(out_path)
    elif engine == "godot":
        out_dir = exports_dir / "godot"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}.tscn"
        try:
            res_prefix = f"res://{out_path.parent.relative_to(game_dir).as_posix()}"
        except ValueError:
            res_prefix = "res://"
        canonical_to_godot.emit(scene, import_dir, out_path, res_prefix)
        out_paths["godot"] = str(out_path)
    return out_paths


def _inline(scene: dict, import_dir: Path) -> dict:
    out = json.loads(json.dumps(scene))
    for obj in out.get("objects") or []:
        img = obj.get("image") or {}
        if img.get("path") and not img.get("data_url"):
            p = (import_dir / img["path"]).resolve()
            if p.is_file():
                img["data_url"] = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode("ascii")
    return out


def write_adapt_page(plan: AdaptPlan) -> Path:
    """Write <library>/.companion/adapt-<slug>-<name>.html and return its path."""
    from . import companion_data  # local import to avoid cycle at module load
    d = companion_data.companion_dir()
    slug, name = plan.import_key.split("/", 1)
    html_path = d / f"adapt-{slug}-{name}.html"

    # Sprite thumbnails: we embed image data URLs so the page renders before any
    # network requests; sprites live in game_dir, not served by the companion.
    sprite_with_data = []
    for s in plan.sprite_entries:
        abs_img = plan.import_dir / s["path"] if s["path"] else None
        data_url = ""
        if abs_img and abs_img.is_file():
            data_url = "data:image/png;base64," + base64.b64encode(abs_img.read_bytes()).decode("ascii")
        sprite_with_data.append({**s, "data_url": data_url})

    payload = {
        "import_key": plan.import_key,
        "import_dir": str(plan.import_dir),
        "mode": plan.mode,
        "engine": plan.engine,
        "texts": plan.text_entries,
        "sprites": sprite_with_data,
    }
    html = _ADAPT_HTML_TEMPLATE.replace(
        "/*__PAYLOAD__*/", json.dumps(payload),
    )
    html_path.write_text(html, encoding="utf-8")
    return html_path


_ADAPT_HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Adapt pack screen</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #0b1120; color: #e6edf3; margin: 0; padding: 24px; max-width: 1000px; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  .meta { color: #8aa4c5; font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #26334d; padding-bottom: 6px; }
  .row { display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: start; margin-bottom: 10px; }
  label { color: #8aa4c5; font-size: 12px; padding-top: 6px; }
  input[type=text], textarea { width: 100%; font: inherit; padding: 6px 8px; background: #131c2e; color: #e6edf3; border: 1px solid #26334d; border-radius: 4px; box-sizing: border-box; }
  textarea { min-height: 38px; }
  .sprite-row { grid-template-columns: 140px 1fr; }
  .sprite-thumb { background: #05080f; border: 1px solid #26334d; border-radius: 4px; width: 140px; height: 80px; display: flex; align-items: center; justify-content: center; }
  .sprite-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .sprite-panel { display: flex; flex-direction: column; gap: 6px; }
  .sprite-path { color: #8aa4c5; font-size: 11px; word-break: break-all; }
  button { font: inherit; padding: 8px 16px; background: #1f6fcc; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #2580e5; }
  .footer { margin-top: 32px; display: flex; gap: 12px; align-items: center; }
  .status { color: #8aa4c5; font-size: 13px; }
</style>
</head>
<body>
<h1>Adapt pack screen</h1>
<div class="meta" id="meta"></div>

<h2>Text</h2>
<div id="texts"></div>

<h2 id="sprites-header">Sprite swaps</h2>
<div id="sprites"></div>

<div class="footer">
  <button id="submit">Apply adaptations &amp; re-export</button>
  <span class="status" id="status"></span>
</div>

<script>
const PAYLOAD = /*__PAYLOAD__*/;
document.getElementById('meta').textContent =
  PAYLOAD.import_key + ' - ' + PAYLOAD.texts.length + ' text objects, '
  + PAYLOAD.sprites.length + ' swappable sprites - mode ' + PAYLOAD.mode + '/' + PAYLOAD.engine;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const textContainer = document.getElementById('texts');
for (const t of PAYLOAD.texts) {
  const row = el('div', 'row');
  const lbl = el('label', null, t.name || t.id);
  const input = document.createElement('textarea');
  input.value = t.characters;
  input.dataset.id = t.id;
  input.className = 'text-input';
  row.appendChild(lbl);
  row.appendChild(input);
  textContainer.appendChild(row);
}

const spriteContainer = document.getElementById('sprites');
if (PAYLOAD.sprites.length === 0) {
  document.getElementById('sprites-header').style.display = 'none';
}
for (const s of PAYLOAD.sprites) {
  const row = el('div', 'row sprite-row');
  const thumb = el('div', 'sprite-thumb');
  if (s.data_url) {
    const img = new Image();
    img.src = s.data_url;
    img.alt = s.name;
    thumb.appendChild(img);
  }
  row.appendChild(thumb);
  const panel = el('div', 'sprite-panel');
  panel.appendChild(el('div', null, s.name || s.id));
  panel.appendChild(el('div', 'sprite-path', s.path));
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png';
  file.dataset.id = s.id;
  file.className = 'sprite-input';
  panel.appendChild(file);
  row.appendChild(panel);
  spriteContainer.appendChild(row);
}

async function fileToB64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

document.getElementById('submit').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'collecting edits...';
  const text_edits = [];
  document.querySelectorAll('.text-input').forEach(t => {
    const match = PAYLOAD.texts.find(x => x.id === t.dataset.id);
    if (match && match.characters !== t.value) {
      text_edits.push({ id: t.dataset.id, characters: t.value });
    }
  });
  const sprite_edits = [];
  for (const inp of document.querySelectorAll('.sprite-input')) {
    if (inp.files && inp.files[0]) {
      const b64 = await fileToB64(inp.files[0]);
      sprite_edits.push({ id: inp.dataset.id, png_b64: b64 });
    }
  }
  status.textContent = 'posting... (' + text_edits.length + ' text, ' + sprite_edits.length + ' sprite)';
  const body = {
    type: 'adapt',
    import_key: PAYLOAD.import_key,
    import_dir: PAYLOAD.import_dir,
    mode: PAYLOAD.mode,
    engine: PAYLOAD.engine,
    text_edits: text_edits,
    sprite_edits: sprite_edits,
  };
  try {
    const r = await fetch('/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) status.textContent = 'queued - check the picker console for result';
    else status.textContent = 'error: ' + r.status;
  } catch (e) {
    status.textContent = 'network error: ' + e;
  }
});
</script>
</body>
</html>
"""
