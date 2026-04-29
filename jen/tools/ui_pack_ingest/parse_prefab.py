"""Unity prefab -> canonical layout tree.

Produces a JSON-friendly dict that captures everything needed to reconstruct
the screen in Figma or Godot:
  - GameObject/RectTransform hierarchy
  - RectTransform anchors, pivots, size, position, rotation
  - Known UI components (Image, RawImage, Text, TMP, Button, Mask, ScrollRect,
    LayoutGroup, GridLayoutGroup, Canvas, CanvasScaler, CanvasGroup)
  - Sprite GUIDs resolved to absolute paths + 9-slice borders

Absolute rects are computed separately in `rect_math.py`.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from unity_yaml import load_unity_yaml


# Built-in Unity UI script GUIDs (stable across Unity 2019+). Used to pre-classify
# MonoBehaviours whose field signatures are ambiguous (e.g. HorizontalLayoutGroup
# and VerticalLayoutGroup share the same fields; only the guid distinguishes them).
_UNITY_UI_GUIDS: dict[str, str] = {
    "30649d3a9faa99c48a7b1166b86bf2a0": "HorizontalLayoutGroup",
    "59f8146938fff824cb5fd77236b75775": "VerticalLayoutGroup",
    "8a8695521f0d02e499659fee002a26c2": "GridLayoutGroup",
    "3245ec927659c4140ac4f8d17403cc18": "ContentSizeFitter",
    "306cc8c2b49d7114eaa3623786fc2126": "LayoutElement",
    "fe87c0e1cc204ed48ad3b37840f39efc": "Image",
    "f4688fdb7df04437aeb418b961361dc5": "TextMeshProUGUI",
}

# Fallback field-signature detectors. Kept so non-built-in / third-party packs
# still classify where guids aren't in our table.
_DETECTORS: list[tuple[str, tuple[str, ...]]] = [
    ("RectMask2D",     ("m_Softness", "m_Padding")),
    ("Mask",           ("m_ShowMaskGraphic",)),
    ("ScrollRect",     ("m_Horizontal", "m_Vertical", "m_Viewport")),
    ("Button",         ("m_OnClick", "m_Transition")),
    ("Canvas",         ("m_RenderMode", "m_Camera")),
    ("CanvasScaler",   ("m_UiScaleMode", "m_ReferenceResolution")),
    ("CanvasGroup",    ("m_Alpha", "m_Interactable", "m_BlocksRaycasts")),
    ("GridLayoutGroup",("m_CellSize", "m_Spacing")),
    ("HorizontalLayoutGroup", ("m_Spacing", "m_ChildControlWidth")),  # ambiguous; guid pre-empts
    ("LayoutElement",  ("m_PreferredWidth", "m_PreferredHeight", "m_FlexibleWidth")),
    ("ContentSizeFitter", ("m_HorizontalFit", "m_VerticalFit")),
    ("TextMeshProUGUI",("m_text", "m_fontAsset")),
    ("Text",           ("m_Text", "m_FontData")),
    ("RawImage",       ("m_Texture", "m_UVRect")),
    ("Image",          ("m_Sprite", "m_FillMethod")),  # keep last as generic catcher
]


def _classify_monobehaviour(body: dict) -> str | None:
    guid = (body.get("m_Script") or {}).get("guid")
    if guid and guid in _UNITY_UI_GUIDS:
        return _UNITY_UI_GUIDS[guid]
    for name, markers in _DETECTORS:
        if all(m in body for m in markers):
            return name
    return None


def _pad(body: dict, key: str = "m_Padding") -> dict:
    p = body.get(key) or {}
    return {
        "left":   int(p.get("m_Left", 0)),
        "right":  int(p.get("m_Right", 0)),
        "top":    int(p.get("m_Top", 0)),
        "bottom": int(p.get("m_Bottom", 0)),
    }


def _vec2(body: dict, key: str, default: tuple[float, float] = (0.0, 0.0)) -> list[float]:
    v = body.get(key) or {}
    return [v.get("x", default[0]), v.get("y", default[1])]


def _rect_to_dict(body: dict) -> dict:
    def xy(key, default=(0.0, 0.0)):
        v = body.get(key) or {}
        return [v.get("x", default[0]), v.get("y", default[1])]

    rot = body.get("m_LocalEulerAnglesHint") or {}
    return {
        "anchor_min": xy("m_AnchorMin"),
        "anchor_max": xy("m_AnchorMax"),
        "anchored_pos": xy("m_AnchoredPosition"),
        "size_delta": xy("m_SizeDelta"),
        "pivot": xy("m_Pivot", (0.5, 0.5)),
        "rotation_z": rot.get("z", 0),
        "scale": xy("m_LocalScale", (1.0, 1.0)),
    }


def _resolve_sprite(ref: dict | None, guid_index: dict) -> dict | None:
    if not ref:
        return None
    guid = ref.get("guid")
    if not guid:
        return None
    entry = guid_index.get(guid)
    if entry is None:
        return {"guid": guid, "missing": True}
    result: dict = {"guid": guid, "path": entry["path"]}
    if "sprite" in entry:
        result["border"] = entry["sprite"]["border"]
        result["pivot"] = entry["sprite"]["pivot"]
        if "native_size" in entry["sprite"]:
            result["native_size"] = entry["sprite"]["native_size"]
    return result


def _extract_component(kind: str, body: dict, guid_index: dict) -> dict | None:
    """Extract the fields we care about for each component kind."""
    if kind == "Image":
        return {
            "type": "Image",
            "sprite": _resolve_sprite(body.get("m_Sprite"), guid_index),
            "color": _rgba(body.get("m_Color")),
            "fill_method": body.get("m_FillMethod", 0),
            "fill_amount": body.get("m_FillAmount", 1),
            "image_type": body.get("m_Type", 0),  # 0=Simple 1=Sliced 2=Tiled 3=Filled
            "preserve_aspect": bool(body.get("m_PreserveAspect", 0)),
            "raycast_target": bool(body.get("m_RaycastTarget", 1)),
            "pixels_per_unit_multiplier": body.get("m_PixelsPerUnitMultiplier", 1),
        }
    if kind == "RawImage":
        return {
            "type": "RawImage",
            "texture": _resolve_sprite(body.get("m_Texture"), guid_index),
            "color": _rgba(body.get("m_Color")),
            "uv_rect": body.get("m_UVRect"),
        }
    if kind == "Text":
        fd = body.get("m_FontData") or {}
        return {
            "type": "Text",
            "text": body.get("m_Text", ""),
            "font": _resolve_sprite(fd.get("m_Font"), guid_index),
            "font_size": fd.get("m_FontSize", 14),
            "alignment": fd.get("m_Alignment", 0),
            "color": _rgba(body.get("m_Color")),
        }
    if kind == "TextMeshProUGUI":
        return {
            "type": "TextMeshProUGUI",
            "text": body.get("m_text", ""),
            "font": _resolve_sprite(body.get("m_fontAsset"), guid_index),
            "font_size": body.get("m_fontSize", 36),
            "alignment_h": body.get("m_HorizontalAlignment"),
            "alignment_v": body.get("m_VerticalAlignment"),
            "color": _rgba(body.get("m_fontColor")),
            "face_color": _rgba(body.get("m_faceColor")),
            "outline_color": _rgba(body.get("m_outlineColor")),
            "outline_width": body.get("m_outlineWidth", 0),
            "word_wrap": bool(body.get("m_enableWordWrapping", 1)),
            "auto_size": bool(body.get("m_enableAutoSizing", 0)),
        }
    if kind == "Mask":
        return {"type": "Mask", "show_graphic": bool(body.get("m_ShowMaskGraphic", 1))}
    if kind == "RectMask2D":
        return {"type": "RectMask2D", "padding": body.get("m_Padding"), "softness": body.get("m_Softness")}
    if kind == "ScrollRect":
        return {
            "type": "ScrollRect",
            "horizontal": bool(body.get("m_Horizontal", 1)),
            "vertical": bool(body.get("m_Vertical", 1)),
            "movement_type": body.get("m_MovementType", 1),
        }
    if kind == "Button":
        return {"type": "Button", "transition": body.get("m_Transition", 1)}
    if kind == "Canvas":
        return {
            "type": "Canvas",
            "render_mode": body.get("m_RenderMode"),
            "sorting_order": body.get("m_SortingOrder", 0),
        }
    if kind == "CanvasScaler":
        return {
            "type": "CanvasScaler",
            "scale_mode": body.get("m_UiScaleMode"),
            "reference_resolution": body.get("m_ReferenceResolution"),
            "screen_match_mode": body.get("m_ScreenMatchMode"),
            "match": body.get("m_MatchWidthOrHeight", 0),
        }
    if kind == "CanvasGroup":
        return {
            "type": "CanvasGroup",
            "alpha": body.get("m_Alpha", 1),
            "interactable": bool(body.get("m_Interactable", 1)),
            "blocks_raycasts": bool(body.get("m_BlocksRaycasts", 1)),
        }
    if kind in ("HorizontalLayoutGroup", "VerticalLayoutGroup"):
        return {
            "type": kind,
            "padding": _pad(body),
            "spacing": float(body.get("m_Spacing", 0)),
            "child_alignment": body.get("m_ChildAlignment", 0),
            "child_control_width":  bool(body.get("m_ChildControlWidth", 0)),
            "child_control_height": bool(body.get("m_ChildControlHeight", 0)),
            "child_force_expand_width":  bool(body.get("m_ChildForceExpandWidth", 0)),
            "child_force_expand_height": bool(body.get("m_ChildForceExpandHeight", 0)),
        }
    if kind == "GridLayoutGroup":
        return {
            "type": kind,
            "padding": _pad(body),
            "cell_size": _vec2(body, "m_CellSize", (100.0, 100.0)),
            "spacing":   _vec2(body, "m_Spacing"),
            "start_corner": int(body.get("m_StartCorner", 0)),   # 0=UpperLeft 1=UpperRight 2=LowerLeft 3=LowerRight
            "start_axis":   int(body.get("m_StartAxis", 0)),     # 0=Horizontal 1=Vertical
            "child_alignment": int(body.get("m_ChildAlignment", 0)),
            "constraint": int(body.get("m_Constraint", 0)),      # 0=Flexible 1=FixedColumnCount 2=FixedRowCount
            "constraint_count": int(body.get("m_ConstraintCount", 0)),
        }
    if kind == "ContentSizeFitter":
        return {
            "type": kind,
            "horizontal_fit": int(body.get("m_HorizontalFit", 0)),  # 0=Unconstrained 1=MinSize 2=PreferredSize
            "vertical_fit":   int(body.get("m_VerticalFit", 0)),
        }
    if kind == "LayoutElement":
        return {
            "type": kind,
            "min_width":        float(body.get("m_MinWidth", -1)),
            "min_height":       float(body.get("m_MinHeight", -1)),
            "preferred_width":  float(body.get("m_PreferredWidth", -1)),
            "preferred_height": float(body.get("m_PreferredHeight", -1)),
            "flexible_width":   float(body.get("m_FlexibleWidth", -1)),
            "flexible_height":  float(body.get("m_FlexibleHeight", -1)),
            "ignore_layout":    bool(body.get("m_IgnoreLayout", 0)),
        }
    return None


def _rgba(v: dict | None) -> list[float] | None:
    if not v:
        return None
    return [v.get("r", 1), v.get("g", 1), v.get("b", 1), v.get("a", 1)]


_NATIVE_SIZE_CACHE: dict[str, tuple[int, int]] = {}


def _native_size(pack_root: Path | None, rel_path: str) -> tuple[int, int] | None:
    """Return (w, h) in native pixels for a sprite PNG. Cached to avoid re-opening."""
    if pack_root is None:
        return None
    key = rel_path
    if key in _NATIVE_SIZE_CACHE:
        return _NATIVE_SIZE_CACHE[key]
    try:
        from PIL import Image  # local import so module stays light when not needed
        p = pack_root / rel_path
        if not p.is_file():
            return None
        with Image.open(p) as im:
            size = (im.size[0], im.size[1])
    except Exception:
        return None
    _NATIVE_SIZE_CACHE[key] = size
    return size


def _synth_sprite_renderer_rect(body: dict, sprite_info: dict, pack_root: Path | None) -> dict | None:
    """Convert SpriteRenderer + Transform into a RectTransform-like rect anchored at
    the parent's center. Unity canvas renders sprite at:
      display_px = (native_px / PPU) * localScale
    with offset = localPosition (treating canvas units as pixels for ScreenSpaceOverlay)."""
    if not sprite_info or sprite_info.get("missing"):
        return None
    native = _native_size(pack_root, sprite_info["path"]) if sprite_info.get("path") else None
    if not native:
        return None
    ppu = float((sprite_info.get("pixels_per_unit") or 100))
    return {
        "_native": native,
        "_ppu": ppu,
    }


def _build_tree(
    go_id: str,
    objects: dict[str, dict],
    transform_to_go: dict[str, str],
    guid_index: dict,
    pack_root: Path | None,
) -> dict:
    go = objects[go_id]["body"]
    components = go.get("m_Component") or []

    rect = None
    is_rect_transform_node = False
    extracted_components: list[dict] = []
    children_ids: list[str] = []
    sprite_renderer_body: dict | None = None
    transform_body: dict | None = None

    for comp_ref in components:
        cid = str(comp_ref.get("component", {}).get("fileID") or "")
        obj = objects.get(cid)
        if obj is None:
            continue
        kind = obj["kind"]
        body = obj["body"]

        if kind == "RectTransform":
            rect = _rect_to_dict(body)
            is_rect_transform_node = True
            for child_ref in body.get("m_Children") or []:
                child_rt = str(child_ref.get("fileID"))
                child_go = transform_to_go.get(child_rt)
                if child_go:
                    children_ids.append(child_go)
            continue

        if kind == "Transform":
            transform_body = body
            for child_ref in body.get("m_Children") or []:
                child_rt = str(child_ref.get("fileID"))
                child_go = transform_to_go.get(child_rt)
                if child_go:
                    children_ids.append(child_go)
            continue

        if kind == "SpriteRenderer":
            sprite_renderer_body = body
            continue

        if kind == "MonoBehaviour":
            detected = _classify_monobehaviour(body)
            if detected:
                extracted = _extract_component(detected, body, guid_index)
                if extracted:
                    extracted_components.append(extracted)
                continue
            extracted_components.append({
                "type": "UnknownBehaviour",
                "script_guid": body.get("m_Script", {}).get("guid"),
            })

    # Transform + SpriteRenderer: synthesize an Image component so downstream
    # export treats it as a UI overlay. Rect is anchored to the parent's center.
    if rect is None and transform_body is not None and sprite_renderer_body is not None:
        sprite_info = _resolve_sprite(sprite_renderer_body.get("m_Sprite"), guid_index)
        native = _native_size(pack_root, sprite_info["path"]) if (sprite_info and sprite_info.get("path")) else None
        if native:
            ppu = 100.0
            # Read PPU from the sprite meta entry we already have in guid_index
            ref = sprite_renderer_body.get("m_Sprite") or {}
            sm = guid_index.get(ref.get("guid"), {}).get("sprite") or {}
            ppu = float(sm.get("pixels_per_unit") or 100)
            scale = transform_body.get("m_LocalScale") or {"x": 1, "y": 1}
            pos = transform_body.get("m_LocalPosition") or {"x": 0, "y": 0}
            w = native[0] / ppu * float(scale.get("x", 1))
            h = native[1] / ppu * float(scale.get("y", 1))
            rect = {
                "anchor_min": [0.5, 0.5],
                "anchor_max": [0.5, 0.5],
                "anchored_pos": [float(pos.get("x", 0)), float(pos.get("y", 0))],
                "size_delta": [w, h],
                "pivot": sprite_info.get("pivot") or [0.5, 0.5],
                "rotation_z": 0,
                "scale": [1.0, 1.0],
            }
            extracted_components.append({
                "type": "Image",
                "sprite": sprite_info,
                "color": _rgba(sprite_renderer_body.get("m_Color")),
                "fill_method": 0,
                "fill_amount": 1,
                "image_type": 0,
                "preserve_aspect": True,
                "raycast_target": False,
                "pixels_per_unit_multiplier": 1,
            })

    return {
        "id": go_id,
        # YAML coerces unquoted "On"/"Off"/"Yes"/"No" to booleans — force str so
        # every downstream consumer (layout_solver, exporters) can treat it uniformly.
        "name": str(go.get("m_Name", "")),
        "active": bool(go.get("m_IsActive", 1)),
        "rect": rect,
        "components": extracted_components,
        "children": [
            _build_tree(cid, objects, transform_to_go, guid_index, pack_root) for cid in children_ids
        ],
    }


def parse_prefab(prefab_path: Path, guid_index: dict, pack_root: Path | None = None) -> dict:
    objects = load_unity_yaml(prefab_path)

    # Any Transform (RectTransform OR plain Transform) -> its GameObject. We walk
    # all of them because Unity lets devs drop SpriteRenderer children (plain
    # Transform, world-space) inside RectTransform parents — these still render
    # in ScreenSpaceOverlay canvases and show up in the vendor preview.
    transform_to_go: dict[str, str] = {}
    for fid, obj in objects.items():
        if obj["kind"] == "GameObject":
            for comp_ref in obj["body"].get("m_Component") or []:
                cid = str(comp_ref.get("component", {}).get("fileID") or "")
                if cid in objects and objects[cid]["kind"] in ("RectTransform", "Transform"):
                    transform_to_go[cid] = fid

    # Root: the only RectTransform with no parent
    root_go: str | None = None
    for fid, obj in objects.items():
        if obj["kind"] == "RectTransform":
            father = obj["body"].get("m_Father") or {}
            if father.get("fileID") in (0, "0", None):
                root_go = transform_to_go.get(fid)
                if root_go:
                    break

    if root_go is None:
        raise ValueError(f"no root RectTransform found in {prefab_path}")

    tree = _build_tree(root_go, objects, transform_to_go, guid_index, pack_root)
    return {
        "source": prefab_path.name,
        "root": tree,
    }


if __name__ == "__main__":
    import json
    import sys

    sys.path.insert(0, str(Path(__file__).parent))
    from parse_meta import build_guid_index

    prefab = Path(sys.argv[1])
    pack_root = Path(sys.argv[2]) if len(sys.argv) > 2 else prefab.parent
    while pack_root.parent != pack_root and not (pack_root / "ResourcesData").exists():
        pack_root = pack_root.parent

    idx = build_guid_index(pack_root)
    result = parse_prefab(prefab, idx)
    print(json.dumps(result, indent=2, sort_keys=True))
