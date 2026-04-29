"""Export a parsed screen JSON to a Godot 4.6 .tscn file.

Mapping:
  Image (simple)     -> TextureRect
  Image (sliced)     -> NinePatchRect (patch margins from sprite border)
  RawImage           -> TextureRect
  Text / TMP         -> Label (font + size + color + outline)
  Mask               -> Control with clip_contents=true
  ScrollRect         -> ScrollContainer
  LayoutGroup        -> V/HBoxContainer (basic mapping; detailed fit tbd)
  Button             -> Button (child nodes remain as siblings)

Sprites + fonts are copied into <target_project>/ui_packs/<slug>/ and referenced
by res:// paths. Godot auto-generates .import files on first open.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tmp_text import strip_tags


_ID_RE = re.compile(r"[^A-Za-z0-9_]")


def _safe_id(s: str, used: set[str]) -> str:
    base = _ID_RE.sub("_", s).strip("_") or "n"
    cand = base
    i = 1
    while cand in used:
        i += 1
        cand = f"{base}_{i}"
    used.add(cand)
    return cand


def _gd_color(rgba: list[float] | None, default: tuple[float, ...] = (1, 1, 1, 1)) -> str:
    v = list(rgba) if rgba else list(default)
    while len(v) < 4:
        v.append(1.0)
    return f"Color({v[0]}, {v[1]}, {v[2]}, {v[3]})"


def _gd_vec2(x: float, y: float) -> str:
    return f"Vector2({x}, {y})"


class _Exporter:
    def __init__(self, slug: str, pack_dir: Path, target_project: Path, canvas_size: tuple[int, int]):
        self.slug = slug
        self.pack_dir = pack_dir
        self.target_project = target_project
        self.canvas_size = canvas_size
        self.assets_root = target_project / "ui_packs" / slug
        self.ext_resources: list[str] = []   # tscn header lines
        self.ext_by_key: dict[tuple[str, str], str] = {}  # (kind, res_path) -> id
        self.nodes: list[str] = []
        self.used_ids: set[str] = set()

    # ---- resource registration -------------------------------------------------

    def _register(self, kind: str, res_path: str) -> str:
        key = (kind, res_path)
        if key in self.ext_by_key:
            return self.ext_by_key[key]
        rid = f"{kind[0].lower()}_{len(self.ext_by_key) + 1}"
        self.ext_by_key[key] = rid
        self.ext_resources.append(f'[ext_resource type="{kind}" path="{res_path}" id="{rid}"]')
        return rid

    def _copy_sprite(self, rel_path: str) -> str:
        src = self.pack_dir / rel_path
        if not src.is_file():
            return ""
        dst = self.assets_root / rel_path
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)
        res_path = f"res://ui_packs/{self.slug}/{rel_path}"
        return self._register("Texture2D", res_path)

    def _copy_font(self, local_ttf: Path) -> str:
        if not local_ttf.is_file():
            return ""
        dst_dir = self.assets_root / "_fonts"
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / local_ttf.name
        if not dst.exists():
            shutil.copy2(local_ttf, dst)
        res_path = f"res://ui_packs/{self.slug}/_fonts/{local_ttf.name}"
        return self._register("FontFile", res_path)

    # ---- node writers ----------------------------------------------------------

    def _write_node_header(self, name: str, node_type: str, parent_path: str) -> None:
        if parent_path == "":
            self.nodes.append(f'[node name="{name}" type="{node_type}"]')
        else:
            self.nodes.append(f'[node name="{name}" type="{node_type}" parent="{parent_path}"]')

    def _write_layout(self, abs_rect: dict, parent_abs: dict | None, rotation: float = 0.0, scale: list[float] | None = None) -> None:
        # Godot Control offsets are relative to parent's origin when layout_mode = 0
        px = parent_abs["x"] if parent_abs else 0.0
        py = parent_abs["y"] if parent_abs else 0.0
        x = abs_rect["x"] - px
        y = abs_rect["y"] - py
        w = max(0.0, abs_rect["w"])
        h = max(0.0, abs_rect["h"])
        self.nodes.append("layout_mode = 0")
        self.nodes.append(f"offset_left = {x}")
        self.nodes.append(f"offset_top = {y}")
        self.nodes.append(f"offset_right = {x + w}")
        self.nodes.append(f"offset_bottom = {y + h}")
        if rotation:
            self.nodes.append(f"rotation = {-rotation * 3.14159265 / 180.0}")  # Unity Z-up -> Godot 2D sign flip
            # pivot for rotation: center by default
            self.nodes.append(f"pivot_offset = {_gd_vec2(w / 2, h / 2)}")
        if scale and (scale[0] != 1 or scale[1] != 1):
            self.nodes.append(f"scale = {_gd_vec2(scale[0], scale[1])}")

    def _render_image(self, name: str, parent_path: str, abs_rect: dict, parent_abs: dict | None, comp: dict, rotation: float, scale: list[float]) -> None:
        sprite = comp.get("sprite") or {}
        res_id = self._copy_sprite(sprite["path"]) if sprite.get("path") else ""
        if not res_id:
            return
        image_type = comp.get("image_type", 0)
        border = sprite.get("border") or [0, 0, 0, 0]
        color = comp.get("color")

        if image_type == 1 and any(border):  # sliced
            self._write_node_header(name, "NinePatchRect", parent_path)
            self._write_layout(abs_rect, parent_abs, rotation, scale)
            self.nodes.append(f'texture = ExtResource("{res_id}")')
            self.nodes.append(f"patch_margin_left = {int(border[0])}")
            self.nodes.append(f"patch_margin_bottom = {int(border[1])}")
            self.nodes.append(f"patch_margin_right = {int(border[2])}")
            self.nodes.append(f"patch_margin_top = {int(border[3])}")
            if color and color != [1, 1, 1, 1]:
                self.nodes.append(f"self_modulate = {_gd_color(color)}")
        else:
            self._write_node_header(name, "TextureRect", parent_path)
            self._write_layout(abs_rect, parent_abs, rotation, scale)
            self.nodes.append(f'texture = ExtResource("{res_id}")')
            # Simple=0 stretch whole; filled mode falls back to stretch for now
            self.nodes.append("expand_mode = 1")   # ignore_size
            self.nodes.append("stretch_mode = 1")  # scale
            if color and color != [1, 1, 1, 1]:
                self.nodes.append(f"self_modulate = {_gd_color(color)}")
        self.nodes.append("")

    def _render_label(self, name: str, parent_path: str, abs_rect: dict, parent_abs: dict | None, comp: dict, rotation: float) -> None:
        raw = comp.get("text")
        text = strip_tags(str(raw) if raw is not None else "")
        escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        self._write_node_header(name, "Label", parent_path)
        self._write_layout(abs_rect, parent_abs, rotation)
        self.nodes.append(f'text = "{escaped}"')
        # Alignment mapping
        halign = comp.get("alignment_h")
        if halign in (2, 32):
            self.nodes.append("horizontal_alignment = 1")  # center
        elif halign == 4:
            self.nodes.append("horizontal_alignment = 2")  # right
        valign = comp.get("alignment_v")
        if valign in (512, 4096, 8192):
            self.nodes.append("vertical_alignment = 1")
        elif valign == 1024:
            self.nodes.append("vertical_alignment = 2")

        font_id = self._copy_font(Path("references/fonts/LilitaOne-Regular.ttf"))
        if font_id:
            self.nodes.append(f'theme_override_fonts/font = ExtResource("{font_id}")')
        font_size = int(comp.get("font_size") or 36)
        self.nodes.append(f"theme_override_font_sizes/font_size = {font_size}")
        face = comp.get("face_color") or comp.get("color")
        if face:
            self.nodes.append(f"theme_override_colors/font_color = {_gd_color(face)}")

        # TMP outline + shadow. TMP "Outline" SDF font atlases bake the outline
        # into the font material, so the component's m_outlineWidth stays 0. Detect
        # the outline via the font asset path (matches the Figma plugin logic).
        outline_w = float(comp.get("outline_width") or 0)
        font_info = comp.get("font") or {}
        font_path = (font_info.get("path") or "").lower() if isinstance(font_info, dict) else ""
        outline_px = 0
        if outline_w > 0:
            outline_px = max(2, int(round(outline_w * max(4, int(font_size * 0.08)))))
        elif "outline" in font_path:
            outline_px = max(2, int(round(font_size * 0.09)))

        if outline_px > 0:
            oc = comp.get("outline_color") or [0, 0, 0, 1]
            self.nodes.append(f"theme_override_constants/outline_size = {outline_px * 2}")  # Godot outline is symmetric, half-width each side — double to match TMP's visual weight
            self.nodes.append(f"theme_override_colors/font_outline_color = {_gd_color(oc)}")
            # Matching Figma plugin: add a downward drop shadow for outline-SDF fonts
            shadow_offset = max(2, int(round(font_size * 0.06)))
            self.nodes.append(f"theme_override_constants/shadow_offset_x = 0")
            self.nodes.append(f"theme_override_constants/shadow_offset_y = {shadow_offset}")
            self.nodes.append(f"theme_override_constants/shadow_outline_size = {max(1, int(round(shadow_offset * 0.4)))}")
            self.nodes.append(f"theme_override_colors/font_shadow_color = Color(0, 0, 0, 0.5)")
        self.nodes.append("")

    def _render_mask(self, name: str, parent_path: str, abs_rect: dict, parent_abs: dict | None, rotation: float) -> None:
        self._write_node_header(name, "Control", parent_path)
        self._write_layout(abs_rect, parent_abs, rotation)
        self.nodes.append("clip_contents = true")
        self.nodes.append("")

    def _render_control(self, name: str, parent_path: str, abs_rect: dict, parent_abs: dict | None, rotation: float, scale: list[float]) -> None:
        self._write_node_header(name, "Control", parent_path)
        self._write_layout(abs_rect, parent_abs, rotation, scale)
        self.nodes.append("")

    # ---- tree walker -----------------------------------------------------------

    def render_tree(self, node: dict, parent_path: str, parent_abs: dict | None) -> None:
        rect = node.get("abs_rect") or {"x": 0, "y": 0, "w": 0, "h": 0}
        rt = node.get("rect") or {}
        rotation = rt.get("rotation_z") or 0
        scale = rt.get("scale") or [1.0, 1.0]

        name = _safe_id(node.get("name") or "Node", self.used_ids)

        # Pick the primary component (first drawable) to determine node type
        comps = node.get("components", [])
        primary = next((c for c in comps if c.get("type") in ("Image", "RawImage")), None)
        text_comp = next((c for c in comps if c.get("type") in ("Text", "TextMeshProUGUI")), None)
        has_mask = any(c.get("type") in ("Mask", "RectMask2D") for c in comps)

        if primary:
            self._render_image(name, parent_path, rect, parent_abs, primary, rotation, scale)
        elif text_comp:
            self._render_label(name, parent_path, rect, parent_abs, text_comp, rotation)
        elif has_mask:
            self._render_mask(name, parent_path, rect, parent_abs, rotation)
        else:
            self._render_control(name, parent_path, rect, parent_abs, rotation, scale)

        if not node.get("active", True) and self.nodes and self.nodes[-1] == "":
            self.nodes.insert(len(self.nodes) - 1, "visible = false")

        # Godot parent paths: "." for root children, "Child" for grandchildren of root,
        # "Child/Grand" for deeper. Never include the root node name.
        if parent_path == "":
            child_parent = "."
        elif parent_path == ".":
            child_parent = name
        else:
            child_parent = f"{parent_path}/{name}"
        for child in node.get("children", []):
            self.render_tree(child, child_parent, rect)

    def emit(self) -> str:
        lines: list[str] = []
        load_steps = len(self.ext_resources) + 2
        lines.append(f"[gd_scene load_steps={load_steps} format=3]")
        lines.append("")
        lines.extend(self.ext_resources)
        lines.append("")
        lines.extend(self.nodes)
        return "\n".join(lines) + "\n"


def export_screen(
    screen_json: Path,
    pack_dir: Path,
    target_project: Path,
    slug: str,
) -> Path:
    tree = json.loads(screen_json.read_text(encoding="utf-8"))
    root = tree["root"]
    canvas = (int(root["abs_rect"]["w"]), int(root["abs_rect"]["h"]))
    exp = _Exporter(slug, pack_dir, target_project, canvas)
    exp.render_tree(root, "", None)
    # Inject canvas size on root Control
    # The first "[node ... ]" we emitted is the root; we already wrote its layout offsets.
    text = exp.emit()

    out = target_project / "screens" / f"{screen_json.stem}.tscn"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("screen_json", type=Path)
    ap.add_argument("pack_dir", type=Path)
    ap.add_argument("target_project", type=Path)
    ap.add_argument("--slug", default="pack")
    args = ap.parse_args()

    out = export_screen(args.screen_json, args.pack_dir, args.target_project, args.slug)
    print(f"wrote {out}")
