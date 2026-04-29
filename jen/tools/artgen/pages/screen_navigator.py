"""Generate HTML content fragment for navigating game screens."""

import json


def _esc(text):
    """Basic HTML escaping."""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


_STATUS_COLORS = {
    "pending": "#666",
    "concept": "#1976d2",
    "reviewing": "#ff9800",
    "approved": "#4caf50",
    "exported": "#9c27b0",
}

_STATUS_LABELS = {
    "pending": "Pending",
    "concept": "Concept",
    "reviewing": "Reviewing",
    "approved": "Approved",
    "exported": "Exported",
}

_TYPE_COLORS = {
    "menu": "#1976d2",
    "overlay": "#ff9800",
    "hud": "#4caf50",
    "dialog": "#9c27b0",
    "fullscreen": "#f44336",
}

_TYPE_ICONS = {
    "menu": "\u2630",
    "overlay": "\u25fb",
    "hud": "\u25a3",
    "dialog": "\U0001f4ac",
    "fullscreen": "\u2b1c",
}

_ACTION_BY_STATUS = {
    "pending": ("Start Concepts", "start"),
    "concept": ("Review", "review"),
    "reviewing": ("Review", "review"),
    "approved": ("View", "view"),
    "exported": ("Export", "export"),
}


def render_screen_navigator(game_name, screens, flow_graph=None):
    """Generate HTML for navigating all screens in a game.

    Args:
        game_name: str - game display name
        screens: list of dicts, each with:
            - id: str (screen identifier)
            - name: str (display name)
            - type: str (menu, overlay, hud, dialog, fullscreen)
            - element_count: int (number of elements)
            - status: str (pending, concept, reviewing, approved, exported)
            - thumbnail_url: str or None (path to thumbnail image)
        flow_graph: dict or None - mapping screen_id -> list of connected
            screen_ids

    Returns:
        HTML string (content fragment)
    """
    total = len(screens)
    status_counts = {}
    for s in screens:
        st = s.get("status", "pending")
        status_counts[st] = status_counts.get(st, 0) + 1

    summary_parts = []
    for st in ("approved", "exported", "reviewing", "concept", "pending"):
        c = status_counts.get(st, 0)
        if c > 0:
            color = _STATUS_COLORS.get(st, "#666")
            label = _STATUS_LABELS.get(st, st)
            summary_parts.append(
                f'<span style="color:{color}">{c} {label.lower()}</span>')

    summary_text = " &middot; ".join(summary_parts)

    parts = []

    # Header
    parts.append(f"""
<div class="sn-header">
  <h2>{_esc(game_name)} &mdash; Screen Overview</h2>
  <p class="sn-meta">
    {total} screen{"s" if total != 1 else ""} &middot; {summary_text}
  </p>
</div>
""")

    # Filter bar
    parts.append("""
<div class="sn-controls">
  <div class="sn-filter-toggle">
    <button onclick="snFilter('all')" class="btn active">All</button>
    <button onclick="snFilter('pending')" class="btn">Pending</button>
    <button onclick="snFilter('concept')" class="btn">Concept</button>
    <button onclick="snFilter('reviewing')" class="btn">Reviewing</button>
    <button onclick="snFilter('approved')" class="btn">Approved</button>
    <button onclick="snFilter('exported')" class="btn">Exported</button>
  </div>
</div>
""")

    # Screen grid
    parts.append('<div class="sn-grid" id="snGrid">')
    for screen in screens:
        sid = screen.get("id", "")
        name = screen.get("name", sid)
        stype = screen.get("type", "menu")
        element_count = screen.get("element_count", 0)
        status = screen.get("status", "pending")
        thumbnail_url = screen.get("thumbnail_url")

        status_color = _STATUS_COLORS.get(status, "#666")
        status_label = _STATUS_LABELS.get(status, status)
        type_color = _TYPE_COLORS.get(stype, "#666")
        type_icon = _TYPE_ICONS.get(stype, "\u25a1")
        action_label, action_name = _ACTION_BY_STATUS.get(
            status, ("View", "view"))

        # Thumbnail or placeholder
        if thumbnail_url:
            thumb_html = (
                f'<img src="{_esc(thumbnail_url)}" '
                f'alt="{_esc(name)}" loading="lazy" />'
            )
        else:
            thumb_html = (
                f'<div class="sn-placeholder" '
                f'style="background:{type_color}22;color:{type_color}">'
                f'<span class="sn-placeholder-icon">{type_icon}</span>'
                f'</div>'
            )

        parts.append(f"""
  <div class="sn-card" data-status="{_esc(status)}"
       data-screen-id="{_esc(sid)}"
       onclick="snNavigate('{_esc(sid)}', 'review')">
    <div class="sn-thumb">{thumb_html}</div>
    <div class="sn-card-body">
      <div class="sn-card-title">{_esc(name)}</div>
      <div class="sn-card-badges">
        <span class="sn-type-badge"
              style="background:{type_color}22;color:{type_color};
                     border:1px solid {type_color}44">{_esc(stype)}</span>
        <span class="sn-status-badge"
              style="background:{status_color}22;color:{status_color};
                     border:1px solid {status_color}44">{status_label}</span>
      </div>
      <div class="sn-card-info">{element_count} element{"s" if element_count != 1 else ""}</div>
      <button class="btn sn-action-btn"
              style="border-color:{status_color};color:{status_color}"
              onclick="event.stopPropagation();snNavigate('{_esc(sid)}','{action_name}')">{action_label}</button>
    </div>
  </div>
""")
    parts.append("</div>")

    # Flow graph
    if flow_graph:
        parts.append("""
<div class="sn-flow">
  <h3>Screen Flow</h3>
  <div class="sn-flow-list">
""")
        for src_id, targets in flow_graph.items():
            target_str = ", ".join(_esc(t) for t in targets)
            parts.append(
                f'    <div class="sn-flow-row">'
                f'<span class="sn-flow-src">{_esc(src_id)}</span>'
                f' &rarr; [{target_str}]</div>\n')
        parts.append("  </div>\n</div>\n")

    # Inline script
    parts.append("""
<script>
function snFilter(status) {
  document.querySelectorAll('.sn-filter-toggle .btn').forEach(
    function(b) { b.classList.remove('active'); });
  event.target.classList.add('active');
  document.querySelectorAll('.sn-card').forEach(function(card) {
    if (status === 'all' || card.dataset.status === status)
      card.style.display = '';
    else
      card.style.display = 'none';
  });
}
function snNavigate(screenId, action) {
  fetch('/event', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      type: 'navigate_screen',
      screen_id: screenId,
      action: action
    })
  });
}
</script>
""")

    # Inline styles
    parts.append("""
<style>
.sn-header { margin-bottom: 1rem; }
.sn-header h2 { margin: 0; color: #ddd; }
.sn-meta { color: #888; font-size: 0.9em; margin-top: 4px; }
.sn-controls { display: flex; gap: 1rem; margin-bottom: 1rem;
               flex-wrap: wrap; }
.sn-filter-toggle { display: flex; gap: 4px; }
.btn { padding: 4px 12px; border: 1px solid #555; background: #2a2a2a;
       color: #ddd; cursor: pointer; border-radius: 3px; font-size: 0.85em; }
.btn.active { background: #444; border-color: #888; }
.btn:hover { background: #383838; }
.sn-grid { display: grid;
           grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
           gap: 1rem; }
.sn-card { background: #1a1a1a; border: 1px solid #333;
           border-radius: 6px; overflow: hidden; cursor: pointer;
           transition: border-color 0.15s; }
.sn-card:hover { border-color: #555; }
.sn-thumb { width: 100%; height: 140px; overflow: hidden;
            background: #1e1e1e; }
.sn-thumb img { width: 100%; height: 100%; object-fit: cover;
                display: block; }
.sn-placeholder { width: 100%; height: 100%; display: flex;
                  align-items: center; justify-content: center; }
.sn-placeholder-icon { font-size: 2.5rem; }
.sn-card-body { padding: 10px 12px; }
.sn-card-title { font-size: 0.95em; color: #ddd; font-weight: 600;
                 margin-bottom: 6px; white-space: nowrap;
                 overflow: hidden; text-overflow: ellipsis; }
.sn-card-badges { display: flex; gap: 6px; margin-bottom: 6px; }
.sn-type-badge, .sn-status-badge {
  padding: 1px 8px; border-radius: 3px; font-size: 0.75em;
  text-transform: uppercase; letter-spacing: 0.5px; }
.sn-card-info { color: #888; font-size: 0.8em; margin-bottom: 8px; }
.sn-action-btn { width: 100%; text-align: center; padding: 5px 0;
                 font-size: 0.8em; text-transform: uppercase;
                 letter-spacing: 0.5px; }
.sn-flow { margin-top: 1.5rem; padding: 12px; background: #1a1a1a;
           border: 1px solid #333; border-radius: 6px; }
.sn-flow h3 { margin: 0 0 8px 0; color: #ccc; font-size: 0.95em; }
.sn-flow-list { font-family: monospace; font-size: 0.85em; color: #aaa; }
.sn-flow-row { padding: 3px 0; }
.sn-flow-src { color: #ddd; }
</style>
""")

    return "\n".join(parts)
