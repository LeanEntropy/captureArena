"""Unity 9-slice blit.

Border is [L, B, R, T] in source-image pixels (from the sprite's .meta). The
source image is split into 9 patches:

  tl | t | tr
  ---+---+---
  l  | c | r
  ---+---+---
  bl | b | br

Corners render at their native size. Horizontal edges tile/stretch along x;
vertical edges along y; center stretches both. For Unity's default (no tiling
mode), all non-corner regions are bilinearly stretched.
"""
from __future__ import annotations

from PIL import Image


def nine_slice(src: Image.Image, target_w: int, target_h: int, border_lbrt: list[int]) -> Image.Image:
    L, B, R, T = [max(0, int(b)) for b in border_lbrt]
    sw, sh = src.size

    # Clamp if the source is smaller than the borders declare
    L = min(L, sw // 2)
    R = min(R, sw - L - 1) if sw > L + 1 else 0
    T = min(T, sh // 2)
    B = min(B, sh - T - 1) if sh > T + 1 else 0

    cw = max(0, sw - L - R)
    ch = max(0, sh - T - B)

    # Target geometry — if target is too small for both corners, scale them down proportionally
    tx0, tx1 = L, target_w - R
    ty0, ty1 = T, target_h - B  # Y-down target: top border first

    if tx1 <= tx0 or ty1 <= ty0:
        # Target smaller than border sum: fall back to simple stretch
        return src.resize((target_w, target_h), Image.BILINEAR)

    out = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))

    # Source rects (Y-down, Pillow convention): top-left origin
    def crop(x0, y0, x1, y1):
        return src.crop((x0, y0, x1, y1))

    tl = crop(0,     0,     L,      T)
    t  = crop(L,     0,     L+cw,   T)
    tr = crop(L+cw,  0,     sw,     T)
    l  = crop(0,     T,     L,      T+ch)
    c  = crop(L,     T,     L+cw,   T+ch)
    r  = crop(L+cw,  T,     sw,     T+ch)
    bl = crop(0,     T+ch,  L,      sh)
    b  = crop(L,     T+ch,  L+cw,   sh)
    br = crop(L+cw,  T+ch,  sw,     sh)

    def paste(patch: Image.Image, x: int, y: int, w: int, h: int) -> None:
        if w <= 0 or h <= 0:
            return
        if patch.size != (w, h):
            patch = patch.resize((w, h), Image.BILINEAR)
        out.alpha_composite(patch, (x, y))

    paste(tl, 0,   0,   L,         T)
    paste(t,  tx0, 0,   tx1 - tx0, T)
    paste(tr, tx1, 0,   R,         T)
    paste(l,  0,   ty0, L,         ty1 - ty0)
    paste(c,  tx0, ty0, tx1 - tx0, ty1 - ty0)
    paste(r,  tx1, ty0, R,         ty1 - ty0)
    paste(bl, 0,   ty1, L,         B)
    paste(b,  tx0, ty1, tx1 - tx0, B)
    paste(br, tx1, ty1, R,         B)

    return out
