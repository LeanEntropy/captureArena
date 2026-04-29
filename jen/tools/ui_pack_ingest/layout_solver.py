"""Unity UI layout system simulation.

Unity's runtime layout is a 2-pass system:
  Pass 1 (bottom up)  — compute preferred/min width and height for every node
  Pass 2 (top down)   — parents with LayoutGroup place and size their children;
                        ContentSizeFitter then resizes the parent to match

We run both passes over the parsed tree and mutate each node's `rect.size_delta`
and `rect.anchored_pos` to reflect what Unity would compute at runtime. After
this, `rect_math.annotate_abs_rects` produces correct abs rects.

Scope:
  - HorizontalLayoutGroup, VerticalLayoutGroup
  - GridLayoutGroup (Flexible / FixedColumnCount / FixedRowCount)
  - ContentSizeFitter (Horizontal + Vertical, PreferredSize mode)
  - LayoutElement (preferred/min overrides from the child)

Not covered (degrade gracefully — serialized values are used unchanged):
  - Nested ContentSizeFitter cycles (single pass is enough for vendor packs we've seen)
  - AspectRatioFitter
  - Custom layout controllers from third-party scripts
"""
from __future__ import annotations


# --- preferred-size lookup --------------------------------------------------

def _layout_element(node: dict) -> dict | None:
    for c in node.get("components", []):
        if c.get("type") == "LayoutElement" and not c.get("ignore_layout"):
            return c
    return None


# Approximate text extent. TMP's real preferred size depends on font metrics we
# don't have here; empirically ~0.55 em for mixed-case Latin in chunky UI fonts
# like Lilita One and ~1.2 for line-height.
_TEXT_EM_W = 0.55
_TEXT_LINE_H = 1.2


def _text_preferred_size(node: dict) -> tuple[float, float] | None:
    for c in node.get("components", []):
        if c.get("type") in ("Text", "TextMeshProUGUI"):
            raw = c.get("text")
            text = str(raw) if raw is not None else ""
            if not text:
                return None
            fs = float(c.get("font_size") or 36)
            # Use the longest line for width; count newlines + 1 for height
            lines = text.split("\n") or [text]
            longest = max((len(ln) for ln in lines), default=0)
            return (longest * fs * _TEXT_EM_W, len(lines) * fs * _TEXT_LINE_H)
    return None


def _preferred_width(node: dict) -> float:
    le = _layout_element(node)
    if le:
        for key in ("preferred_width", "min_width"):
            v = le.get(key, -1)
            if v is not None and v >= 0:
                return float(v)

    for c in node.get("components", []):
        t = c.get("type")
        if t in ("HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup"):
            return _layout_group_preferred_w(node, c)

    txt = _text_preferred_size(node)
    if txt is not None:
        return txt[0]

    # Image.preferredWidth in Unity = sprite native pixel width (when sprite has one)
    img = _image_native_size(node)
    if img is not None:
        rt = node.get("rect") or {}
        sd = (rt.get("size_delta") or [0, 0])
        if sd[0] <= 0:
            return float(img[0])

    rt = node.get("rect") or {}
    return float((rt.get("size_delta") or [0, 0])[0])


def _image_native_size(node: dict) -> list[int] | None:
    for c in node.get("components", []):
        if c.get("type") in ("Image", "RawImage"):
            s = c.get("sprite") or c.get("texture") or {}
            ns = s.get("native_size")
            if ns and ns[0] > 0 and ns[1] > 0:
                return ns
    return None


def _preferred_height(node: dict) -> float:
    le = _layout_element(node)
    if le:
        for key in ("preferred_height", "min_height"):
            v = le.get(key, -1)
            if v is not None and v >= 0:
                return float(v)

    for c in node.get("components", []):
        t = c.get("type")
        if t in ("HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup"):
            return _layout_group_preferred_h(node, c)

    txt = _text_preferred_size(node)
    if txt is not None:
        return txt[1]

    img = _image_native_size(node)
    if img is not None:
        rt = node.get("rect") or {}
        sd = (rt.get("size_delta") or [0, 0])
        if sd[1] <= 0:
            return float(img[1])

    rt = node.get("rect") or {}
    return float((rt.get("size_delta") or [0, 0])[1])


def _active_children(node: dict) -> list[dict]:
    return [c for c in node.get("children", []) if c.get("active", True)]


# --- per-group preferred size computation -----------------------------------

def _layout_group_preferred_w(node: dict, group: dict) -> float:
    t = group["type"]
    pad = group.get("padding", {"left": 0, "right": 0, "top": 0, "bottom": 0})
    pad_lr = pad["left"] + pad["right"]
    children = _active_children(node)

    if t == "HorizontalLayoutGroup":
        if not children:
            return pad_lr
        widths = [_preferred_width(c) for c in children]
        spacing = float(group.get("spacing", 0))
        return pad_lr + sum(widths) + max(0, len(widths) - 1) * spacing

    if t == "VerticalLayoutGroup":
        if not children:
            return pad_lr
        return pad_lr + max(_preferred_width(c) for c in children)

    if t == "GridLayoutGroup":
        cells = len(children)
        if cells == 0:
            return pad_lr
        cell_w = group["cell_size"][0]
        sp_x = group["spacing"][0]
        parent_inner_w = _grid_parent_inner_w(node)
        cols = _grid_cols(cells, group, parent_inner_w)
        return pad_lr + cols * cell_w + max(0, cols - 1) * sp_x

    return 0.0


def _grid_parent_inner_w(node: dict) -> float | None:
    """Return the grid's own available inner width for Flexible-constraint column math.
    Reads size_delta (set pre-solver by serialized data or by a parent LayoutGroup
    that already ran)."""
    rt = node.get("rect") or {}
    w = float((rt.get("size_delta") or [0, 0])[0])
    for c in node.get("components", []):
        if c.get("type") == "GridLayoutGroup":
            pad = c.get("padding", {"left": 0, "right": 0})
            return max(0.0, w - pad["left"] - pad["right"])
    return None


def _layout_group_preferred_h(node: dict, group: dict) -> float:
    t = group["type"]
    pad = group.get("padding", {"left": 0, "right": 0, "top": 0, "bottom": 0})
    pad_tb = pad["top"] + pad["bottom"]
    children = _active_children(node)

    if t == "VerticalLayoutGroup":
        if not children:
            return pad_tb
        heights = [_preferred_height(c) for c in children]
        spacing = float(group.get("spacing", 0))
        return pad_tb + sum(heights) + max(0, len(heights) - 1) * spacing

    if t == "HorizontalLayoutGroup":
        if not children:
            return pad_tb
        return pad_tb + max(_preferred_height(c) for c in children)

    if t == "GridLayoutGroup":
        cells = len(children)
        if cells == 0:
            return pad_tb
        cell_h = group["cell_size"][1]
        sp_y = group["spacing"][1]
        parent_inner_w = _grid_parent_inner_w(node)
        rows = _grid_rows(cells, group, parent_inner_w)
        return pad_tb + rows * cell_h + max(0, rows - 1) * sp_y

    return 0.0


def _grid_cols(cell_count: int, group: dict, parent_inner_w: float | None = None) -> int:
    constraint = group["constraint"]
    count = max(1, int(group.get("constraint_count", 0) or 1))
    if constraint == 1:          # FixedColumnCount
        return count
    if constraint == 2:          # FixedRowCount — cols derived
        rows = count
        return max(1, (cell_count + rows - 1) // rows)
    # Flexible: fit as many cells as possible in the parent's inner width
    if parent_inner_w is not None and parent_inner_w > 0:
        cw = float(group["cell_size"][0])
        sp = float(group["spacing"][0])
        if cw > 0:
            cols = max(1, int((parent_inner_w + sp) // (cw + sp)))
            return min(cols, max(1, cell_count))
    import math
    return max(1, int(math.ceil(math.sqrt(cell_count))))


def _grid_rows(cell_count: int, group: dict, parent_inner_w: float | None = None) -> int:
    constraint = group["constraint"]
    count = max(1, int(group.get("constraint_count", 0) or 1))
    if constraint == 2:          # FixedRowCount
        return count
    if constraint == 1:          # FixedColumnCount — rows derived
        cols = count
        return max(1, (cell_count + cols - 1) // cols)
    cols = _grid_cols(cell_count, group, parent_inner_w)
    return max(1, (cell_count + cols - 1) // cols)


# --- pass 1: bottom-up preferred-size stamp ---------------------------------

def _stamp_preferred(node: dict) -> None:
    for c in _active_children(node):
        _stamp_preferred(c)
    node["_preferred_w"] = _preferred_width(node)
    node["_preferred_h"] = _preferred_height(node)


# --- pass 2: apply ContentSizeFitter + LayoutGroup to rects -----------------

def _content_size_fitter(node: dict) -> dict | None:
    for c in node.get("components", []):
        if c.get("type") == "ContentSizeFitter":
            return c
    return None


def _layout_group(node: dict) -> dict | None:
    for c in node.get("components", []):
        if c.get("type") in ("HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup"):
            return c
    return None


def _apply_size_fitter(node: dict) -> None:
    csf = _content_size_fitter(node)
    if not csf:
        return
    rect = node.get("rect") or {}
    size = list(rect.get("size_delta") or [0, 0])
    if csf.get("horizontal_fit", 0) == 2:   # PreferredSize
        size[0] = node.get("_preferred_w", size[0])
    if csf.get("vertical_fit", 0) == 2:
        size[1] = node.get("_preferred_h", size[1])
    rect["size_delta"] = size
    node["rect"] = rect


def _apply_layout_group(node: dict) -> None:
    """Place + size children of a LayoutGroup parent."""
    group = _layout_group(node)
    if not group:
        return
    rect = node.get("rect") or {}
    size = rect.get("size_delta") or [0, 0]
    parent_w = size[0] or node.get("_preferred_w", 0)
    parent_h = size[1] or node.get("_preferred_h", 0)

    pad = group.get("padding", {"left": 0, "right": 0, "top": 0, "bottom": 0})
    inner_w = max(0.0, parent_w - pad["left"] - pad["right"])
    inner_h = max(0.0, parent_h - pad["top"] - pad["bottom"])
    children = _active_children(node)
    if not children:
        return

    t = group["type"]

    if t == "HorizontalLayoutGroup":
        spacing = float(group.get("spacing", 0))
        widths = [_preferred_width(c) for c in children]
        total = sum(widths) + max(0, len(widths) - 1) * spacing
        extra = max(0.0, inner_w - total) if group.get("child_force_expand_width") else 0.0
        per_extra = extra / len(children) if children else 0.0
        # child_alignment X-offset: shifts whole block when not force-expanding
        start_offset_x = _align_x_offset(group.get("child_alignment", 0), inner_w, total) if not group.get("child_force_expand_width") else 0.0
        cursor_x = pad["left"] + start_offset_x
        for i, c in enumerate(children):
            w = widths[i] + per_extra
            if group.get("child_control_height"):
                h = inner_h
            else:
                h = _preferred_height(c)
            y_off = _align_y_offset(group.get("child_alignment", 0), inner_h, h)
            _set_child_local_rect(c, cursor_x, pad["top"] + y_off, w, h, parent_w, parent_h)
            cursor_x += w + spacing

    elif t == "VerticalLayoutGroup":
        spacing = float(group.get("spacing", 0))
        heights = [_preferred_height(c) for c in children]
        total = sum(heights) + max(0, len(heights) - 1) * spacing
        extra = max(0.0, inner_h - total) if group.get("child_force_expand_height") else 0.0
        per_extra = extra / len(children) if children else 0.0
        start_offset_y = _align_y_offset(group.get("child_alignment", 0), inner_h, total) if not group.get("child_force_expand_height") else 0.0
        cursor_y = pad["top"] + start_offset_y
        for i, c in enumerate(children):
            h = heights[i] + per_extra
            if group.get("child_control_width"):
                w = inner_w
            else:
                w = _preferred_width(c)
            x_off = _align_x_offset(group.get("child_alignment", 0), inner_w, w)
            _set_child_local_rect(c, pad["left"] + x_off, cursor_y, w, h, parent_w, parent_h)
            cursor_y += h + spacing

    elif t == "GridLayoutGroup":
        cells = len(children)
        cell_w, cell_h = group["cell_size"]
        sp_x, sp_y = group["spacing"]
        cols = _grid_cols(cells, group, inner_w)
        rows = _grid_rows(cells, group, inner_w)
        for i, c in enumerate(children):
            if group["start_axis"] == 0:       # Horizontal — fill rows first
                col = i % cols
                row = i // cols
            else:                              # Vertical — fill columns first
                col = i // rows
                row = i % rows
            if group["start_corner"] in (1, 3):
                col = cols - 1 - col
            if group["start_corner"] in (2, 3):
                row = rows - 1 - row
            x = pad["left"] + col * (cell_w + sp_x)
            y = pad["top"]  + row * (cell_h + sp_y)
            _set_child_local_rect(c, x, y, cell_w, cell_h, parent_w, parent_h)


# Unity LayoutGroup.childAlignment enum:
#   0 UpperLeft    1 UpperCenter  2 UpperRight
#   3 MiddleLeft   4 MiddleCenter 5 MiddleRight
#   6 LowerLeft    7 LowerCenter  8 LowerRight
def _align_x_offset(child_alignment: int, inner: float, content: float) -> float:
    extra = max(0.0, inner - content)
    col = (child_alignment or 0) % 3   # 0 left / 1 center / 2 right
    if col == 1: return extra / 2
    if col == 2: return extra
    return 0.0


def _align_y_offset(child_alignment: int, inner: float, content: float) -> float:
    extra = max(0.0, inner - content)
    row = (child_alignment or 0) // 3  # 0 upper / 1 middle / 2 lower
    if row == 1: return extra / 2
    if row == 2: return extra
    return 0.0


def _set_child_local_rect(child: dict, x: float, y: float, w: float, h: float,
                          parent_w: float, parent_h: float) -> None:
    """Force an explicit rect onto a child, in parent-top-left coords (Y-down inside the
    layout frame). rect_math uses Unity (Y-up) so we convert: unity_y = parent_h - y - h.

    We fix anchors to (0,0)-(0,0) point-anchor at parent's bottom-left so abs rect math
    gives us exactly (x, parent_h - y - h, w, h) in Unity convention.
    """
    rect = child.get("rect") or {}
    rect["anchor_min"] = [0.0, 0.0]
    rect["anchor_max"] = [0.0, 0.0]
    rect["pivot"]      = [0.0, 0.0]
    rect["anchored_pos"] = [x, parent_h - y - h]
    rect["size_delta"] = [w, h]
    child["rect"] = rect


# --- public API -------------------------------------------------------------

def solve(root: dict) -> None:
    """Mutates tree in place. Run before rect_math.annotate_abs_rects."""
    _stamp_preferred(root)
    _apply_and_recurse(root)


def _apply_and_recurse(node: dict) -> None:
    _apply_size_fitter(node)
    _apply_layout_group(node)
    _apply_fill_under_mask(node)
    _apply_named_fill_heuristic(node)
    for c in _active_children(node):
        _apply_and_recurse(c)


def _apply_named_fill_heuristic(parent: dict) -> None:
    """Broader safety net: progress fills often sit under non-Mask parents (plain
    Image or custom-script containers) with size 0 or negative. Any Image-sprite
    child whose name starts with 'Fill' and has invalid size gets stretched to
    the parent rect."""
    for c in _active_children(parent):
        name = (c.get("name") or "")
        if not (name == "Fill" or name.startswith("Fill_")):
            continue
        # Don't clobber Mask containers named "Fill_Mask" — they wrap the real fills
        if any(x.get("type") in ("Mask", "RectMask2D") for x in c.get("components", [])):
            continue
        if not _has_image_sprite(c):
            continue
        rt = c.get("rect") or {}
        w, h = (rt.get("size_delta") or [0, 0])
        if w > 0 and h > 0:
            continue
        c["rect"] = {
            "anchor_min": [0.0, 0.0],
            "anchor_max": [1.0, 1.0],
            "anchored_pos": [0.0, 0.0],
            "pivot": [0.5, 0.5],
            "size_delta": [0.0, 0.0],
            "rotation_z": 0,
            "scale": [1.0, 1.0],
        }


def _has_image_sprite(n: dict) -> bool:
    for c in n.get("components", []):
        if c.get("type") == "Image":
            s = c.get("sprite") or {}
            if s.get("path") and not s.get("missing"):
                return True
    return False


def _apply_fill_under_mask(parent: dict) -> None:
    """Progress-bar fills (XP / GoldenPass / Chest) are driven at runtime by
    custom scripts. Their serialized rects are invalid (0x0 or negative size).
    If this node is a Mask, walk descendants and stretch any Image-with-sprite
    that has non-positive size to fill the Mask via stretch anchors — works
    regardless of whether the Mask itself uses point or stretch anchors."""
    has_mask = any(c.get("type") in ("Mask", "RectMask2D") for c in parent.get("components", []))
    if not has_mask:
        return

    def fill(descendant: dict) -> None:
        for c in _active_children(descendant):
            rt = c.get("rect") or {}
            w, h = (rt.get("size_delta") or [0, 0])
            # "Broken" size: zero or negative in either dim
            if (w > 0 and h > 0) or not _has_image_sprite(c):
                fill(c)
                continue
            c["rect"] = {
                "anchor_min": [0.0, 0.0],
                "anchor_max": [1.0, 1.0],
                "anchored_pos": [0.0, 0.0],
                "pivot": [0.5, 0.5],
                "size_delta": [0.0, 0.0],  # zero delta + stretch anchors = fills parent
                "rotation_z": 0,
                "scale": [1.0, 1.0],
            }
            fill(c)
    fill(parent)
