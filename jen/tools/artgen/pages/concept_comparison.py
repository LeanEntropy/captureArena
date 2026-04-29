"""Generate HTML content fragments for UI concept comparison."""

import json
import os


def _esc(text):
    """Basic HTML escaping."""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def _image_url(file_path, data_dir):
    """Convert absolute file_path to /images/... relative URL."""
    images_dir = os.path.join(data_dir, "images")
    rel = os.path.relpath(file_path, images_dir).replace("\\", "/")
    return f"/images/{rel}"


def render_concept_comparison(screen_id, screen_name, concepts, data_dir):
    """Generate HTML for comparing UI concepts for a screen.

    Args:
        screen_id: str - the screen identifier (e.g., "main_menu")
        screen_name: str - display name (e.g., "Main Menu")
        concepts: list of dicts, each with:
            - id: str (concept identifier, e.g., "concept_a")
            - name: str (display name, e.g., "Concept A: Stone Cathedral")
            - description: str (brief description of the visual direction)
            - image_path: str or None (absolute path to Flux mockup image)
            - html_preview: str or None (HTML/CSS code of the coded preview)
            - palette: list of str (hex colors, e.g., ["#1a1a2e", "#e94560"])
        data_dir: str - artgen data directory for computing image URLs

    Returns:
        HTML string (content fragment)
    """
    total = len(concepts)
    esc_screen = _esc(screen_name)
    esc_sid = _esc(screen_id)

    parts = []

    # Header
    parts.append(f"""
<div class="comparison-header">
  <h2>Concept Comparison: {esc_screen}</h2>
  <p class="meta">{total} concept{'s' if total != 1 else ''} for screen
    <strong>{esc_screen}</strong></p>
</div>
""")

    # Concept cards
    for concept in concepts:
        cid = concept.get("id", "")
        cname = concept.get("name", "")
        cdesc = concept.get("description", "")
        image_path = concept.get("image_path")
        html_preview = concept.get("html_preview")
        palette = concept.get("palette", [])

        # Build image column
        if image_path:
            src = _image_url(image_path, data_dir)
            image_html = (f'<img src="{src}" alt="{_esc(cname)}"'
                          f' loading="lazy" />')
        else:
            image_html = ('<div class="placeholder">No mockup generated'
                          '</div>')

        # Build preview column
        if html_preview:
            # Escape for srcdoc attribute
            srcdoc = _esc(html_preview)
            preview_html = (f'<iframe class="concept-iframe" sandbox'
                            f' srcdoc="{srcdoc}"></iframe>')
        else:
            preview_html = ('<div class="placeholder">No code preview'
                            '</div>')

        # Build palette swatches
        swatch_html = ""
        for color in palette:
            esc_color = _esc(color)
            swatch_html += (f'<span class="swatch"'
                            f' style="background:{esc_color};"'
                            f' title="{esc_color}"></span>')

        parts.append(f"""
<div class="concept-card" data-concept="{_esc(cid)}"
     id="card-{_esc(cid)}">
  <div class="concept-title">
    <h3>{_esc(cname)}</h3>
    <p class="concept-desc">{_esc(cdesc)}</p>
  </div>
  <div class="concept-panels">
    <div class="panel panel-image">
      <div class="panel-label">Flux Mockup</div>
      {image_html}
    </div>
    <div class="panel panel-preview">
      <div class="panel-label">HTML Preview (1080x1920)</div>
      <div class="iframe-scaler">
        {preview_html}
      </div>
    </div>
  </div>
  <div class="concept-footer">
    <div class="palette-row">
      <span class="palette-label">Palette:</span>
      {swatch_html}
    </div>
    <button class="btn btn-select"
            onclick="selectConcept('{_esc(esc_sid)}','{_esc(cid)}')">
      &#10003; Select This Direction</button>
  </div>
</div>
""")

    # Combine section
    if total >= 2:
        option_html = ""
        for concept in concepts:
            cid = concept.get("id", "")
            cname = concept.get("name", "")
            option_html += (f'<option value="{_esc(cid)}">'
                            f'{_esc(cname)}</option>')

        parts.append(f"""
<div class="combine-section">
  <h3>Combine Concepts</h3>
  <div class="combine-row">
    <label>Layout from
      <select id="combineLayout">{option_html}</select>
    </label>
    <span class="combine-plus">+</span>
    <label>Colors from
      <select id="combineColors">{option_html}</select>
    </label>
    <button class="btn btn-primary"
            onclick="combineConcepts('{_esc(esc_sid)}')">
      Combine</button>
  </div>
</div>
""")

    # Feedback bar
    parts.append(f"""
<div class="feedback-bar">
  <input type="text" id="sessionFeedback" class="feedback-input"
         placeholder="Session feedback..." />
  <button class="btn btn-primary"
          onclick="submitFeedback('{_esc(esc_sid)}')">Send</button>
</div>
""")

    # Inline script
    parts.append("""
<script>
function selectConcept(screenId, conceptId) {
  document.querySelectorAll('.concept-card').forEach(function(card) {
    card.classList.remove('selected');
  });
  var card = document.getElementById('card-' + conceptId);
  if (card) card.classList.add('selected');
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      type: 'select_concept',
      screen_id: screenId,
      concept_id: conceptId
    })
  });
}
function combineConcepts(screenId) {
  var layoutSel = document.getElementById('combineLayout');
  var colorsSel = document.getElementById('combineColors');
  var layoutFrom = layoutSel.value;
  var colorsFrom = colorsSel.value;
  if (layoutFrom === colorsFrom) {
    alert('Pick different concepts for layout and colors.');
    return;
  }
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      type: 'combine_concepts',
      screen_id: screenId,
      layout_from: layoutFrom,
      colors_from: colorsFrom
    })
  });
}
function submitFeedback(screenId) {
  var input = document.getElementById('sessionFeedback');
  var text = input.value.trim();
  if (!text) return;
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      type: 'feedback',
      screen_id: screenId,
      text: text
    })
  });
  input.value = '';
}
</script>
""")

    # Inline styles
    parts.append("""
<style>
.comparison-header { margin-bottom: 1rem; }
.comparison-header h2 { margin: 0; color: #ddd; }
.meta { color: #888; font-size: 0.9em; }

.concept-card {
  background: #1e1e1e; border: 2px solid #333; border-radius: 8px;
  margin-bottom: 1.5rem; overflow: hidden;
  transition: border-color 0.2s;
}
.concept-card.selected { border-color: #4caf50; }

.concept-title { padding: 16px 20px 8px; }
.concept-title h3 { margin: 0 0 4px; color: #ddd; font-size: 1.15em; }
.concept-desc { margin: 0; color: #888; font-size: 0.9em; }

.concept-panels {
  display: flex; gap: 1rem; padding: 8px 20px 12px;
  justify-content: center;
}
.panel {
  flex: 0 0 auto; background: #161616;
  border: 1px solid #2a2a2a; border-radius: 6px; overflow: hidden;
}
.panel-image {
  width: 280px;
}
.panel-preview {
  width: 280px;
}
.panel-label {
  padding: 4px 10px; font-size: 0.75em; color: #666;
  text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid #2a2a2a;
}
.panel-image img {
  width: 100%; display: block;
}
.iframe-scaler {
  width: 280px;
  height: 498px;
  overflow: hidden;
  position: relative;
}
.concept-iframe {
  width: 1080px;
  height: 1920px;
  border: none;
  background: #000;
  transform: scale(0.2593);
  transform-origin: top left;
}
.placeholder {
  display: flex; align-items: center; justify-content: center;
  height: 498px; color: #555; font-size: 0.9em;
}

.concept-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px 16px;
}
.palette-row { display: flex; align-items: center; gap: 6px; }
.palette-label { color: #888; font-size: 0.85em; margin-right: 2px; }
.swatch {
  display: inline-block; width: 24px; height: 24px;
  border-radius: 4px; border: 1px solid #444;
}

.btn {
  padding: 6px 14px; border: 1px solid #555; background: #2a2a2a;
  color: #ddd; cursor: pointer; border-radius: 4px; font-size: 0.9em;
}
.btn:hover { border-color: #888; }
.btn-primary { background: #1976d2; border-color: #1976d2; }
.btn-primary:hover { background: #2196f3; }
.btn-select { background: #1976d2; border-color: #1976d2; }
.btn-select:hover { background: #2196f3; }
.concept-card.selected .btn-select {
  background: #2e7d32; border-color: #4caf50;
}

.combine-section {
  background: #1a1a1a; border: 1px solid #333; border-radius: 8px;
  padding: 16px 20px; margin-bottom: 1.5rem;
}
.combine-section h3 { margin: 0 0 10px; color: #ddd; font-size: 1em; }
.combine-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.combine-row label { color: #ccc; font-size: 0.9em; }
.combine-row select {
  padding: 4px 8px; background: #2a2a2a; border: 1px solid #555;
  color: #ddd; border-radius: 3px; margin-left: 4px;
}
.combine-plus { color: #666; font-size: 1.2em; }

.feedback-bar {
  position: sticky; bottom: 0; background: #1a1a1a;
  padding: 10px; display: flex; gap: 8px;
  border-top: 1px solid #333;
}
.feedback-input {
  flex: 1; padding: 6px 10px; background: #2a2a2a;
  border: 1px solid #444; color: #ddd; border-radius: 3px;
}
</style>
""")

    return "\n".join(parts)
