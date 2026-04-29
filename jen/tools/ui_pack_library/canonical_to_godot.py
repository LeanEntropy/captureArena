"""Render a library canonical scene JSON to a Godot 4.6+ .tscn + assets.

Input:  canonical scene dict (kind=image|text, rect in px Y-down, image.path
        pointing at disk assets relative to pack_dir).
Output: a .tscn text + a list of asset files to copy into the game project.

The emitter supports:
- TextureRect for simple sprites
- NinePatchRect when border_ltrb is set
- Label with theme_override_constants/outline_size, font_shadow_color,
  shadow_offset, shadow_outline_size

It does NOT support (yet): rotation, partial-fill images, gradients, TMP rich
markup — v1 of the library only needs the screen to be structurally faithful.
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RenderResult:
    tscn_path: Path
    asset_count: int


def emit(
    scene: dict, pack_dir: Path, out_tscn: Path, asset_res_prefix: str
) -> RenderResult:
    """Emit a .tscn to `out_tscn`. Copies referenced images to
    out_tscn.parent / 'assets' / <sha1>.png. `asset_res_prefix` is the
    res:// prefix the scene will use (e.g. 'res://.artgen/packs_imports/foo/bar').
    """
    canvas = scene.get("metadata", {}).get("canvas") or [2560, 1440]
    name = (scene.get("metadata") or {}).get("name") or "Screen"

    assets_dir = out_tscn.parent / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    ext_resources: list[tuple[int, str, str]] = []  # (id, type, path)
    ext_lookup: dict[str, int] = {}
    next_id = [1]

    def register(res_type: str, path: str) -> int:
        key = f"{res_type}|{path}"
        if key in ext_lookup:
            return ext_lookup[key]
        nid = next_id[0]
        next_id[0] += 1
        ext_resources.append((nid, res_type, path))
        ext_lookup[key] = nid
        return nid

    def ensure_image(rel_path: str) -> int | None:
        src = pack_dir / rel_path
        if not src.is_file():
            return None
        sha = Path(rel_path).stem
        dst = assets_dir / f"{sha}.png"
        if not dst.exists():
            shutil.copy2(src, dst)
        res_path = f"{asset_res_prefix}/assets/{sha}.png"
        return register("Texture2D", res_path)

    # Build the scene body
    body: list[str] = []
    body.append(_node_root(name, canvas))

    for obj in scene.get("objects") or []:
        kind = obj.get("kind")
        rect = obj.get("rect") or {"x": 0, "y": 0, "w": 0, "h": 0}
        node_name = _safe(obj.get("name") or obj.get("id") or "node")
        if kind == "image":
            img = obj.get("image") or {}
            path = img.get("path")
            tex_id = ensure_image(path) if path else None
            tint = img.get("tint") or [1, 1, 1, 1]
            border = img.get("border_ltrb")
            if border and any(float(b) for b in border) and tex_id is not None:
                body.append(_node_ninepatch(node_name, rect, tex_id, border, tint))
            elif tex_id is not None:
                body.append(_node_texturerect(node_name, rect, tex_id, tint))
            else:
                body.append(_node_colorrect(node_name, rect, tint))
        elif kind == "text":
            t = obj.get("text") or {}
            body.append(_node_label(node_name, rect, t))

    # Assemble header
    load_steps = max(1, len(ext_resources) + 1)
    header = [f'[gd_scene load_steps={load_steps} format=3 uid="uid://bogus_{name.lower()}"]', ""]
    for nid, rtype, path in ext_resources:
        header.append(f'[ext_resource type="{rtype}" path="{path}" id="{nid}"]')
    header.append("")

    tscn = "\n".join(header) + "\n".join(body) + "\n"
    out_tscn.write_text(tscn, encoding="utf-8")
    return RenderResult(tscn_path=out_tscn, asset_count=sum(1 for n in assets_dir.iterdir()))


def _safe(s: str) -> str:
    return "".join(c if (c.isalnum() or c in "_") else "_" for c in s)[:64] or "node"


def _node_root(name: str, canvas: list[int]) -> str:
    w, h = int(canvas[0]), int(canvas[1])
    return (
        f'[node name="{_safe(name)}" type="Control"]\n'
        f"anchor_right = 1.0\n"
        f"anchor_bottom = 1.0\n"
        f"offset_right = {w}.0\n"
        f"offset_bottom = {h}.0\n"
        f"mouse_filter = 2\n\n"
    )


def _offsets(rect: dict) -> str:
    x = float(rect.get("x") or 0)
    y = float(rect.get("y") or 0)
    w = float(rect.get("w") or 0)
    h = float(rect.get("h") or 0)
    return (
        f"offset_left = {x}\n"
        f"offset_top = {y}\n"
        f"offset_right = {x + w}\n"
        f"offset_bottom = {y + h}\n"
    )


def _color(rgba: list) -> str:
    r, g, b = rgba[0], rgba[1], rgba[2]
    a = rgba[3] if len(rgba) >= 4 else 1.0
    return f"Color({r}, {g}, {b}, {a})"


def _node_texturerect(name: str, rect: dict, tex_id: int, tint: list) -> str:
    out = (
        f'[node name="{name}" type="TextureRect" parent="."]\n'
        f'texture = ExtResource("{tex_id}")\n'
        f"mouse_filter = 2\n"
        + _offsets(rect)
    )
    if any(abs(c - 1.0) > 0.01 for c in (tint[0], tint[1], tint[2])) or (
        len(tint) >= 4 and abs(tint[3] - 1.0) > 0.01
    ):
        out += f"modulate = {_color(tint)}\n"
    return out + "\n"


def _node_ninepatch(name: str, rect: dict, tex_id: int, border: list, tint: list) -> str:
    l, b, r, t = border[0], border[1], border[2], border[3]
    out = (
        f'[node name="{name}" type="NinePatchRect" parent="."]\n'
        f'texture = ExtResource("{tex_id}")\n'
        f"patch_margin_left = {int(l)}\n"
        f"patch_margin_top = {int(t)}\n"
        f"patch_margin_right = {int(r)}\n"
        f"patch_margin_bottom = {int(b)}\n"
        f"mouse_filter = 2\n"
        + _offsets(rect)
    )
    if any(abs(c - 1.0) > 0.01 for c in (tint[0], tint[1], tint[2])):
        out += f"modulate = {_color(tint)}\n"
    return out + "\n"


def _node_colorrect(name: str, rect: dict, tint: list) -> str:
    return (
        f'[node name="{name}" type="ColorRect" parent="."]\n'
        f"color = {_color(tint)}\n"
        f"mouse_filter = 2\n"
        + _offsets(rect)
        + "\n"
    )


_ALIGN_H = {"LEFT": 0, "CENTER": 1, "RIGHT": 2}
_ALIGN_V = {"TOP": 0, "CENTER": 1, "BOTTOM": 2}


def _node_label(name: str, rect: dict, t: dict) -> str:
    text = str(t.get("characters") or "")
    font_size = int(t.get("size") or 36)
    color = t.get("color") or [1, 1, 1, 1]
    outline_px = int(t.get("outline_px") or 0)
    outline_color = t.get("outline_color") or [0, 0, 0, 1]
    shadow_off = t.get("shadow_offset") or [0, 0]
    shadow_color = t.get("shadow_color") or [0, 0, 0, 0.5]
    hal = _ALIGN_H.get((t.get("align_h") or "LEFT").upper(), 0)
    val = _ALIGN_V.get((t.get("align_v") or "TOP").upper(), 0)

    out = (
        f'[node name="{name}" type="Label" parent="."]\n'
        f"mouse_filter = 2\n"
        + _offsets(rect)
        + f'text = "{_escape(text)}"\n'
        + f"horizontal_alignment = {hal}\n"
        + f"vertical_alignment = {val}\n"
        + f"theme_override_font_sizes/font_size = {font_size}\n"
        + f"theme_override_colors/font_color = {_color(color)}\n"
    )
    if outline_px > 0:
        # Godot outline_size is the stroke width in px. Double to roughly
        # match the weight we set in the three.js / Figma backends.
        out += (
            f"theme_override_colors/font_outline_color = {_color(outline_color)}\n"
            f"theme_override_constants/outline_size = {outline_px * 2}\n"
        )
    if float(shadow_off[0] or 0) or float(shadow_off[1] or 0):
        out += (
            f"theme_override_colors/font_shadow_color = {_color(shadow_color)}\n"
            f"theme_override_constants/shadow_offset_x = {int(shadow_off[0])}\n"
            f"theme_override_constants/shadow_offset_y = {int(shadow_off[1])}\n"
            f"theme_override_constants/shadow_outline_size = 1\n"
        )
    return out + "\n"


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
