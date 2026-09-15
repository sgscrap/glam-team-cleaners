#!/usr/bin/env python3
"""
Regenerate assets/social-preview.png from the site's own copy.

    npm run social

Why this is a tool rather than part of the build: rendering type needs a font engine, and the
build has no dependencies at all — no Pillow, no canvas, nothing to install. So the card is a
committed asset like the photographs, and this script is how it is produced. It needs Python 3
with Pillow, and nothing else; nothing in `npm run build`, `npm run check` or `npm test` does.

The copy and the portrait come from src/social-card.js, read through Node, so the field list
has one owner and this file never hardcodes a headline. The card is saved with a PNG text
chunk recording what it was built from, and the build's guard compares that against the data —
otherwise a headline change would leave every share of the site showing the old words, with
nothing on the page to reveal it.
"""

import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARD = ROOT / "assets" / "social-preview.png"
CACHE = ROOT / ".cache" / "social-preview-fonts"

# The four faces the card is set in, pinned by digest so a regenerated card is the same card.
# These are the same OFL fonts the page loads from Google Fonts, taken from the upstream
# repository rather than the CSS API, which serves subsets Pillow cannot parse.
FONTS = [
    (
        "Playfair[wght].ttf",
        "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
        "c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6",
    ),
    (
        "Playfair-Italic[wght].ttf",
        "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf",
        "a5e26dc5e2e77fb2803a0bf02fd4f81ee136ec8dea863ccdb0c59a263b21378b",
    ),
    (
        "Manrope[wght].ttf",
        "https://github.com/google/fonts/raw/main/ofl/manrope/Manrope%5Bwght%5D.ttf",
        "d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40",
    ),
    (
        "DMMono-Medium.ttf",
        "https://github.com/google/fonts/raw/main/ofl/dmmono/DMMono-Medium.ttf",
        "fd327daf461db87b44a87def475d251bf03b997f7c07d9680592d75dbbfaad0b",
    ),
]

# Brand tokens, taken from src/styles/01-tokens.css.
IVORY = (252, 250, 246)
INK = (58, 41, 45)
INK_SOFT = (111, 95, 97)
TAUPE = (179, 163, 155)
ROSE = (200, 108, 130)
ROSE_DEEP = (159, 78, 100)
CHAMPAGNE = (233, 215, 190)

MARGIN = 84
PANEL_W = 440
FADE_W = 90
MAX_HEADLINE = 78


def fail(message):
    sys.exit(f"\n✗ {message}\n")


def source_from_node():
    """The copy and portrait to bake, read through the module that owns them."""
    script = (
        "import { SOCIAL_CARD_SIZE, SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource } "
        "from './src/social-card.js';"
        "process.stdout.write(JSON.stringify({ size: SOCIAL_CARD_SIZE,"
        " keyword: SOCIAL_CARD_PROVENANCE_KEYWORD, source: socialCardSource() }));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail(f"could not read the card's source from src/social-card.js:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def font_path(name, url, digest):
    """The pinned font, cached between runs and verified every time it is used."""
    cached = CACHE / name
    if not cached.exists() or hashlib.sha256(cached.read_bytes()).hexdigest() != digest:
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"  fetching {name}")
        try:
            with urllib.request.urlopen(url) as response:
                body = response.read()
        except Exception as error:  # noqa: BLE001 — the message is the point
            fail(f"could not fetch {name} ({url}): {error}")
        if hashlib.sha256(body).hexdigest() != digest:
            fail(
                f"{name} does not match the pinned digest, so the card it renders would not be "
                f"the card that was reviewed.\n  expected {digest}\n  got      "
                f"{hashlib.sha256(body).hexdigest()}"
            )
        cached.write_bytes(body)
    return str(cached)


def tracked(draw, x, y, text, font, fill, tracking, anchor):
    """Letter-spaced text, as the eyebrow and the footer mark are set."""
    for char in text:
        draw.text((x, y), char, font=font, fill=fill, anchor=anchor)
        x += font.getlength(char) + tracking
    return x - tracking


def render(source, sizes):
    from PIL import Image, ImageDraw, ImageFont

    width, height = sizes
    text_right = width - PANEL_W - 48
    content_w = text_right - MARGIN

    def variable(name, size, weight):
        font = ImageFont.truetype(font_path(*name), size)
        font.set_variation_by_axes([weight])
        return font

    playfair = next(f for f in FONTS if f[0] == "Playfair[wght].ttf")
    playfair_italic = next(f for f in FONTS if f[0] == "Playfair-Italic[wght].ttf")
    manrope = next(f for f in FONTS if f[0] == "Manrope[wght].ttf")
    mono = next(f for f in FONTS if f[0] == "DMMono-Medium.ttf")

    headline = lambda size: variable(playfair, size, 700)  # noqa: E731
    accent = lambda size: variable(playfair_italic, size, 700)  # noqa: E731
    body = variable(manrope, 21, 400)
    mono_big = ImageFont.truetype(font_path(*mono), 19)
    mono_small = ImageFont.truetype(font_path(*mono), 17)

    card = Image.new("RGB", (width, height), IVORY)

    # The portrait panel, cropped to the panel rather than squashed into it, with its left
    # edge fading into the page so the two halves read as one composition.
    portrait = Image.open(ROOT / source["portrait"]).convert("RGB")
    scale = max(PANEL_W / portrait.width, height / portrait.height)
    portrait = portrait.resize(
        (round(portrait.width * scale), round(portrait.height * scale)), Image.LANCZOS
    )
    left = (portrait.width - PANEL_W) // 2
    top = (portrait.height - height) // 2
    card.paste(portrait.crop((left, top, left + PANEL_W, top + height)), (width - PANEL_W, 0))
    ramp = Image.new("L", (FADE_W, 1))
    ramp.putdata([round(255 * (1 - x / (FADE_W - 1)) ** 1.5) for x in range(FADE_W)])
    card.paste(Image.new("RGB", (FADE_W, height), IVORY), (width - PANEL_W, 0), ramp.resize((FADE_W, height)))

    d = ImageDraw.Draw(card)
    notes = []

    # Eyebrow: a ring, then the business name, on one line.
    eyebrow_y = 130
    ring = 11
    d.ellipse(
        [MARGIN, eyebrow_y - ring // 2, MARGIN + ring, eyebrow_y + ring // 2],
        outline=ROSE_DEEP,
        width=2,
        fill=CHAMPAGNE,
    )
    tip = tracked(d, MARGIN + ring + 14, eyebrow_y, source["name"].upper(), mono_big, ROSE_DEEP, 2.6, "lm")
    if tip > text_right:
        fail(f'the business name does not fit the card: "{source["name"].upper()}" runs to {tip:.0f}px of {text_right}')

    # Headline, shrunk until both lines fit rather than clipped.
    size = MAX_HEADLINE
    while size > 40:
        if max(headline(size).getlength(source["lead"]), accent(size).getlength(source["accent"])) <= content_w:
            break
        size -= 1
    else:
        fail(f'the hero headline does not fit the card at any size: "{source["lead"]}"')
    line_h = round(size * 1.30)
    base = 258
    d.text((MARGIN, base), source["lead"], font=headline(size), fill=INK, anchor="ls")
    d.text((MARGIN, base + line_h), source["accent"], font=accent(size), fill=ROSE, anchor="ls")
    notes.append(f"headline {size}px Playfair Display 700")

    # Rule, clear of the headline's descenders.
    rule_y = base + line_h + 58
    d.line([MARGIN, rule_y, text_right, rule_y], fill=CHAMPAGNE, width=2)

    # Tagline, split at its own sentence boundaries.
    sentences = [s.strip() + "." for s in source["tagline"].split(". ") if s.strip()]
    for index, line in enumerate(sentences[:2]):
        if body.getlength(line) > content_w:
            fail(f'the tagline does not fit the card: "{line}" is {body.getlength(line):.0f}px of {content_w}')
        d.text((MARGIN, rule_y + 40 + index * 31), line, font=body, fill=INK_SOFT, anchor="ls")

    tracked(d, MARGIN, 568, source["est"].upper(), mono_small, TAUPE, 2.2, "ls")

    return card, notes


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        fail(
            "this tool needs Pillow, which nothing else in the project uses.\n"
            "  python3 -m pip install pillow"
        )
    from PIL import PngImagePlugin

    config = source_from_node()
    source = config["source"]
    width, height = config["size"]
    card, notes = render(source, (width, height))

    # The card carries what it was built from, so the build can tell whether it is still true.
    provenance = json.dumps(
        {"format": 1, "size": [width, height], "source": source},
        ensure_ascii=False,
        sort_keys=True,
    )
    info = PngImagePlugin.PngInfo()
    info.add_itxt(config["keyword"], provenance, zip=False)

    CARD.parent.mkdir(parents=True, exist_ok=True)
    card.save(CARD, optimize=True, pnginfo=info)

    print(f"  wrote {CARD.relative_to(ROOT)}  {width}x{height}  {CARD.stat().st_size // 1024} KB")
    for note in notes:
        print(f"  {note}")
    print(f'  baked "{source["lead"]} {source["accent"]}" over {source["portrait"]}')
    print(f'  tagline "{source["tagline"]}"')
    print("  provenance recorded in the image; npm run check fails if the copy moves on")


if __name__ == "__main__":
    main()
