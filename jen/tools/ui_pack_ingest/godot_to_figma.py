"""Parse a Godot 4 `.tscn` scene and emit a Figma-plugin bundle JSON.

The output format is exactly what `UI Pack Importer` plugin expects, so the
same plugin handles Unity-origin and Godot-origin imports without changes.

Usage:
  python tools/ui_pack_ingest/godot_to_figma.py <tscn-file-or-dir> \
      [--project <godot-project-root>] [--slug <slug>] \
      [--out <bundle.json>]

The project root is used to resolve `res://` paths; defaults to the nearest
parent of the tscn that contains `project.godot`.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path


# ---------------------------- tscn parser -----------------------------------

_SECTION_RE = re.compile(r"^\[(\w+)\s*(.*?)\]\s*$")
_KV_RE = re.compile(r"""(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"|(\w+)\s*=\s*([^\s]+)""")


def _parse_header_attrs(attrs_str: str) -> dict:
    """Turn `name="X" type="Y" parent="."` into a dict."""
    out: dict[str, str] = {}
    for m in re.finditer(r'(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"', attrs_str):
        out[m.group(1)] = m.group(2).replace('\\"', '"').replace("\\\\", "\\")
    return out


def _parse_value(raw: str):
    """Parse a tscn value — handles numbers, quoted strings, Color(...), Vector2(...),
    ExtResource("id"), and arrays. Returns a Python value or a raw marker."""
    raw = raw.strip()
    if raw == "true":
        return True
    if raw == "false":
        return False
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1].replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
    # numbers
    try:
        if "." in raw or "e" in raw or "E" in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        pass
    # ExtResource("t_1") -> ("ExtResource", "t_1")
    m = re.match(r'ExtResource\s*\(\s*"([^"]+)"\s*\)', raw)
    if m:
        return ("ExtResource", m.group(1))
    # Color(r, g, b, a)
    m = re.match(r'Color\s*\(([^)]*)\)', raw)
    if m:
        parts = [float(x.strip()) for x in m.group(1).split(",") if x.strip()]
        while len(parts) < 4:
            parts.append(1.0)
        return ("Color", parts)
    # Vector2(x, y)
    m = re.match(r'Vector2\s*\(([^)]*)\)', raw)
    if m:
        parts = [float(x.strip()) for x in m.group(1).split(",") if x.strip()]
        if len(parts) < 2:
            parts.append(0.0)
        return ("Vector2", parts[:2])
    return raw  # unknown — keep as string


def parse_tscn(path: Path) -> dict:
    """Returns {ext_resources: {id: {type,path}}, nodes: [{header, props, path}]}."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    ext_resources: dict[str, dict] = {}
    nodes: list[dict] = []
    current: dict | None = None

    def close_current():
        if current is not None:
            nodes.append(current)

    for line in lines:
        s = line.rstrip()
        if not s:
            continue
        m = _SECTION_RE.match(s)
        if m:
            # Closing the prior section
            tag = m.group(1)
            attrs = _parse_header_attrs(m.group(2))
            if tag == "gd_scene":
                continue
            if tag == "ext_resource":
                ext_resources[attrs.get("id", "?")] = {
                    "type": attrs.get("type"),
                    "path": attrs.get("path"),
                }
                current = None
                continue
            if tag == "node":
                close_current()
                current = {"header": attrs, "props": {}}
                continue
            # sub_resource, connection, etc. — ignore for now
            close_current()
            current = None
            continue
        # key = value inside current section
        if current is None:
            continue
        if "=" not in s:
            continue
        key, _, val = s.partition("=")
        current["props"][key.strip()] = _parse_value(val.strip())
    close_current()
    return {"ext_resources": ext_resources, "nodes": nodes}


# ---------------------------- tree assembly ---------------------------------

def _canonical_path(header: dict, root_name: str) -> str:
    """Canonical node path from scene root (always starts with root name)."""
    parent = header.get("parent")
    name = header.get("name", "?")
    if parent is None:
        return name
    if parent == ".":
        return f"{root_name}/{name}"
    return f"{root_name}/{parent}/{name}"


def build_tree(parsed: dict) -> dict:
    """Produce a nested tree {name,type,props,children} with absolute rects computed.

    Godot `layout_mode = 0` means `offset_*` are relative to the parent Control's
    origin. We accumulate parent_abs_x/y to get absolute coordinates.
    """
    nodes = parsed["nodes"]
    if not nodes:
        raise RuntimeError("no nodes in scene")

    root_header = nodes[0]["header"]
    root_name = root_header.get("name", "Root")
    # Index by canonical path
    by_path: dict[str, dict] = {}
    for n in nodes:
        p = _canonical_path(n["header"], root_name)
        by_path[p] = {
            "name": n["header"].get("name", "?"),
            "type": n["header"].get("type", "Node"),
            "parent_path": (root_name if n["header"].get("parent") == "." else
                            (f"{root_name}/{n['header']['parent']}" if n["header"].get("parent") else None)),
            "path": p,
            "props": n["props"],
            "children": [],
        }

    for p, node in by_path.items():
        pp = node["parent_path"]
        if pp and pp in by_path:
            by_path[pp]["children"].append(node)
    return by_path[root_name]


def _abs_rect(node: dict, parent_abs: tuple[float, float]) -> tuple[float, float, float, float]:
    props = node["props"]
    ol = float(props.get("offset_left", 0) or 0)
    ot = float(props.get("offset_top", 0) or 0)
    or_ = float(props.get("offset_right", 0) or 0)
    ob = float(props.get("offset_bottom", 0) or 0)
    w = max(0.0, or_ - ol)
    h = max(0.0, ob - ot)
    return (parent_abs[0] + ol, parent_abs[1] + ot, w, h)


# ---------------------------- res:// resolution -----------------------------

def _find_project_root(start: Path) -> Path | None:
    cur = start.resolve()
    if cur.is_file():
        cur = cur.parent
    while cur != cur.parent:
        if (cur / "project.godot").is_file():
            return cur
        cur = cur.parent
    return None


def _resolve_res(res_path: str, project_root: Path) -> Path:
    assert res_path.startswith("res://")
    return project_root / res_path[len("res://"):]


# ---------------------------- bundle builder --------------------------------

def _color_to_rgba(v) -> list[float] | None:
    if isinstance(v, tuple) and v and v[0] == "Color":
        return list(v[1])
    return None


def _extres_path(v, ext: dict, project_root: Path) -> Path | None:
    if isinstance(v, tuple) and v and v[0] == "ExtResource":
        e = ext.get(v[1])
        if e and e.get("path"):
            return _resolve_res(e["path"], project_root)
    return None


def _halign(v) -> str:
    if v == 1: return "CENTER"
    if v == 2: return "RIGHT"
    return "LEFT"


def _valign(v) -> str:
    if v == 1: return "CENTER"
    if v == 2: return "BOTTOM"
    return "TOP"


def build_bundle(tscn_path: Path, project_root: Path, slug: str) -> dict:
    parsed = parse_tscn(tscn_path)
    root = build_tree(parsed)
    ext = parsed["ext_resources"]

    images: dict[str, str] = {}   # key -> base64 PNG
    nodes_out: list[dict] = []

    # Compute canvas size from root offsets
    def flatten(node: dict, parent_abs: tuple[float, float]) -> None:
        x, y, w, h = _abs_rect(node, parent_abs)
        props = node["props"]
        typ = node["type"]
        rotation_deg = 0.0
        r = props.get("rotation")
        if isinstance(r, (int, float)) and r:
            rotation_deg = -float(r) * 180.0 / 3.14159265  # Godot 2D radians -> figma deg; sign matches export
        opacity = None
        mod = props.get("modulate") or props.get("self_modulate")
        c = _color_to_rgba(mod)
        if c:
            opacity = c[3]

        if typ in ("TextureRect", "NinePatchRect"):
            tex = _extres_path(props.get("texture"), ext, project_root)
            image_key = None
            if tex and tex.is_file():
                png = tex.read_bytes()
                key = tex.stem  # imageRef-like key; unique per file
                if key not in images:
                    images[key] = base64.b64encode(png).decode("ascii")
                image_key = key
            color_rgba = _color_to_rgba(props.get("self_modulate"))
            nodes_out.append({
                "id": node["path"],
                "name": node["name"],
                "type": "image",
                "rect": {"x": int(round(x)), "y": int(round(y)), "w": int(round(w)), "h": int(round(h))},
                "rotation_deg": rotation_deg,
                "opacity": opacity if opacity is not None else 1.0,
                "image_key": image_key,
                "color_rgba": color_rgba,
            })
        elif typ == "ColorRect":
            color_rgba = _color_to_rgba(props.get("color")) or [1, 1, 1, 1]
            nodes_out.append({
                "id": node["path"],
                "name": node["name"],
                "type": "image",
                "rect": {"x": int(round(x)), "y": int(round(y)), "w": int(round(w)), "h": int(round(h))},
                "rotation_deg": rotation_deg,
                "opacity": 1.0,
                "image_key": None,
                "color_rgba": color_rgba,
            })
        elif typ == "Label":
            font_rgba = _color_to_rgba(props.get("theme_override_colors/font_color")) or [1, 1, 1, 1]
            outline_rgba = _color_to_rgba(props.get("theme_override_colors/font_outline_color"))
            shadow_rgba = _color_to_rgba(props.get("theme_override_colors/font_shadow_color"))
            outline_size = int(props.get("theme_override_constants/outline_size") or 0)
            shadow_ox = int(props.get("theme_override_constants/shadow_offset_x") or 0)
            shadow_oy = int(props.get("theme_override_constants/shadow_offset_y") or 0)
            font_size = int(props.get("theme_override_font_sizes/font_size") or 36)
            font_path = _extres_path(props.get("theme_override_fonts/font"), ext, project_root)
            family = font_path.stem.split("-")[0] if font_path else "Inter"
            family_readable = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", family)
            nodes_out.append({
                "id": node["path"],
                "name": node["name"],
                "type": "text",
                "rect": {"x": int(round(x)), "y": int(round(y)), "w": int(round(w)), "h": int(round(h))},
                "rotation_deg": rotation_deg,
                "opacity": 1.0,
                "text": {
                    "characters": str(props.get("text") or ""),
                    "segments": [{"chars": str(props.get("text") or ""), "color": None, "size": None, "bold": False, "italic": False}],
                    "family": family_readable,
                    "style": "Regular",
                    "size": font_size,
                    "color_rgba": font_rgba,
                    "align_h": _halign(props.get("horizontal_alignment")),
                    "align_v": _valign(props.get("vertical_alignment")),
                    "outline_px": max(0, outline_size // 2),  # inverse of export_godot's doubling
                    "outline_rgba": outline_rgba or [0, 0, 0, 1],
                    "shadow_offset": [shadow_ox, shadow_oy],
                    "shadow_rgba": shadow_rgba or [0, 0, 0, 0.5],
                },
            })
        else:
            # Control, etc. — emit as a transparent frame so hierarchy is preserved visually
            if w > 0 and h > 0 and node["children"]:
                nodes_out.append({
                    "id": node["path"],
                    "name": node["name"],
                    "type": "frame",
                    "rect": {"x": int(round(x)), "y": int(round(y)), "w": int(round(w)), "h": int(round(h))},
                    "rotation_deg": rotation_deg,
                    "opacity": 1.0,
                })

        for c in node["children"]:
            flatten(c, (x, y))

    flatten(root, (0.0, 0.0))

    _, _, rw, rh = _abs_rect(root, (0.0, 0.0))
    screen = {
        "name": root["name"],
        "canvas": [int(round(rw)), int(round(rh))],
        "nodes": nodes_out,
    }
    return {"slug": slug, "images": images, "screens": [screen]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tscn", type=Path, help="Path to a .tscn file or a directory of .tscn files")
    ap.add_argument("--project", type=Path, default=None,
                    help="Godot project root (folder containing project.godot). Auto-detected if omitted.")
    ap.add_argument("--slug", default="godot_import")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    tscn_files: list[Path]
    if args.tscn.is_dir():
        tscn_files = sorted(args.tscn.rglob("*.tscn"))
    else:
        tscn_files = [args.tscn]
    if not tscn_files:
        raise SystemExit(f"no .tscn files at {args.tscn}")

    # Project root: from flag, or auto-detect from first tscn
    project_root = args.project or _find_project_root(tscn_files[0])
    if project_root is None:
        raise SystemExit("could not find project.godot; pass --project")

    # Build per-tscn bundles and merge
    combined = {"slug": args.slug, "images": {}, "screens": []}
    for tscn in tscn_files:
        b = build_bundle(tscn, project_root, args.slug)
        combined["screens"].extend(b["screens"])
        combined["images"].update(b["images"])

    out = args.out or (Path(__file__).resolve().parents[2] / "experiments" / "ui_pack_validation"
                       / "figma_bundles" / f"{args.slug}_bundle.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(combined), encoding="utf-8")
    n_nodes = sum(len(s["nodes"]) for s in combined["screens"])
    print(f"wrote {out}")
    print(f"  screens: {len(combined['screens'])}")
    print(f"  nodes:   {n_nodes}")
    print(f"  images:  {len(combined['images'])}")
    print(f"  size:    {out.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
