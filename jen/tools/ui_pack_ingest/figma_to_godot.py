"""Pull a Figma file's frames + images via REST and emit a Godot 4.6 .tscn per
frame. Mirrors the Figma plugin import in reverse: Figma is the source of truth,
Godot is the target.

Usage:
  python tools/ui_pack_ingest/figma_to_godot.py <FIGMA_URL_OR_KEY> <TARGET_GODOT_PROJECT>
                                                 [--slug <slug>] [--node <nodeId>]
                                                 [--frames <name1> <name2> ...]

Requires FIGMA_PAT in .env (already present in this repo).

Writes:
  <target>/screens/<frame_name>.tscn
  <target>/ui_packs/<slug>/images/<hash>.png
  <target>/ui_packs/<slug>/_fonts/<family>.ttf   (copied from references/fonts/)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


REPO = Path(__file__).resolve().parents[2]
FIGMA_API = "https://api.figma.com/v1"


# ---------------------------- auth ------------------------------------------

def _load_token() -> str:
    env_path = REPO / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("FIGMA_PAT="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    tok = os.environ.get("FIGMA_PAT")
    if tok:
        return tok
    raise RuntimeError("FIGMA_PAT not found in .env or environment")


def _http_get(url: str, token: str, as_bytes: bool = False) -> bytes | dict:
    req = urllib.request.Request(url, headers={"X-Figma-Token": token, "User-Agent": "ui-pack-ingest/1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if as_bytes:
        return data
    return json.loads(data.decode("utf-8"))


# ---------------------------- URL parsing -----------------------------------

_URL_RE = re.compile(r"figma\.com/(?:file|design|board|make)/([^/?#]+)")


def parse_figma_url(arg: str) -> tuple[str, str | None]:
    """Accept a full Figma URL or a bare file key. Returns (file_key, node_id_or_None)."""
    m = _URL_RE.search(arg)
    file_key = m.group(1) if m else arg
    node_id = None
    if "node-id=" in arg:
        raw = urllib.parse.parse_qs(urllib.parse.urlparse(arg).query).get("node-id", [None])[0]
        if raw:
            node_id = raw.replace("-", ":")
    return file_key, node_id


# ---------------------------- Figma tree walking ----------------------------

def _fetch_file(file_key: str, node_id: str | None, token: str) -> dict:
    if node_id:
        url = f"{FIGMA_API}/files/{file_key}/nodes?ids={urllib.parse.quote(node_id)}"
        payload = _http_get(url, token)
        nodes = payload.get("nodes", {})
        if not nodes:
            raise RuntimeError(f"node {node_id} not found in Figma file {file_key}")
        return {"document": next(iter(nodes.values()))["document"], "name": payload.get("name", file_key)}
    url = f"{FIGMA_API}/files/{file_key}"
    payload = _http_get(url, token)
    return {"document": payload["document"], "name": payload.get("name", file_key)}


def _fetch_image_refs(file_key: str, token: str) -> dict[str, str]:
    """Figma /images endpoint maps imageRef -> CDN URL for every image stored in the file."""
    url = f"{FIGMA_API}/files/{file_key}/images"
    payload = _http_get(url, token)
    return payload.get("meta", {}).get("images", {}) or {}


def _collect_image_refs(node: dict, out: set[str]) -> None:
    for fill in node.get("fills") or []:
        if fill.get("type") == "IMAGE" and fill.get("imageRef"):
            out.add(fill["imageRef"])
    for c in node.get("children") or []:
        _collect_image_refs(c, out)


def _collect_frames(root: dict, wanted_names: list[str] | None) -> list[dict]:
    frames: list[dict] = []

    def walk(n: dict) -> None:
        if n.get("type") == "FRAME":
            if wanted_names is None or n.get("name") in wanted_names:
                frames.append(n)
        for c in n.get("children") or []:
            walk(c)

    walk(root)
    if not frames and root.get("type") == "FRAME":
        frames.append(root)
    return frames


# ---------------------------- tscn emitter ----------------------------------

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


def _gd_color(rgba) -> str:
    r, g, b, a = (list(rgba) + [1.0] * 4)[:4]
    return f"Color({r}, {g}, {b}, {a})"


class _Scene:
    def __init__(self, slug: str, target_project: Path, frame: dict):
        self.slug = slug
        self.target_project = target_project
        self.assets_root = target_project / "ui_packs" / slug
        self.frame = frame
        self.ext_resources: list[str] = []
        self.ext_by_path: dict[str, str] = {}
        self.nodes: list[str] = []
        self.used_ids: set[str] = set()
        # Frame's top-left becomes (0,0) in the scene
        box = frame.get("absoluteBoundingBox") or {"x": 0, "y": 0, "width": 0, "height": 0}
        self.frame_x = box["x"]
        self.frame_y = box["y"]
        self.frame_w = box["width"]
        self.frame_h = box["height"]

    def _register(self, kind: str, res_path: str) -> str:
        if res_path in self.ext_by_path:
            return self.ext_by_path[res_path]
        rid = f"{kind[0].lower()}_{len(self.ext_by_path) + 1}"
        self.ext_by_path[res_path] = rid
        self.ext_resources.append(f'[ext_resource type="{kind}" path="{res_path}" id="{rid}"]')
        return rid

    def _ensure_image(self, image_ref: str, image_path: Path) -> str:
        dst = self.assets_root / "images" / f"{image_ref}.png"
        if dst.exists() and dst.stat().st_size == image_path.stat().st_size:
            pass
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, dst)
        res_path = f"res://ui_packs/{self.slug}/images/{image_ref}.png"
        return self._register("Texture2D", res_path)

    def _ensure_font(self, font_src: Path) -> str:
        dst = self.assets_root / "_fonts" / font_src.name
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(font_src, dst)
        res_path = f"res://ui_packs/{self.slug}/_fonts/{font_src.name}"
        return self._register("FontFile", res_path)

    def _node(self, name: str, node_type: str, parent: str) -> None:
        if parent == "":
            self.nodes.append(f'[node name="{name}" type="{node_type}"]')
        else:
            self.nodes.append(f'[node name="{name}" type="{node_type}" parent="{parent}"]')

    def _layout(self, box: dict, parent_box: dict | None, rotation_deg: float = 0.0) -> None:
        # Convert Figma global-space box to local-to-parent offsets
        px = parent_box["x"] if parent_box else self.frame_x
        py = parent_box["y"] if parent_box else self.frame_y
        x = box["x"] - px
        y = box["y"] - py
        w = max(0.0, box["width"])
        h = max(0.0, box["height"])
        self.nodes.append("layout_mode = 0")
        self.nodes.append(f"offset_left = {x}")
        self.nodes.append(f"offset_top = {y}")
        self.nodes.append(f"offset_right = {x + w}")
        self.nodes.append(f"offset_bottom = {y + h}")
        if rotation_deg:
            self.nodes.append(f"rotation = {-rotation_deg * 3.14159265 / 180.0}")
            self.nodes.append(f"pivot_offset = Vector2({w/2}, {h/2})")

    def render(self, node: dict, parent_path: str, parent_box: dict | None, images_on_disk: dict[str, Path]) -> None:
        name = _safe_id(node.get("name") or "Node", self.used_ids)
        t = node.get("type")
        box = node.get("absoluteBoundingBox") or {"x": self.frame_x, "y": self.frame_y, "width": 0, "height": 0}
        rotation = node.get("rotation") or 0
        fills = node.get("fills") or []
        image_fill = next((f for f in fills if f.get("type") == "IMAGE" and f.get("visible", True)), None)
        solid_fill = next((f for f in fills if f.get("type") == "SOLID" and f.get("visible", True)), None)

        if t == "TEXT":
            self._emit_text(node, name, parent_path, box, parent_box, rotation)
        elif image_fill and image_fill.get("imageRef") in images_on_disk:
            ref = image_fill["imageRef"]
            tex_id = self._ensure_image(ref, images_on_disk[ref])
            self._node(name, "TextureRect", parent_path)
            self._layout(box, parent_box, rotation)
            self.nodes.append(f'texture = ExtResource("{tex_id}")')
            self.nodes.append("expand_mode = 1")
            self.nodes.append("stretch_mode = 1")  # scale-stretch
            # Respect image fill tint if any
            col = image_fill.get("color")
            if col:
                self.nodes.append(f"self_modulate = {_gd_color([col.get('r',1), col.get('g',1), col.get('b',1), col.get('a',1)])}")
            self.nodes.append("")
        elif t in ("FRAME", "GROUP", "RECTANGLE", "COMPONENT", "INSTANCE"):
            # Solid-fill rectangle or transparent container
            self._node(name, "Control" if not solid_fill else "ColorRect", parent_path)
            self._layout(box, parent_box, rotation)
            if solid_fill:
                c = solid_fill.get("color", {})
                a = solid_fill.get("opacity", c.get("a", 1))
                self.nodes.append(f"color = {_gd_color([c.get('r',0), c.get('g',0), c.get('b',0), a])}")
            # Clip content for frames (Godot Control needs clip_contents explicit)
            if t == "FRAME" and node.get("clipsContent"):
                self.nodes.append("clip_contents = true")
            self.nodes.append("")
        else:
            # Unknown types fall back to empty Control
            self._node(name, "Control", parent_path)
            self._layout(box, parent_box, rotation)
            self.nodes.append("")

        if node.get("visible") is False and self.nodes and self.nodes[-1] == "":
            self.nodes.insert(len(self.nodes) - 1, "visible = false")

        if parent_path == "":
            child_parent = "."
        elif parent_path == ".":
            child_parent = name
        else:
            child_parent = f"{parent_path}/{name}"
        for child in node.get("children") or []:
            self.render(child, child_parent, box, images_on_disk)

    def _emit_text(self, node: dict, name: str, parent_path: str, box: dict, parent_box: dict | None, rotation: float) -> None:
        style = node.get("style") or {}
        chars = node.get("characters", "")
        font_size = int(style.get("fontSize") or 36)
        family = (style.get("fontFamily") or "Inter").strip()

        self._node(name, "Label", parent_path)
        self._layout(box, parent_box, rotation)
        escaped = chars.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        self.nodes.append(f'text = "{escaped}"')

        ta = (style.get("textAlignHorizontal") or "LEFT").upper()
        if ta in ("CENTER", "JUSTIFIED"):
            self.nodes.append("horizontal_alignment = 1")
        elif ta == "RIGHT":
            self.nodes.append("horizontal_alignment = 2")
        va = (style.get("textAlignVertical") or "TOP").upper()
        if va == "CENTER":
            self.nodes.append("vertical_alignment = 1")
        elif va == "BOTTOM":
            self.nodes.append("vertical_alignment = 2")

        # Font: map family name -> local .ttf; falls back to LilitaOne which ships
        # with this pipeline under references/fonts/
        ttf = self._pick_font(family)
        if ttf:
            font_id = self._ensure_font(ttf)
            self.nodes.append(f'theme_override_fonts/font = ExtResource("{font_id}")')
        self.nodes.append(f"theme_override_font_sizes/font_size = {font_size}")

        # Fill color (first solid fill)
        fills = node.get("fills") or []
        sf = next((f for f in fills if f.get("type") == "SOLID" and f.get("visible", True)), None)
        if sf:
            c = sf.get("color", {})
            a = sf.get("opacity", c.get("a", 1))
            self.nodes.append(f"theme_override_colors/font_color = {_gd_color([c.get('r',1), c.get('g',1), c.get('b',1), a])}")

        # Stroke = outline; Figma stores in strokes[] with strokeWeight
        strokes = node.get("strokes") or []
        if strokes and node.get("strokeWeight"):
            s = strokes[0]
            sc = s.get("color", {})
            self.nodes.append(f"theme_override_constants/outline_size = {int(node['strokeWeight']) * 2}")
            self.nodes.append(f"theme_override_colors/font_outline_color = {_gd_color([sc.get('r',0), sc.get('g',0), sc.get('b',0), sc.get('a',1)])}")

        # Drop shadow effect -> Godot shadow theme overrides
        for eff in node.get("effects") or []:
            if eff.get("type") == "DROP_SHADOW" and eff.get("visible", True):
                off = eff.get("offset", {})
                self.nodes.append(f"theme_override_constants/shadow_offset_x = {int(off.get('x', 0))}")
                self.nodes.append(f"theme_override_constants/shadow_offset_y = {int(off.get('y', 0))}")
                self.nodes.append(f"theme_override_constants/shadow_outline_size = {int(eff.get('radius', 0))}")
                c = eff.get("color") or {}
                self.nodes.append(f"theme_override_colors/font_shadow_color = {_gd_color([c.get('r',0), c.get('g',0), c.get('b',0), c.get('a',0.5)])}")
                break

        self.nodes.append("")

    def _pick_font(self, family: str) -> Path | None:
        # Best effort: prefer repo fonts, fall back to LilitaOne (our default outlined font)
        fonts_dir = REPO / "references" / "fonts"
        if not fonts_dir.is_dir():
            return None
        # Exact-ish match on filename
        for candidate in fonts_dir.glob("*.ttf"):
            stem = candidate.stem.lower().replace(" ", "").replace("-", "")
            target = family.lower().replace(" ", "").replace("-", "")
            if target in stem:
                return candidate
        default = fonts_dir / "LilitaOne-Regular.ttf"
        return default if default.is_file() else None

    def emit(self) -> str:
        lines: list[str] = []
        load_steps = len(self.ext_resources) + 2
        lines.append(f"[gd_scene load_steps={load_steps} format=3]")
        lines.append("")
        lines.extend(self.ext_resources)
        lines.append("")
        lines.extend(self.nodes)
        return "\n".join(lines) + "\n"


# ---------------------------- main ------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("figma")
    ap.add_argument("target_project", type=Path)
    ap.add_argument("--slug", default="figma_import")
    ap.add_argument("--node", default=None)
    ap.add_argument("--frames", nargs="*", default=None)
    args = ap.parse_args()

    token = _load_token()
    file_key, node_id_from_url = parse_figma_url(args.figma)
    node_id = args.node or node_id_from_url

    print(f"Fetching Figma file {file_key}" + (f" (node {node_id})" if node_id else ""))
    file_data = _fetch_file(file_key, node_id, token)

    image_ref_to_url = _fetch_image_refs(file_key, token)

    # Find all frames to export
    frames = _collect_frames(file_data["document"], args.frames)
    if not frames:
        raise SystemExit("No frames found to export. Pass --frames <name> or a --node URL.")

    # Collect + download images
    refs: set[str] = set()
    for f in frames:
        _collect_image_refs(f, refs)

    tmp_dir = args.target_project / "ui_packs" / args.slug / "_download"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    images_on_disk: dict[str, Path] = {}
    for ref in sorted(refs):
        url = image_ref_to_url.get(ref)
        if not url:
            print(f"  [skip] no URL for imageRef {ref}")
            continue
        path = tmp_dir / f"{ref}.png"
        if not path.exists():
            data = _http_get(url, token, as_bytes=True)
            path.write_bytes(data)
        images_on_disk[ref] = path
    print(f"Downloaded {len(images_on_disk)}/{len(refs)} images")

    # Emit scenes
    (args.target_project / "screens").mkdir(parents=True, exist_ok=True)
    for f in frames:
        scene = _Scene(args.slug, args.target_project, f)
        scene.render(f, "", None, images_on_disk)
        tscn = scene.emit()
        frame_name = _ID_RE.sub("_", f.get("name") or "Frame").strip("_") or "Frame"
        out = args.target_project / "screens" / f"{frame_name}.tscn"
        out.write_text(tscn, encoding="utf-8")
        print(f"  wrote {out.relative_to(args.target_project)}")


if __name__ == "__main__":
    main()
