"""TextMeshPro rich-text tag handling.

TMP parses inline markup at runtime: <size=N>, <color=#hex>, <b>, <i>, <sprite>,
<align>, <line-height>, etc. If the raw string is forwarded to Figma / Godot /
Pillow, the markup renders as literal text. We strip tags for the visible string
and return a list of styled segments for downstream renderers that want richer
output later.
"""
from __future__ import annotations

import re

_TAG_RE = re.compile(r"<([^>]+)>")
_COLOR_RE = re.compile(r"color\s*=\s*(#[0-9a-fA-F]{6,8}|[A-Za-z]+)")
_SIZE_RE = re.compile(r"size\s*=\s*([0-9.]+)(px|em|%)?")


def strip_tags(text: str) -> str:
    """Return `text` with every `<...>` tag removed."""
    if not text or "<" not in text:
        return text or ""
    return _TAG_RE.sub("", text)


def parse_segments(text: str) -> list[dict]:
    """Return [{chars, color?, size?, bold, italic}] segments for range styling.

    Unsupported tags (sprite, align, line-height, cspace, gradient, font, ...) are
    stripped silently. Good-enough coverage for labels like '<size=33><color=#ff0>X</color></size> 2/10'.
    """
    if not text:
        return [{"chars": "", "color": None, "size": None, "bold": False, "italic": False}]

    segments: list[dict] = []
    color_stack: list[str] = []
    size_stack: list[float] = []
    bold = 0
    italic = 0

    pos = 0
    buf: list[str] = []

    def flush() -> None:
        if not buf:
            return
        segments.append({
            "chars": "".join(buf),
            "color": color_stack[-1] if color_stack else None,
            "size": size_stack[-1] if size_stack else None,
            "bold": bold > 0,
            "italic": italic > 0,
        })
        buf.clear()

    for m in _TAG_RE.finditer(text):
        buf.append(text[pos:m.start()])
        tag = m.group(1).strip()
        lower = tag.lower()
        flush()
        if lower == "b":
            bold += 1
        elif lower == "/b":
            bold = max(0, bold - 1)
        elif lower == "i":
            italic += 1
        elif lower == "/i":
            italic = max(0, italic - 1)
        elif lower.startswith("color"):
            cm = _COLOR_RE.search(tag)
            if cm:
                color_stack.append(cm.group(1))
        elif lower == "/color":
            if color_stack:
                color_stack.pop()
        elif lower.startswith("size"):
            sm = _SIZE_RE.search(tag)
            if sm:
                try:
                    size_stack.append(float(sm.group(1)))
                except ValueError:
                    pass
        elif lower == "/size":
            if size_stack:
                size_stack.pop()
        # Silently skip unsupported tags
        pos = m.end()

    buf.append(text[pos:])
    flush()
    return [s for s in segments if s["chars"]]
