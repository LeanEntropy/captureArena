"""Companion-mode data + HTML templates for the UI Packs Library browser.

The companion server (tools/artgen/server/server.js) serves:
- `/images/<path>` from `imagesDir`
- `/<file.html>` and `/.events`, `/files/<path>` from `screenDir`

Library mode: imagesDir = <library root>, screenDir = <library root>/.companion/
So thumbnails load from /images/packs/<slug>/thumbnails/pack.png, and the
browser HTML + packs.json live in the companion dir.

Two pages:
- library-browser.html — grid of packs, clicking opens pack-detail.html?id=...
- pack-detail.html — grid of screens/components for one pack, each with
  optional action buttons (library mode: disabled; per-game picker: enabled).
"""
from __future__ import annotations

import json
from pathlib import Path

from . import catalog, config

COMPANION_SUBDIR = ".companion"


def companion_dir() -> Path:
    d = config.library_root() / COMPANION_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def build_packs_projection(mode: str = "library") -> dict:
    """Project catalog.json into the browser-friendly shape.

    mode: 'library' (disables placement actions) or 'picker' (enables them).
    Per-pack screen/component lists are read from each pack's pack.json so the
    projection stays authoritative for filenames and counts.
    """
    cat = catalog.load_catalog()
    out_packs: list[dict] = []
    for entry in cat.get("packs", []):
        pack_json = config.library_root() / entry["path"] / "pack.json"
        screens: list[dict] = []
        components: list[dict] = []
        if pack_json.exists():
            manifest = json.loads(pack_json.read_text(encoding="utf-8"))
            for kind, bucket in (("screens", screens), ("components", components)):
                for item in manifest.get(kind, []):
                    name = item.get("name", "")
                    bucket.append({
                        "name": name,
                        "canonical": f"{entry['path']}/canonical/{kind}/{name}.json",
                        "thumbnail": f"{entry['path']}/thumbnails/{kind}/{name}.png",
                        "object_count": item.get("object_count", 0),
                    })
        out_packs.append({
            "id": entry["id"],
            "slug": entry["slug"],
            "display_name": entry["display_name"],
            "source": entry["source"],
            "license": entry["license"],
            "thumbnail": entry["thumbnail"],
            "screen_count": entry.get("screen_count", 0),
            "component_count": entry.get("component_count", 0),
            "ingested_at": entry.get("ingested_at", ""),
            "tags": entry.get("tags", []),
            "screens": screens,
            "components": components,
        })
    return {"mode": mode, "packs": out_packs}


def write_companion_data(mode: str = "library") -> Path:
    """Write packs.json + library-browser.html + pack-detail.html into
    <library>/.companion/. Returns the companion dir path."""
    d = companion_dir()
    (d / "packs.json").write_text(
        json.dumps(build_packs_projection(mode), indent=2), encoding="utf-8",
    )
    (d / "library-browser.html").write_text(_LIBRARY_BROWSER_HTML, encoding="utf-8")
    (d / "pack-detail.html").write_text(_PACK_DETAIL_HTML, encoding="utf-8")
    return d


_LIBRARY_BROWSER_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>UI Packs Library</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #0b1120; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  .meta { color: #8aa4c5; font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #131c2e; border: 1px solid #26334d; border-radius: 8px; overflow: hidden; cursor: pointer; transition: border-color .15s; text-decoration: none; color: inherit; display: block; }
  .card:hover { border-color: #5a8adf; }
  .card img { width: 100%; aspect-ratio: 1/1; object-fit: contain; display: block; background: #05080f; }
  .card .name { padding: 10px 12px 4px; font-size: 14px; font-weight: 600; }
  .card .source { padding: 0 12px 10px; font-size: 12px; color: #8aa4c5; }
  .badge { display: inline-block; padding: 1px 6px; background: #1f2c46; border-radius: 3px; margin-right: 4px; font-size: 11px; }
  .empty { padding: 40px; background: #131c2e; border-radius: 8px; text-align: center; color: #8aa4c5; }
</style>
</head>
<body>
<h1>UI Packs Library</h1>
<div class="meta" id="meta">Loading...</div>
<div id="grid" class="grid"></div>
<script>
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

fetch('packs.json').then(r => r.json()).then(data => {
  const grid = document.getElementById('grid');
  const meta = document.getElementById('meta');
  if (!data.packs || data.packs.length === 0) {
    grid.textContent = 'No packs ingested yet. Use the ui-pack-ingest skill.';
    meta.textContent = 'mode: ' + data.mode + ' - 0 packs';
    return;
  }
  meta.textContent = 'mode: ' + data.mode + ' - ' + data.packs.length + ' pack' + (data.packs.length === 1 ? '' : 's');
  for (const p of data.packs) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = 'pack-detail.html?id=' + encodeURIComponent(p.id);
    const img = new Image();
    img.src = '/images/' + p.thumbnail;
    img.alt = p.display_name;
    card.appendChild(img);
    card.appendChild(el('div', 'name', p.display_name));
    const src = el('div', 'source');
    const s = p.source || {};
    const l = p.license || {};
    src.appendChild(el('span', 'badge', s.type || '?'));
    src.appendChild(el('span', 'badge', l.tier || '?'));
    const srcText = (s.vendor || '') + (s.version ? (' v' + s.version) : '') + ' - '
      + (p.screen_count || 0) + ' screens, ' + (p.component_count || 0) + ' components';
    src.appendChild(document.createTextNode(' ' + srcText));
    card.appendChild(src);
    grid.appendChild(card);
  }
});
</script>
</body>
</html>
"""


_PACK_DETAIL_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>UI Pack</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #0b1120; color: #e6edf3; margin: 0; padding: 24px; }
  a.back { color: #8aa4c5; text-decoration: none; font-size: 13px; }
  a.back:hover { color: #e6edf3; }
  h1 { margin: 10px 0 4px; font-size: 20px; }
  .meta { color: #8aa4c5; font-size: 13px; margin-bottom: 20px; }
  .tabs { margin-bottom: 16px; display: flex; gap: 8px; }
  .tab { padding: 6px 12px; background: #131c2e; border: 1px solid #26334d; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .tab.active { background: #1f2c46; border-color: #5a8adf; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
  .card { background: #131c2e; border: 1px solid #26334d; border-radius: 8px; overflow: hidden; }
  .card img { width: 100%; height: auto; display: block; background: #05080f; }
  .card .name { padding: 8px 10px 4px; font-size: 13px; font-weight: 600; }
  .card .count { padding: 0 10px 6px; font-size: 11px; color: #8aa4c5; }
  .card .actions { padding: 0 10px 10px; display: flex; gap: 6px; }
  button { font-size: 12px; padding: 4px 8px; background: #1f2c46; color: #e6edf3; border: 1px solid #3b5078; border-radius: 4px; cursor: pointer; }
  button:hover { background: #2a3a5c; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
</head>
<body>
<a class="back" href="library-browser.html">&larr; Library</a>
<h1 id="title">Loading...</h1>
<div class="meta" id="meta"></div>
<div class="tabs">
  <div class="tab active" data-kind="screens">Screens</div>
  <div class="tab" data-kind="components">Components</div>
</div>
<div id="grid" class="grid"></div>
<script>
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const params = new URLSearchParams(location.search);
const wantId = params.get('id');
let pack = null, mode = 'library', currentKind = 'screens';

fetch('packs.json').then(r => r.json()).then(data => {
  mode = data.mode;
  pack = (data.packs || []).find(p => p.id === wantId);
  if (!pack) {
    document.getElementById('title').textContent = 'Pack not found';
    return;
  }
  document.getElementById('title').textContent = pack.display_name;
  const s = pack.source || {};
  document.getElementById('meta').textContent =
    s.type + ' | ' + (s.vendor || '') + (s.version ? ' v' + s.version : '') +
    ' | ' + (pack.screen_count || 0) + ' screens, ' + (pack.component_count || 0) + ' components' +
    ' | license: ' + (pack.license && pack.license.tier || '?');
  renderKind('screens');
});

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  currentKind = t.dataset.kind;
  renderKind(currentKind);
}));

function renderKind(kind) {
  const grid = document.getElementById('grid');
  grid.textContent = '';
  const items = (pack && pack[kind]) || [];
  if (!items.length) {
    grid.appendChild(el('div', null, 'No ' + kind + ' in this pack.'));
    return;
  }
  for (const it of items) {
    const card = el('div', 'card');
    const img = new Image();
    img.src = '/images/' + it.thumbnail;
    img.alt = it.name;
    card.appendChild(img);
    card.appendChild(el('div', 'name', it.name));
    card.appendChild(el('div', 'count', it.object_count + ' objects'));
    if (mode === 'picker') {
      const actions = el('div', 'actions');
      for (const m of ['figma', 'engine']) {
        const btn = el('button', null, m === 'figma' ? 'Figma first' : 'Direct to engine');
        btn.addEventListener('click', () => placeScreen(pack.id, kind.slice(0, -1), it.name, m, btn));
        actions.appendChild(btn);
      }
      card.appendChild(actions);
    }
    grid.appendChild(card);
  }
}

function placeScreen(packId, kind, name, mode, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Placing...';
  fetch('/event', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type: 'pack_pick', pack_id: packId, kind: kind, name: name, mode: mode })
  }).then(r => r.json()).then(() => {
    btn.textContent = 'Queued';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  }).catch(() => {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  });
}
</script>
</body>
</html>
"""
