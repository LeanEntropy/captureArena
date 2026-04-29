"""Generate HTML content fragments for session review."""

import json
import os


def _rating_class(rating):
    return {
        "approved": "border-approved",
        "maybe": "border-maybe",
        "reject": "border-reject",
        "reference": "border-approved",
    }.get(rating, "")


def _rating_label(rating):
    return {
        "approved": "Approved",
        "maybe": "Maybe",
        "reject": "Rejected",
        "reference": "Reference",
        "unrated": "Unrated",
    }.get(rating, rating)


def _count_ratings(images):
    counts = {"unrated": 0, "approved": 0, "maybe": 0,
              "reject": 0, "reference": 0}
    for img in images:
        r = img["rating"] if isinstance(img, dict) else img["rating"]
        counts[r] = counts.get(r, 0) + 1
    return counts


def _image_url(file_path, data_dir):
    """Convert absolute file_path to /images/... relative URL."""
    images_dir = os.path.join(data_dir, "images")
    rel = os.path.relpath(file_path, images_dir).replace("\\", "/")
    return f"/images/{rel}"


def render_session_review(session, images, data_dir):
    """Generate HTML content fragment for reviewing a session's images.

    Args:
        session: session Row/dict with id, name, created_at, etc.
        images: list of image Row/dicts.
        data_dir: the artgen data directory (for computing image URLs).

    Returns:
        HTML string (content fragment, not full document).
    """
    sess_name = session["name"] if not isinstance(session, dict) \
        else session.get("name", "")
    sess_id = session["id"] if not isinstance(session, dict) \
        else session.get("id", "")
    sess_date = session["created_at"] if not isinstance(session, dict) \
        else session.get("created_at", "")
    counts = _count_ratings(images)
    total = len(images)

    # Header
    parts = [f"""
<div class="session-header">
  <h2>{_esc(sess_name)}</h2>
  <p class="meta">
    {sess_date[:10]} &middot; {total} images &middot;
    <span class="badge-approved">{counts['approved']} approved</span>
    <span class="badge-maybe">{counts['maybe']} maybe</span>
    <span class="badge-reject">{counts['reject']} rejected</span>
    <span class="badge-unrated">{counts['unrated']} unrated</span>
  </p>
</div>
"""]

    # Filter controls only (scale is in frame header)
    parts.append("""
<div class="controls">
  <div class="filter-toggle">
    <button onclick="filterCards('all')" class="btn active">All</button>
    <button onclick="filterCards('unrated')" class="btn">Unrated</button>
    <button onclick="filterCards('maybe')" class="btn">Maybe</button>
    <button onclick="filterCards('approved')" class="btn">Approved</button>
    <button onclick="filterCards('reject')" class="btn">Rejected</button>
  </div>
</div>
""")

    # Image grid
    parts.append('<div class="image-grid" id="imageGrid">')
    for img in images:
        row = dict(img) if not isinstance(img, dict) else img
        img_id = row["id"]
        rating = row.get("rating", "unrated")
        rc = _rating_class(rating)
        src = _image_url(row["file_path"], data_dir) if row.get(
            "file_path") else ""
        asset_name = row.get("asset_name", "")
        tribe = row.get("tribe", "")
        seed = row.get("seed", "")
        model = row.get("model", "")
        model_short = model.split("/")[-1] if model else ""

        tribe_badge = (f'<span class="tribe-badge">{_esc(tribe)}</span>'
                       if tribe else "")

        parts.append(f"""
  <div class="image-card {rc}" data-rating="{rating}" data-id="{img_id}">
    <div class="image-wrap">
      <img src="{src}" alt="{_esc(asset_name)}" loading="lazy" />
    </div>
    <div class="card-footer">
      <span class="card-label">{_esc(asset_name or 'untitled')} <small>s{seed}</small></span>
      <span class="rating-buttons">
        <button class="rate-btn rate-keep{' active' if rating == 'approved' else ''}"
                onclick="rateImage('{img_id}', 'approved')"
                title="Keep">Keep</button>
        <button class="rate-btn rate-reject{' active' if rating == 'reject' else ''}"
                onclick="rateImage('{img_id}', 'reject')"
                title="Reject">Reject</button>
        <button class="rate-btn rate-modify{' active' if rating == 'maybe' else ''}"
                onclick="rateModify('{img_id}')"
                title="Modify">Modify</button>
      </span>
    </div>
    <div class="comment-row">
      <input type="text" class="comment-input" id="comment-{img_id[:8]}"
             placeholder="Add note..."
             onkeydown="if(event.key==='Enter')submitComment('{img_id}',this)" />
    </div>
  </div>
""")
    parts.append("</div>")

    # Feedback bar
    parts.append(f"""
<div class="feedback-bar">
  <input type="text" id="sessionFeedback" class="feedback-input"
         placeholder="Session feedback..." />
  <button class="btn btn-primary"
          onclick="submitFeedback('{sess_id}')">Send</button>
</div>
""")

    # Inline script
    parts.append("""
<script>
function setScale(size) {
  document.querySelectorAll('.scale-toggle .btn').forEach(
    b => b.classList.remove('active'));
  event.target.classList.add('active');
  const grid = document.getElementById('imageGrid');
  grid.className = 'image-grid scale-' + size;
}
function filterCards(rating) {
  document.querySelectorAll('.filter-toggle .btn').forEach(
    b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.image-card').forEach(card => {
    if (rating === 'all' || card.dataset.rating === rating)
      card.style.display = '';
    else
      card.style.display = 'none';
  });
}
function rateImage(imageId, rating) {
  var card = document.querySelector('[data-id="'+imageId+'"]');
  var input = card.querySelector('.comment-input');
  var comment = input ? input.value.trim() : '';
  card.dataset.rating = rating;
  card.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('active'));
  var cls = {approved:'rate-keep',reject:'rate-reject',maybe:'rate-modify'}[rating];
  var btn = card.querySelector('.'+cls);
  if (btn) btn.classList.add('active');
  card.className = card.className.replace(/border-\\w+/g, '');
  var bc = {approved:'border-approved',maybe:'border-maybe',
            reject:'border-reject'}[rating] || '';
  if (bc) card.classList.add(bc);
  var payload = {type:'rate', image_id:imageId, rating:rating};
  if (comment) payload.comment = comment;
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)});
  if (comment && input) input.value = '';
}
function rateModify(imageId) {
  var card = document.querySelector('[data-id="'+imageId+'"]');
  var row = card.querySelector('.comment-row');
  row.classList.add('required');
  var input = card.querySelector('.comment-input');
  input.placeholder = 'What to change? (required)';
  input.focus();
  input.onkeydown = function(e) {
    if (e.key === 'Enter' && input.value.trim()) {
      rateImage(imageId, 'maybe');
      row.classList.remove('required');
      input.placeholder = 'Add note...';
      input.onkeydown = null;
    }
  };
}
function submitComment(imageId, input) {
  var text = input.value.trim();
  if (!text) return;
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({type:'comment', image_id:imageId, text:text})});
  input.value = '';
}
function submitFeedback(sessionId) {
  var input = document.getElementById('sessionFeedback');
  var text = input.value.trim();
  if (!text) return;
  fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({type:'feedback', session_id:sessionId, text:text})});
  input.value = '';
}
</script>
""")

    # Inline styles
    parts.append("""
<style>
.session-header { margin-bottom: 1rem; }
.session-header h2 { margin: 0; }
.meta { color: #888; font-size: 0.9em; }
.badge-approved { color: #4caf50; } .badge-maybe { color: #ff9800; }
.badge-reject { color: #f44336; } .badge-unrated { color: #999; }
.controls { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.btn { padding: 4px 12px; border: 1px solid #555; background: #2a2a2a;
       color: #ddd; cursor: pointer; border-radius: 3px; }
.btn.active { background: #444; border-color: #888; }
.btn-primary { background: #1976d2; border-color: #1976d2; }
.image-grid { display: grid; grid-template-columns: repeat(auto-fill,
              minmax(280px, 1fr)); gap: 1rem; }
.image-grid.scale-128 { grid-template-columns: repeat(auto-fill,
                         minmax(160px, 1fr)); }
.image-grid.scale-64 { grid-template-columns: repeat(auto-fill,
                        minmax(96px, 1fr)); }
.image-card { background: #1e1e1e; border: 2px solid #333;
              border-radius: 6px; overflow: hidden; }
.border-approved { border-color: #4caf50; }
.border-maybe { border-color: #ff9800; }
.border-reject { border-color: #f44336; }
.image-wrap img { width: 100%; display: block; cursor: pointer; }
.scale-128 .image-wrap img { max-height: 128px; object-fit: cover; }
.scale-64 .image-wrap img { max-height: 64px; object-fit: cover; }
.card-footer { display: flex; justify-content: space-between;
               align-items: center; padding: 6px 8px; }
.card-label { font-size: 0.85em; color: #ccc; }
.card-label small { color: #666; }
.rating-buttons { display: flex; gap: 4px; }
.rate-btn { padding: 2px 8px; border: 1px solid #444;
            background: #2a2a2a; color: #777; cursor: pointer;
            border-radius: 3px; font-size: 0.75em; text-transform: uppercase;
            letter-spacing: 0.5px; }
.rate-btn:hover { color: #ddd; border-color: #666; }
.rate-btn.active { color: #fff; }
.rate-keep.active { background: #2e7d32; border-color: #4caf50; }
.rate-modify.active { background: #e65100; border-color: #ff9800; }
.rate-reject.active { background: #c62828; border-color: #f44336; }
.comment-row { display: none; }
.image-card:hover .comment-row,
.comment-row.required { display: block; }
.comment-input { width: 100%; padding: 5px 8px; background: #161616;
                 border: none; border-top: 1px solid #2a2a2a;
                 color: #888; font-size: 0.8em; box-sizing: border-box; }
.comment-row.required .comment-input { border-top-color: #ff9800;
                 background: #1a1500; color: #ddd; }
.comment-input:focus { color: #ddd; outline: none; }
.feedback-bar { position: sticky; bottom: 0; background: #1a1a1a;
                padding: 10px; display: flex; gap: 8px;
                border-top: 1px solid #333; }
.feedback-input { flex: 1; padding: 6px 10px; background: #2a2a2a;
                  border: 1px solid #444; color: #ddd; border-radius: 3px; }
</style>
""")

    return "\n".join(parts)


def _esc(text):
    """Basic HTML escaping."""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))
