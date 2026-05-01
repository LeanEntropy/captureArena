"""
Generate action-movie posters for the title-screen companion page.

FALLBACK PATH (no RunComfy / ComfyUI reachable in this environment):
  Composites the four posters from the existing Theme F game screenshots
  + procedural overlays (vignette, color grade, faction-stripe motif,
  knockout title typography). Each poster is 1200x1500 (poster ratio 4:5).

Outputs to: docs/visual-direction-mockups/title-screens/posters/
  poster_a_five_factions.png
  poster_b_dominate_the_tide.png
  poster_c_last_one_standing.png
  poster_d_paint_the_world.png

Run from repo root: python jen/scripts/generate_title_posters.py
"""
import os
import math
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(REPO_ROOT, "docs", "visual-direction-mockups", "r5-themef-game")
OUT_DIR = os.path.join(REPO_ROOT, "docs", "visual-direction-mockups", "title-screens", "posters")

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

FACTIONS = [
    ("RED", (231, 74, 63)),
    ("BLUE", (61, 108, 208)),
    ("GREEN", (82, 184, 86)),
    ("YELLOW", (255, 207, 42)),
    ("PURPLE", (169, 75, 190)),
]

POSTER_W, POSTER_H = 1200, 1500


def load(name):
    path = os.path.join(SRC_DIR, name)
    return Image.open(path).convert("RGB")


def cover_fit(img: Image.Image, w: int, h: int) -> Image.Image:
    """Scale + crop to exactly w*h, centered (object-fit:cover)."""
    src_ratio = img.width / img.height
    tgt_ratio = w / h
    if src_ratio > tgt_ratio:
        new_h = h
        new_w = int(h * src_ratio)
    else:
        new_w = w
        new_h = int(w / src_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    x = (new_w - w) // 2
    y = (new_h - h) // 2
    return img.crop((x, y, x + w, y + h))


def vignette(img: Image.Image, strength: float = 0.85) -> Image.Image:
    """Multiply with a radial dark mask. strength=1.0 → fully black corners."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = w / 2, h / 2
    max_d = math.hypot(cx, cy)
    # render in a smaller buffer for speed, then upscale
    buf_w, buf_h = w // 4, h // 4
    buf = Image.new("L", (buf_w, buf_h), 0)
    bp = buf.load()
    for y in range(buf_h):
        for x in range(buf_w):
            fx, fy = x / buf_w * w, y / buf_h * h
            d2 = math.hypot(fx - cx, fy - cy) / max_d
            v = 255 - int(min(255, max(0, (d2 ** 2) * 255 * strength)))
            bp[x, y] = v
    mask = buf.resize((w, h), Image.BILINEAR)
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(img, dark, mask)


def color_grade(img: Image.Image, tint=(255, 200, 140), amount=0.18) -> Image.Image:
    """Action-movie warm-orange highlights / teal-shadow grade."""
    img = ImageEnhance.Contrast(img).enhance(1.20)
    img = ImageEnhance.Color(img).enhance(1.10)
    overlay = Image.new("RGB", img.size, tint)
    return Image.blend(img, overlay, amount)


def teal_orange(img: Image.Image) -> Image.Image:
    """Crude teal+orange split-tone: shadows → teal, highlights → orange."""
    r, g, b = img.split()
    # boost reds in highlights, boost blue/green in shadows
    r = r.point(lambda v: min(255, int(v * 1.05)))
    b = b.point(lambda v: int(v * 0.95))
    return Image.merge("RGB", (r, g, b))


def text_with_stroke(draw, xy, text, font, fill, stroke_fill, stroke_w):
    draw.text(xy, text, font=font, fill=fill, stroke_width=stroke_w,
              stroke_fill=stroke_fill)


def knockout_title(canvas: Image.Image, text: str, y_top: int, height: int,
                    fill=(255, 255, 255), stroke=(0, 0, 0), stroke_w=8):
    """Draw a chunky title centered horizontally."""
    fnt = ImageFont.truetype(FONT_BOLD, height)
    draw = ImageDraw.Draw(canvas)
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    x = (canvas.width - tw) // 2 - bbox[0]
    text_with_stroke(draw, (x, y_top), text, fnt, fill, stroke, stroke_w)


def faction_strip(canvas: Image.Image, y_top: int, h: int):
    draw = ImageDraw.Draw(canvas)
    sw = canvas.width // 5
    for i, (_, c) in enumerate(FACTIONS):
        draw.rectangle([i * sw, y_top, (i + 1) * sw, y_top + h], fill=c)


def jen_credit(canvas: Image.Image, label: str):
    fnt = ImageFont.truetype(FONT_MONO, 18)
    draw = ImageDraw.Draw(canvas)
    txt = f"// {label}  |  Jen — Art Direction Companion"
    bbox = draw.textbbox((0, 0), txt, font=fnt)
    tw = bbox[2] - bbox[0]
    draw.text((canvas.width - tw - 24, canvas.height - 36), txt,
              font=fnt, fill=(180, 180, 180))


# ── Poster A: FIVE FACTIONS. ONE ISLAND. ─────────────────────────────────
def poster_a():
    base = load("jen-themef-04-overview-locked.png")
    img = cover_fit(base, POSTER_W, POSTER_H)
    img = color_grade(img, tint=(255, 200, 140), amount=0.10)
    img = vignette(img, 0.95)
    # darken further
    img = ImageEnhance.Brightness(img).enhance(0.85)

    # Top faction-color hairline strip
    faction_strip(img, 0, 14)

    # Title block — stack "LAND" / "CAPTURE" so neither line clips even
    # at the widest poster.
    knockout_title(img, "LAND", y_top=140, height=180,
                    fill=(255, 240, 200), stroke=(20, 12, 8), stroke_w=10)
    knockout_title(img, "CAPTURE", y_top=320, height=180,
                    fill=(255, 240, 200), stroke=(20, 12, 8), stroke_w=10)

    # Tagline below
    fnt_tag = ImageFont.truetype(FONT_BOLD, 52)
    draw = ImageDraw.Draw(img)
    tag = "FIVE FACTIONS.  ONE ISLAND."
    bbox = draw.textbbox((0, 0), tag, font=fnt_tag)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, 540), tag, font=fnt_tag,
              fill=(255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0))

    # Bottom black slab with sub-tagline (taller so labels fit cleanly above
    # the bottom hairline + jen credit).
    slab_h = 320
    slab_y = POSTER_H - slab_h
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([0, slab_y, POSTER_W, POSTER_H], fill=(10, 10, 16, 230))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    fnt_sub = ImageFont.truetype(FONT_BOLD, 36)
    draw = ImageDraw.Draw(img)
    sub = "CLAIM TERRITORY  •  HOLD THE LINE  •  DOMINATE"
    bbox = draw.textbbox((0, 0), sub, font=fnt_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, slab_y + 36), sub, font=fnt_sub,
              fill=(255, 230, 180))

    # Faction color squares as visual key
    sq_size = 78
    gap = 18
    total_w = sq_size * 5 + gap * 4
    start_x = (POSTER_W - total_w) // 2
    sq_y = slab_y + 110
    for i, (name, c) in enumerate(FACTIONS):
        x = start_x + i * (sq_size + gap)
        draw.rectangle([x, sq_y, x + sq_size, sq_y + sq_size], fill=c,
                       outline=(255, 255, 255), width=3)
        fnt_lbl = ImageFont.truetype(FONT_MONO, 14)
        bbox = draw.textbbox((0, 0), name, font=fnt_lbl)
        lw = bbox[2] - bbox[0]
        draw.text((x + (sq_size - lw) // 2, sq_y + sq_size + 10), name,
                  font=fnt_lbl, fill=(255, 255, 255))

    # Bottom hairline (kept thin so it doesn't compete with credit row)
    faction_strip(img, POSTER_H - 14, 14)
    jen_credit(img, "POSTER A")
    return img


# ── Poster B: DOMINATE THE TIDE ──────────────────────────────────────────
def poster_b():
    base = load("jen-themef-17-character-closeup.png")
    img = cover_fit(base, POSTER_W, POSTER_H)
    img = teal_orange(img)
    img = color_grade(img, tint=(120, 180, 220), amount=0.12)
    img = vignette(img, 0.7)
    img = ImageEnhance.Contrast(img).enhance(1.15)

    # Diagonal slash bar (cinema poster classic)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # large green-faction slash from upper-left to mid-right
    pts = [(0, 1100), (POSTER_W, 880), (POSTER_W, 1000), (0, 1220)]
    od.polygon(pts, fill=(82, 184, 86, 220))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    # Title — angled feel via positioning, but PIL lacks easy rotation here;
    # use a separate transparent layer and rotate it.
    title_layer = Image.new("RGBA", (1400, 300), (0, 0, 0, 0))
    tl_draw = ImageDraw.Draw(title_layer)
    fnt_title = ImageFont.truetype(FONT_BOLD, 200)
    tl_draw.text((20, 30), "DOMINATE", font=fnt_title, fill=(255, 240, 220),
                 stroke_width=12, stroke_fill=(0, 0, 0))
    title_layer = title_layer.rotate(-4, resample=Image.BICUBIC, expand=True)
    img.paste(title_layer, (-50, 240), title_layer)

    fnt_sub = ImageFont.truetype(FONT_BOLD, 130)
    draw = ImageDraw.Draw(img)
    sub = "THE TIDE"
    bbox = draw.textbbox((0, 0), sub, font=fnt_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, 480), sub, font=fnt_sub,
              fill=(255, 207, 42), stroke_width=8, stroke_fill=(0, 0, 0))

    # Land Capture credit at bottom (smaller — this is one chapter of the franchise)
    fnt_lc = ImageFont.truetype(FONT_BOLD, 70)
    lc = "LAND CAPTURE"
    bbox = draw.textbbox((0, 0), lc, font=fnt_lc)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, POSTER_H - 200), lc, font=fnt_lc,
              fill=(255, 255, 255), stroke_width=5, stroke_fill=(0, 0, 0))

    # Tagline strip
    fnt_tg = ImageFont.truetype(FONT_MONO, 28)
    tg = "ONE PLAYER  ·  TWENTY-NINE BOTS  ·  ONE ISLAND"
    bbox = draw.textbbox((0, 0), tg, font=fnt_tg)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, POSTER_H - 100), tg, font=fnt_tg,
              fill=(200, 220, 240))

    jen_credit(img, "POSTER B")
    return img


# ── Poster C: LAST ONE STANDING ──────────────────────────────────────────
def poster_c():
    base = load("jen-themef-16-online-initial.png")
    img = cover_fit(base, POSTER_W, POSTER_H)
    img = ImageEnhance.Color(img).enhance(0.55)  # near-monochrome
    img = ImageEnhance.Contrast(img).enhance(1.35)
    img = color_grade(img, tint=(255, 165, 80), amount=0.18)  # warm shadows
    img = vignette(img, 1.0)

    # Single dramatic faction-color slash up the side (BLUE, the lone player's color)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([0, 0, 28, POSTER_H], fill=(61, 108, 208, 255))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    draw = ImageDraw.Draw(img)
    # Bold horror-poster title — heavy weight, knockout black, blood-red shadow
    fnt_title = ImageFont.truetype(FONT_BOLD, 140)
    title = "LAND CAPTURE"
    bbox = draw.textbbox((0, 0), title, font=fnt_title)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, 150), title, font=fnt_title,
              fill=(255, 255, 255), stroke_width=10, stroke_fill=(20, 8, 4))

    # Big subtitle
    fnt_sub = ImageFont.truetype(FONT_BOLD, 90)
    sub = "LAST ONE"
    bbox = draw.textbbox((0, 0), sub, font=fnt_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, 320), sub, font=fnt_sub,
              fill=(231, 74, 63), stroke_width=6, stroke_fill=(0, 0, 0))

    sub2 = "STANDING"
    bbox = draw.textbbox((0, 0), sub2, font=fnt_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, 420), sub2, font=fnt_sub,
              fill=(231, 74, 63), stroke_width=6, stroke_fill=(0, 0, 0))

    # Bottom byline strip
    overlay2 = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od2 = ImageDraw.Draw(overlay2)
    od2.rectangle([0, POSTER_H - 130, POSTER_W, POSTER_H], fill=(0, 0, 0, 200))
    img = Image.alpha_composite(img.convert("RGBA"), overlay2).convert("RGB")

    draw = ImageDraw.Draw(img)
    fnt_b = ImageFont.truetype(FONT_MONO, 24)
    bl = "WHEN THE WATER RISES,  ONLY ONE COLOR REMAINS."
    bbox = draw.textbbox((0, 0), bl, font=fnt_b)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, POSTER_H - 92), bl, font=fnt_b,
              fill=(220, 220, 220))
    fnt_b2 = ImageFont.truetype(FONT_MONO, 18)
    bl2 = "JEN STUDIOS  ·  IN COMPETITION  ·  COMING SOON"
    bbox = draw.textbbox((0, 0), bl2, font=fnt_b2)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, POSTER_H - 50), bl2, font=fnt_b2,
              fill=(150, 150, 150))

    jen_credit(img, "POSTER C")
    return img


# ── Poster D: PAINT THE WORLD ────────────────────────────────────────────
def poster_d():
    """Color-explosion poster: starburst of all 5 faction colors emanating
    from center, "LAND CAPTURE" title in white knockout."""
    img = Image.new("RGB", (POSTER_W, POSTER_H), (242, 235, 220))  # cream

    cx, cy = POSTER_W // 2, POSTER_H // 2
    draw = ImageDraw.Draw(img)
    # Starburst: alternate faction colors radiating from center
    n_rays = 30
    radius = math.hypot(POSTER_W, POSTER_H)
    for i in range(n_rays):
        a0 = (i / n_rays) * 2 * math.pi
        a1 = ((i + 1) / n_rays) * 2 * math.pi
        c = FACTIONS[i % 5][1]
        x0 = cx + math.cos(a0) * radius
        y0 = cy + math.sin(a0) * radius
        x1 = cx + math.cos(a1) * radius
        y1 = cy + math.sin(a1) * radius
        draw.polygon([(cx, cy), (x0, y0), (x1, y1)], fill=c)

    # Inner cream disc to put title on
    disc_r = 480
    draw.ellipse([cx - disc_r, cy - disc_r, cx + disc_r, cy + disc_r],
                 fill=(248, 240, 225), outline=(20, 12, 8), width=12)

    # Title
    fnt_t = ImageFont.truetype(FONT_BOLD, 140)
    title = "LAND"
    bbox = draw.textbbox((0, 0), title, font=fnt_t)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, cy - 200), title, font=fnt_t,
              fill=(20, 12, 8))
    title2 = "CAPTURE"
    bbox = draw.textbbox((0, 0), title2, font=fnt_t)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, cy - 60), title2, font=fnt_t,
              fill=(20, 12, 8))

    # Tagline
    fnt_tg = ImageFont.truetype(FONT_BOLD, 42)
    tg = "PAINT THE WORLD"
    bbox = draw.textbbox((0, 0), tg, font=fnt_tg)
    tw = bbox[2] - bbox[0]
    draw.text(((POSTER_W - tw) // 2, cy + 90), tg, font=fnt_tg,
              fill=(231, 74, 63))

    # 5 cube avatars under the title (BoxGeometry-flavored — flat parallelograms)
    cube_size = 70
    gap = 30
    total_w = cube_size * 5 + gap * 4
    sx = (POSTER_W - total_w) // 2
    cy_cubes = cy + 200
    for i, (_, c) in enumerate(FACTIONS):
        x = sx + i * (cube_size + gap)
        # Front face
        draw.rectangle([x, cy_cubes, x + cube_size, cy_cubes + cube_size],
                       fill=c, outline=(20, 12, 8), width=5)
        # Top face (parallelogram, skewed right)
        skew = 22
        top_pts = [
            (x, cy_cubes),
            (x + skew, cy_cubes - skew),
            (x + cube_size + skew, cy_cubes - skew),
            (x + cube_size, cy_cubes),
        ]
        # lighter top color
        lighter = tuple(min(255, int(v * 1.25)) for v in c)
        draw.polygon(top_pts, fill=lighter, outline=(20, 12, 8))
        # white sailor cap on top
        cap_w = cube_size - 16
        cap_x = x + 8
        cap_y = cy_cubes - skew - 18
        draw.rectangle([cap_x, cap_y, cap_x + cap_w, cap_y + 18],
                       fill=(255, 255, 255), outline=(20, 12, 8), width=4)
        draw.rectangle([cap_x + 4, cap_y - 10, cap_x + cap_w - 4, cap_y],
                       fill=(255, 255, 255), outline=(20, 12, 8), width=4)

    jen_credit(img, "POSTER D")
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    posters = [
        ("poster_a_five_factions.png", poster_a),
        ("poster_b_dominate_the_tide.png", poster_b),
        ("poster_c_last_one_standing.png", poster_c),
        ("poster_d_paint_the_world.png", poster_d),
    ]
    for name, fn in posters:
        print(f"Rendering {name} ...")
        img = fn()
        path = os.path.join(OUT_DIR, name)
        img.save(path, optimize=True)
        print(f"  → {path}  ({img.width}x{img.height})")
    print(f"\nAll posters saved under: {OUT_DIR}")


if __name__ == "__main__":
    main()
