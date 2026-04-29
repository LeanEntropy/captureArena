"""Unity RectTransform -> absolute rect in canvas coordinates.

Unity formula (unified, handles point and stretch anchors):

  offsetMin = anchoredPosition - pivot * sizeDelta
  offsetMax = anchoredPosition + (1 - pivot) * sizeDelta
  bl = anchor_min * parent_size + offsetMin
  tr = anchor_max * parent_size + offsetMax
  size = tr - bl

Unity's y-axis is up; we also emit a y-down variant for Figma/web.
"""
from __future__ import annotations


def local_rect(parent_w: float, parent_h: float, rect: dict) -> tuple[float, float, float, float]:
    ax_min = rect["anchor_min"]
    ax_max = rect["anchor_max"]
    pos = rect["anchored_pos"]
    sd = rect["size_delta"]
    piv = rect["pivot"]

    off_min_x = pos[0] - piv[0] * sd[0]
    off_min_y = pos[1] - piv[1] * sd[1]
    off_max_x = pos[0] + (1.0 - piv[0]) * sd[0]
    off_max_y = pos[1] + (1.0 - piv[1]) * sd[1]

    bl_x = ax_min[0] * parent_w + off_min_x
    bl_y = ax_min[1] * parent_h + off_min_y
    tr_x = ax_max[0] * parent_w + off_max_x
    tr_y = ax_max[1] * parent_h + off_max_y

    return bl_x, bl_y, tr_x - bl_x, tr_y - bl_y


def annotate_abs_rects(root: dict, canvas_w: float | None = None, canvas_h: float | None = None) -> None:
    """Walk the tree in-place, adding `abs_rect` to every node.

    abs_rect = {
      "x_unity": bottom-left X in canvas coords, Y-up,
      "y_unity": bottom-left Y in canvas coords, Y-up,
      "x": top-left X in canvas coords, Y-down (Figma/web),
      "y": top-left Y in canvas coords, Y-down,
      "w": width, "h": height
    }
    """
    if canvas_w is None or canvas_h is None:
        # Root size = its own sizeDelta (Unity convention when anchors are {0.5,0.5})
        canvas_w = root["rect"]["size_delta"][0]
        canvas_h = root["rect"]["size_delta"][1]

    def recurse(node: dict, parent_abs_x: float, parent_abs_y: float, parent_w: float, parent_h: float) -> None:
        if node.get("rect") is None:
            return
        lx, ly, w, h = local_rect(parent_w, parent_h, node["rect"])
        abs_x_unity = parent_abs_x + lx
        abs_y_unity = parent_abs_y + ly
        node["abs_rect"] = {
            "x_unity": abs_x_unity,
            "y_unity": abs_y_unity,
            "x": abs_x_unity,
            "y": canvas_h - abs_y_unity - h,  # Y-down origin top-left of canvas
            "w": w,
            "h": h,
        }
        for child in node.get("children", []):
            recurse(child, abs_x_unity, abs_y_unity, w, h)

    # Root sits at (0,0) in canvas coords
    root["abs_rect"] = {
        "x_unity": 0.0, "y_unity": 0.0,
        "x": 0.0, "y": 0.0,
        "w": canvas_w, "h": canvas_h,
    }
    for child in root.get("children", []):
        recurse(child, 0.0, 0.0, canvas_w, canvas_h)
