#!/usr/bin/env python3
"""
Draw the before/after pairs the work section compares, from nothing.

    npm run illustrations

Why these are drawn rather than photographed. The work section shows two rooms twice — the state a
cleaner walks into, and the state they leave behind — for the rooms this business has no photograph
of yet. A borrowed one is not the alternative: the rule at the top of src/data.js is that every
image on the page is one the business owns, and a rented interior under a caption like "Kitchen
reset" claims a job nobody here did. Illustration is the honest third option, and for this section
it is also the better one: the entry is about the work this business can do, so a drawn pair shows
the standard without standing in for a particular customer's house. The page says so — the word on
every caption, the line under the grid, and every alt text — so a visitor reads a demonstration and
never a claim.

Why a tool rather than images committed from somewhere else. The pipeline in src/photos.js treats
photos/ as masters it can regenerate anything from, and a master nobody can regenerate is a file
nobody can change. This script is the whole drawing: a scene is one function, its two states are
one palette apart, and the geometry between the pair is not a coincidence two files share — it is
the same code run twice. That is the property that makes a before/after legible at all. A
hand-edited pair drifts by a wall, and the eye reads the drift, not the cleaning.

The two states are related the way a real pair is:

  * The room itself is identical — same window, same sofa, same worktop — because it is drawn once.
  * The "before" state adds what a clean removes: clutter, dishes, a pile of clothes, boxes, and
    grime, as its own low-alpha layers.
  * The whole "before" frame is then graded down (duller, dimmer, flatter) in one step at the end
    of the pair, so the difference in mood cannot come out half-applied to one prop.

Nothing here is random: the scatter is drawn from a generator seeded per scene, so a rerun
produces byte-identical files and `npm run illustrations` is safe to run to see what changed.

Only the PNG masters are written here — photos/work/, which is not deployed. The WebP the page
serves comes from `npm run photos`, exactly as it does for a photograph.
"""

import io
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MASTER_DIRECTORY = "photos/work"

# The master's size, and the supersample it is drawn at before it is reduced to that. Every
# coordinate below is in the finished 960x720 space, so a scene reads as the file does; the scale
# is applied once, by the canvas, and the LANCZOS reduction at the end is what keeps the curves in
# a leaf and the edge of a worktop from showing the staircase a one-pass draw leaves behind.
WIDTH, HEIGHT = 960, 720
SCALE = 3

FLOOR_Y = 470


def fail(message):
    sys.exit(f"\n✗ {message}\n")


def rgb(value):
    """`#rrggbb` or an (r, g, b[, a]) tuple, as a tuple. One reader for both."""
    if isinstance(value, tuple):
        return value
    text = value.lstrip("#")
    return tuple(int(text[at:at + 2], 16) for at in (0, 2, 4))


def dull(value, keep=0.70, toward="#b8b1aa", mix=0.14):
    """
    A colour as it looks once a room has been left for a while: less saturated, and pulled a
    little toward dust. Deriving the "before" palette from the "after" one — rather than writing
    both out — is what keeps the pair one palette apart instead of two palettes apart, which is
    the difference between "this room is dirty" and "this is a different room".
    """
    r, g, b = rgb(value)[:3]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    held = [channel + (luma - channel) * (1 - keep) for channel in (r, g, b)]
    dusty = rgb(toward)[:3]
    mixed = [channel + (dust - channel) * mix for channel, dust in zip(held, dusty)]
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(channel))) for channel in mixed)


# What the room is made of, in the state a cleaner leaves it. The "before" palette is this one,
# dulled — with the two exceptions noted, where the change is not a matter of grime.
AFTER = {
    "wall": ("#faf6f0", "#eee5d9"),
    "floor": ("#e7d0b3", "#d2b593"),
    "skirt": "#fdfbf7",
    "glass": ("#fefaf1", "#f4e6d2"),
    "frame": "#fffdfa",
    "sofa": "#d8b3a4",
    "sofa_light": "#ecd3c7",
    "sofa_shade": "#bf9587",
    "cushion": "#c05f78",
    "cushion_soft": "#e3ccae",
    "wood": "#a87a4e",
    "wood_dark": "#7f5a34",
    "rug": "#f1e3d4",
    "rug_edge": "#d9c3ac",
    "plant": "#7c9360",
    "pot": "#bb7a5c",
    "metal": "#d3d8da",
    "metal_dark": "#a3abad",
    "tile": "#f5eee4",
    "grout": "#ded3c5",
    "cabinet": "#e7d6c5",
    "cabinet_dark": "#d3bfaa",
    "counter": "#f4ebe0",
    "counter_edge": "#d8c8b6",
    "linen": "#fdfaf4",
    "duvet": "#f8f1e7",
    "espresso": "#3a292d",
    "dark": "#2c1d20",
    "accent": "#9f4e64",
    "champagne": "#e9d7be",
    "panel": "#3d2b2f",
    "desk": "#4a3540",
}

# The two colours that are not the same object in both states: a window left with the light off,
# and its glass seen at dusk rather than in the morning. Dulling the "after" values would have
# them come out warm and dim; these say what the state is.
BEFORE_OVERRIDES = {
    "glass": ("#d5d8d8", "#c6ccce"),
    "plant": "#7c8a6d",
}


def palette(state):
    """The room's colours in one state: the "after" palette, or every entry of it dulled."""
    if state == "after":
        return dict(AFTER)
    values = {
        name: tuple(dull(part) for part in value) if isinstance(value, tuple) else dull(value)
        for name, value in AFTER.items()
    }
    values.update(BEFORE_OVERRIDES)
    return values


# What a room collects. These are added only to the "before" frame, on layers of their own.
GRIME = (96, 82, 74, 26)
GRIME_DARK = (84, 70, 62, 40)
CARDBOARD = "#c6ab86"
CARDBOARD_EDGE = "#b1946f"
PAPER = "#f3ece1"
FABRIC = ("#cbb9ad", "#bdae9f", "#a8928b")


class Canvas:
    """A drawing surface addressed in finished-image coordinates, drawn at SCALE."""

    def __init__(self):
        self.image = Image.new("RGBA", (WIDTH * SCALE, HEIGHT * SCALE), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.image, "RGBA")

    def px(self, value):
        return int(round(value * SCALE))

    def point(self, x, y):
        return (self.px(x), self.px(y))

    def box(self, values):
        return [self.px(value) for value in values]

    def rect(self, box, fill):
        self.draw.rectangle(self.box(box), fill=rgb(fill) if not isinstance(fill, tuple) else fill)

    def rrect(self, box, radius, fill):
        self.draw.rounded_rectangle(
            self.box(box), radius=self.px(radius),
            fill=rgb(fill) if not isinstance(fill, tuple) else fill)

    def ellipse(self, box, fill):
        self.draw.ellipse(self.box(box), fill=rgb(fill) if not isinstance(fill, tuple) else fill)

    def poly(self, points, fill):
        self.draw.polygon([self.point(x, y) for x, y in points],
                          fill=rgb(fill) if not isinstance(fill, tuple) else fill)

    def line(self, points, fill, width=1):
        self.draw.line([self.point(x, y) for x, y in points],
                       fill=rgb(fill) if not isinstance(fill, tuple) else fill,
                       width=max(1, self.px(width)), joint="curve")

    def gradient(self, box, top, bottom):
        """A vertical linear gradient, painted into the box."""
        x0, y0, x1, y1 = self.box(box)
        width, height = max(1, x1 - x0), max(1, y1 - y0)
        start, end = rgb(top), rgb(bottom)
        strip = Image.new("RGB", (1, height))
        pen = ImageDraw.Draw(strip)
        for y in range(height):
            at = y / (height - 1) if height > 1 else 0
            pen.point((0, y), fill=tuple(round(a + (b - a) * at) for a, b in zip(start, end)))
        self.image.paste(strip.resize((width, height), Image.BILINEAR), (x0, y0))

    def layer(self):
        return Image.new("RGBA", self.image.size, (0, 0, 0, 0))

    def lay(self, layer, blur=0):
        """Composite a layer, optionally softened — which is what turns a hard shape into light."""
        if blur:
            layer = layer.filter(ImageFilter.GaussianBlur(self.px(blur)))
        self.image.alpha_composite(layer)

    def sprite(self, image, centre, angle=0):
        """Paste a small RGBA sprite rotated about its centre — a leaf, mostly."""
        turned = image.rotate(angle, resample=Image.BICUBIC, expand=True)
        self.image.alpha_composite(turned, (int(centre[0] * SCALE - turned.width / 2),
                                            int(centre[1] * SCALE - turned.height / 2)))

    def shade(self, box, alpha=34, blur=16, spread=8):
        """A soft ground shadow, so furniture sits on the floor rather than in front of it."""
        layer = self.layer()
        ImageDraw.Draw(layer, "RGBA").ellipse(
            self.box([box[0] - spread, box[1] - spread, box[2] + spread, box[3] + spread]),
            fill=(58, 41, 45, alpha))
        self.lay(layer, blur=blur)


def leaf(length, width, colour):
    """A pointed leaf sprite, long axis horizontal, drawn as a lens."""
    long_side = int(length * SCALE)
    short_side = max(2, int(width * SCALE))
    sprite = Image.new("RGBA", (long_side, short_side), (0, 0, 0, 0))
    pen = ImageDraw.Draw(sprite, "RGBA")
    upper = [(x, short_side / 2 - (short_side / 2) * math.sin(math.pi * x / max(1, long_side - 1)))
             for x in range(long_side)]
    lower = [(x, short_side / 2 + (short_side / 2) * math.sin(math.pi * x / max(1, long_side - 1)))
             for x in range(long_side)]
    pen.polygon(upper + lower[::-1], fill=rgb(colour))
    return sprite


def potted_plant(canvas, p, at, size, state, seed):
    """A plant in the corner: a pot, and leaves on stems. The "before" one is thinner and droops."""
    x, y = at
    scale = size / 260
    pot_w, pot_h = 108 * scale, 92 * scale
    canvas.shade([x - pot_w / 2, y - 14, x + pot_w / 2, y + 12], alpha=30, blur=12, spread=6)
    canvas.poly([(x - pot_w / 2, y - pot_h), (x + pot_w / 2, y - pot_h),
                 (x + pot_w / 2 - 9 * scale, y), (x - pot_w / 2 + 9 * scale, y)], p["pot"])
    canvas.rrect([x - pot_w / 2 - 4, y - pot_h - 12 * scale, x + pot_w / 2 + 4, y - pot_h + 6 * scale],
                 4 * scale, p["pot"])
    canvas.rrect([x - pot_w / 2 - 4, y - pot_h - 12 * scale, x + pot_w / 2 + 4, y - pot_h - 4 * scale],
                 3 * scale, dull(p["pot"], keep=0.8))

    scatter = random.Random(seed)
    leaves = 11 if state == "after" else 6
    for index in range(leaves):
        spread = (-1 if index % 2 else 1) * scatter.uniform(0.25, 1.0)
        droop = 0 if state == "after" else scatter.uniform(26, 58)
        angle = -90 + spread * 62 + droop
        length = scatter.uniform(74, 128) * scale * (1 if state == "after" else 0.78)
        rise = scatter.uniform(60, 150) * scale
        stem_x = x + spread * 18 * scale
        stem_y = y - pot_h - rise
        colour = p["plant"] if index % 3 else dull(p["plant"], keep=0.82, mix=0.06)
        canvas.line([(stem_x, y - pot_h - 6), (stem_x, stem_y)], colour, width=max(1, 3 * scale))
        canvas.sprite(leaf(length, 26 * scale * (1 if state == "after" else 0.8), colour),
                      (stem_x + math.cos(math.radians(angle)) * length / 2,
                       stem_y + math.sin(math.radians(angle)) * length / 2), angle)


def clutter_scatter(canvas, seed, boxes):
    """Small things left where they fell, inside the given boxes."""
    scatter = random.Random(seed)
    for box in boxes:
        for _ in range(scatter.randint(3, 6)):
            x = scatter.uniform(box[0], box[2])
            y = scatter.uniform(box[1], box[3])
            kind = scatter.random()
            if kind < 0.45:
                canvas.rrect([x - 16, y - 4, x + 16, y + 6], 2, PAPER)
                canvas.rrect([x - 12, y - 9, x + 10, y + 1], 2, dull(PAPER, keep=0.9, mix=0.08))
            elif kind < 0.75:
                canvas.ellipse([x - 13, y - 8, x + 13, y + 8], scatter.choice(FABRIC))
            else:
                canvas.rrect([x - 9, y - 12, x + 9, y + 12], 3, scatter.choice(FABRIC))
                canvas.rrect([x - 7, y - 10, x + 7, y - 2], 2, dull(scatter.choice(FABRIC), keep=0.85))


def grime_wall(canvas, p, seed, y_range=(120, FLOOR_Y - 20)):
    """Dust and marks on the wall: low-alpha, blurred, so it reads as a state not a drawing."""
    scatter = random.Random(seed)
    layer = canvas.layer()
    pen = ImageDraw.Draw(layer, "RGBA")
    for _ in range(16):
        x = scatter.uniform(30, WIDTH - 30)
        y = scatter.uniform(*y_range)
        if scatter.random() < 0.5:
            height = scatter.uniform(30, 130)
            pen.line([canvas.point(x, y), canvas.point(x + scatter.uniform(-10, 10), y + height)],
                     fill=GRIME, width=canvas.px(scatter.uniform(4, 14)))
        else:
            radius = scatter.uniform(16, 46)
            pen.ellipse(canvas.box([x - radius, y - radius * 0.6, x + radius, y + radius * 0.6]),
                        fill=GRIME)
    canvas.lay(layer, blur=9)


def grime_floor(canvas, seed, spots):
    """Scuffs and spills on the floor."""
    scatter = random.Random(seed)
    layer = canvas.layer()
    pen = ImageDraw.Draw(layer, "RGBA")
    for x, y, radius in spots:
        pen.ellipse(canvas.box([x - radius, y - radius * 0.42, x + radius, y + radius * 0.42]),
                    fill=GRIME_DARK if scatter.random() < 0.4 else GRIME)
    for _ in range(10):
        x = scatter.uniform(60, WIDTH - 60)
        y = scatter.uniform(FLOOR_Y + 30, HEIGHT - 30)
        pen.line([canvas.point(x, y), canvas.point(x + scatter.uniform(30, 90), y + scatter.uniform(-6, 6))],
                 fill=GRIME, width=canvas.px(scatter.uniform(2, 6)))
    canvas.lay(layer, blur=7)


def room(canvas, p, state, seed):
    """The wall, floor and skirting every interior here shares."""
    canvas.gradient([0, 0, WIDTH, FLOOR_Y], *p["wall"])
    canvas.gradient([0, FLOOR_Y, WIDTH, HEIGHT], *p["floor"])
    canvas.rect([0, FLOOR_Y - 12, WIDTH, FLOOR_Y], p["skirt"])
    canvas.line([(0, FLOOR_Y), (WIDTH, FLOOR_Y)], dull(p["skirt"], keep=0.7, mix=0.2), 1)
    if state == "before":
        grime_wall(canvas, p, seed)


def window(canvas, p, box, state, mullions=True):
    """A window, and the light it puts into the room."""
    x0, y0, x1, y1 = box
    canvas.rect([x0 - 12, y0 - 12, x1 + 12, y1 + 12], p["frame"])
    canvas.gradient([x0, y0, x1, y1], *p["glass"])
    if mullions:
        mid_x, mid_y = (x0 + x1) / 2, (y0 + y1) / 2
        canvas.rect([mid_x - 6, y0, mid_x + 6, y1], p["frame"])
        canvas.rect([x0, mid_y - 6, x1, mid_y + 6], p["frame"])
    canvas.rect([x0 - 16, y1 + 12, x1 + 16, y1 + 22], p["frame"])
    if state == "after":
        # The light itself: a wash from the glass, and the patch it throws on the floor. Two
        # layers, because the patch is a shape and the wash is just brightness.
        wash = canvas.layer()
        ImageDraw.Draw(wash, "RGBA").polygon(
            [canvas.point(x0 - 10, y0 - 10), canvas.point(x1 + 10, y0 - 10),
             canvas.point(x1 + 90, y1 + 30), canvas.point(x0 - 70, y1 + 30)],
            fill=(255, 247, 228, 34))
        canvas.lay(wash, blur=22)
        patch = canvas.layer()
        ImageDraw.Draw(patch, "RGBA").polygon(
            [canvas.point(x0 + 20, FLOOR_Y + 4), canvas.point(x1 - 20, FLOOR_Y + 4),
             canvas.point(x1 + 150, HEIGHT), canvas.point(x0 + 96, HEIGHT)],
            fill=(255, 248, 232, 62))
        canvas.lay(patch, blur=18)


# --- the rooms -------------------------------------------------------------

def bedroom(canvas, p, state, seed):
    """Bedroom detail: a bed, a nightstand, and the light through the window."""
    room(canvas, p, state, seed)
    window(canvas, p, [58, 132, 214, 396], state)

    canvas.rect([520, 150, 700, 236], p["frame"])
    canvas.rect([534, 164, 686, 222], dull(p["linen"], keep=0.95))
    canvas.ellipse([572, 176, 626, 210], p["champagne"])

    # Headboard, bed, then the linen on top of it.
    canvas.rrect([276, 268, 732, 386], 12, dull(p["linen"], keep=0.92))
    for x in range(320, 700, 68):
        canvas.line([(x, 288), (x, 372)], dull(p["champagne"], keep=0.95), 2)

    canvas.shade([262, 512, 748, 566], alpha=38, blur=20, spread=8)
    canvas.rrect([268, 380, 740, 548], 10, dull(p["wood"], keep=0.95))
    canvas.rrect([266, 366, 742, 520], 10, p["linen"])
    canvas.rrect([266, 452, 742, 524], 10, p["duvet"])

    if state == "after":
        canvas.rrect([292, 320, 428, 380], 14, p["linen"])
        canvas.rrect([452, 320, 588, 380], 14, p["linen"])
        canvas.ellipse([318, 336, 402, 372], dull(p["linen"], keep=0.94))
        canvas.ellipse([478, 336, 562, 372], dull(p["linen"], keep=0.94))
        canvas.rrect([266, 452, 742, 486], 8, p["champagne"])
        canvas.line([(266, 486), (742, 486)], dull(p["champagne"], keep=0.88), 2)
        canvas.rrect([276, 494, 420, 522], 6, dull(p["champagne"], keep=0.95))
    else:
        canvas.rrect([300, 340, 440, 396], 14, p["linen"])
        canvas.poly([(452, 396), (500, 344), (556, 392), (588, 356), (588, 402), (452, 402)],
                    dull(p["linen"], keep=0.9))
        canvas.poly([(286, 452), (400, 440), (520, 470), (640, 444), (742, 462), (742, 524), (266, 524), (266, 470)],
                    p["duvet"])
        canvas.rrect([300, 470, 470, 512], 8, dull(p["champagne"], keep=0.9))
        canvas.poly([(286, 512), (420, 500), (560, 520), (700, 504), (742, 516), (742, 548), (266, 548)],
                    dull(p["duvet"], keep=0.92))
        canvas.ellipse([600, 552, 700, 590], dull(p["linen"], keep=0.85))

    # Nightstand and lamp.
    canvas.shade([742, 486, 866, 546], alpha=28, blur=14, spread=6)
    canvas.rrect([744, 436, 864, 556], 6, p["wood"])
    canvas.line([(744, 486), (864, 486)], p["wood_dark"], 2)
    canvas.rrect([776, 494, 832, 506], 4, p["champagne"])
    canvas.rrect([770, 400, 838, 436], 8, dull(p["linen"], keep=0.96))
    if state == "after":
        canvas.rrect([776, 400, 834, 436], 8, dull(p["linen"], keep=0.96))
        canvas.rrect([770, 396, 840, 406], 5, p["champagne"])
        canvas.poly([(786, 344), (824, 344), (840, 398), (770, 398)], p["champagne"])
        canvas.rrect([800, 396, 810, 440], 4, dull(p["metal_dark"], keep=0.98))
        canvas.ellipse([784, 430, 826, 446], dull(p["espresso"], keep=0.98))
        canvas.ellipse([766, 352, 844, 408], (255, 244, 218, 70))
        canvas.rrect([774, 372, 802, 380], 2, p["cushion"])
    else:
        canvas.rrect([776, 400, 834, 436], 8, dull(p["linen"], keep=0.9))
        canvas.rrect([770, 396, 840, 406], 5, dull(p["champagne"], keep=0.86))
        canvas.poly([(786, 344), (824, 344), (840, 398), (770, 398)], dull(p["champagne"], keep=0.82))
        canvas.rrect([800, 396, 810, 440], 4, dull(p["metal_dark"], keep=0.8))
        canvas.ellipse([784, 430, 826, 446], dull(p["espresso"], keep=0.85))
        canvas.ellipse([776, 398, 812, 428], dull(p["metal"], keep=0.85))
        canvas.rrect([820, 408, 856, 420], 2, PAPER)
        clutter_scatter(canvas, seed + 4, [[300, 580, 720, 650], [744, 440, 862, 480]])

    if state == "before":
        clutter_scatter(canvas, seed + 8, [[220, 566, 520, 646]])
        canvas.ellipse([236, 596, 300, 626], FABRIC[1])
        canvas.ellipse([300, 606, 372, 640], dull(FABRIC[0], keep=0.9))
        grime_floor(canvas, seed + 21, [(600, 620, 70), (380, 590, 42)])


def office(canvas, p, state, seed):
    """Commercial: a reception desk, a chair, the brand bars on the wall."""
    room(canvas, p, state, seed)

    # The mark on the wall, in the site's own colours — the one decorative thing here.
    canvas.shade([96, 226, 288, 240], alpha=16, blur=10, spread=6)
    bars = (("#c86c82", 104), ("#e9d7be", 124), ("#3a292d", 144))
    for colour, x in bars:
        canvas.rrect([x, 148, x + 12, 226], 3, colour)
    for index, width in enumerate((150, 112, 78)):
        canvas.rrect([104, 262 + index * 14, 104 + width, 268 + index * 14], 3,
                     dull(p["espresso"], keep=0.95) if state == "after" else dull(p["espresso"], keep=0.7))

    window(canvas, p, [620, 128, 900, 300], state, mullions=False)

    # Reception seating, left, and the desk in front of the wall.
    canvas.shade([56, 520, 316, 560], alpha=30, blur=16, spread=6)
    for x in (68, 188):
        canvas.rrect([x, 382, x + 104, 500], 14, p["sofa"])
        canvas.rrect([x - 6, 442, x + 18, 512], 10, p["sofa_light"])
        canvas.rrect([x + 86, 442, x + 110, 512], 10, p["sofa_light"])
        canvas.rrect([x + 14, 452, x + 90, 498], 8, p["sofa_light"])
        canvas.rect([x + 24, 512, x + 38, 548], p["espresso"])
        canvas.rect([x + 66, 512, x + 80, 548], p["espresso"])
        canvas.rrect([x + 20, 404, x + 84, 448], 8, dull(p["sofa_light"], keep=0.98))

    canvas.shade([352, 520, 792, 570], alpha=40, blur=20, spread=10)
    canvas.rect([352, 328, 792, 352], dull(p["counter"], keep=0.97))
    canvas.gradient([360, 352, 784, 552], p["desk"], p["panel"])
    canvas.line([(360, 372), (784, 372)], p["accent"], 2)
    for x in range(392, 784, 96):
        canvas.line([(x, 380), (x, 548)], dull(p["panel"], keep=0.9), 1)

    # Monitor, chair, and the things a reception keeps on the counter.
    canvas.rrect([470, 250, 620, 330], 6, dull(p["espresso"], keep=0.95))
    canvas.rrect([480, 258, 610, 322], 4, p["desk"] if state == "after" else dull(p["desk"], keep=0.8))
    canvas.rrect([494, 272, 566, 280], 3, p["accent"])
    canvas.rrect([510, 288, 596, 296], 3, dull(p["champagne"], keep=0.9))
    canvas.rect([532, 330, 556, 344], p["espresso"])
    canvas.rrect([500, 344, 590, 352], 4, p["espresso"])

    canvas.shade([636, 500, 780, 556], alpha=26, blur=14, spread=6)
    canvas.rrect([652, 396, 764, 448], 10, p["panel"] if state == "after" else dull(p["panel"], keep=0.85))
    canvas.rrect([640, 442, 776, 474], 10, dull(p["counter"], keep=0.95))
    canvas.rect([700, 474, 716, 528], dull(p["espresso"], keep=0.95))
    canvas.rrect([660, 528, 756, 540], 6, dull(p["espresso"], keep=0.9))

    if state == "after":
        canvas.ellipse([392, 296, 430, 328], p["cushion"])
        canvas.rrect([392, 286, 430, 300], 3, dull(p["cushion"], keep=0.75))
        canvas.rrect([700, 300, 748, 326], 3, p["frame"])
        canvas.line([(724, 300), (724, 282)], p["plant"], 3)
    else:
        canvas.ellipse([376, 292, 424, 330], dull(p["metal"], keep=0.85))
        canvas.rrect([440, 300, 520, 312], 3, PAPER)
        canvas.rrect([560, 296, 640, 310], 3, dull(PAPER, keep=0.92, mix=0.1))
        canvas.rrect([664, 288, 726, 324], 4, dull(p["champagne"], keep=0.8))
        canvas.line([(700, 528), (660, 556), (760, 560)], dull(p["espresso"], keep=0.8), 2)
        clutter_scatter(canvas, seed + 6, [[340, 580, 800, 648], [64, 556, 330, 620]])
        canvas.rrect([352, 570, 484, 640], 3, CARDBOARD)
        canvas.rrect([368, 534, 468, 572], 3, dull(CARDBOARD, keep=0.88))
        canvas.line([(352, 574), (484, 574)], CARDBOARD_EDGE, 2)

    potted_plant(canvas, p, (876, 552), 240, state, seed + 2)

    if state == "before":
        grime_floor(canvas, seed + 19, [(500, 636, 96), (250, 600, 54)])
        layer = canvas.layer()
        pen = ImageDraw.Draw(layer, "RGBA")
        for _ in range(10):
            x = random.Random(seed + 30 + _).uniform(370, 780)
            y = random.Random(seed + 40 + _).uniform(360, 540)
            pen.line([canvas.point(x, y), canvas.point(x + random.Random(_ + 3).uniform(20, 70), y)],
                     fill=GRIME, width=canvas.px(3))
        canvas.lay(layer, blur=5)


def vignette(canvas, alpha=26):
    """
    A soft edge darkening, so the drawn frame reads as a picture rather than a diagram. Kept
    gentle on purpose: the first version of this was a 40px blur at twice this alpha, and it put a
    grey fog over every room — the one thing that made a tidy kitchen look like a photograph taken
    through a dirty lens.
    """
    layer = canvas.layer()
    pen = ImageDraw.Draw(layer, "RGBA")
    for step in range(6):
        inset = 26 * (step + 1)
        pen.rectangle([canvas.px(inset), canvas.px(inset * 0.6),
                       canvas.image.width - canvas.px(inset),
                       canvas.image.height - canvas.px(inset * 0.6)],
                      outline=(58, 41, 45, alpha), width=canvas.px(26))
    canvas.image.alpha_composite(layer.filter(ImageFilter.GaussianBlur(canvas.px(30))))


def grade_before(image):
    """
    The last step of the pair, applied to the whole frame: the room as it looks before anyone has
    been in. Duller, a touch dimmer, a touch flatter — one pass, so no prop can come out
    half-graded, and no stronger than this, because a "before" that is too dim stops being a room
    somebody left and starts being a photograph taken at night.
    """
    graded = ImageEnhance.Color(image.convert("RGB")).enhance(0.76)
    graded = ImageEnhance.Brightness(graded).enhance(0.95)
    graded = ImageEnhance.Contrast(graded).enhance(0.97)
    return graded.convert("RGBA")


SCENES = {
    "bedroom": bedroom,
    "office": office,
}

# A fixed seed per scene, because the scatter is drawn from a generator: `hash()` of a string is
# salted per process, so seeding from the scene's name would redraw every speck of clutter — and
# rewrite every master — on each run. These numbers only have to be stable.
SEEDS = {"bedroom": 2020, "office": 2021}


def draw(scene_name, state):
    canvas = Canvas()
    p = palette(state)
    SCENES[scene_name](canvas, p, state, seed=SEEDS[scene_name])
    vignette(canvas, alpha=20 if state == "after" else 30)
    if state == "before":
        canvas.image = grade_before(canvas.image)
    return canvas.image.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def write_if_changed(path, image):
    """Rewriting an identical file would churn git on every run for no reason."""
    target = ROOT / path
    held = io.BytesIO()
    image.save(held, "PNG", optimize=True)
    body = held.getvalue()
    if target.exists() and target.read_bytes() == body:
        return False, target.stat().st_size
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return True, len(body)


def main():
    print(f"\nillustrations  {len(SCENES)} rooms, before and after, {WIDTH}x{HEIGHT} PNG masters\n")
    written = 0
    for name in SCENES:
        print(f"  {name}")
        for state in ("before", "after"):
            path = f"{MASTER_DIRECTORY}/{name}-{state}.png"
            changed, size = write_if_changed(path, draw(name, state))
            written += 1 if changed else 0
            print(f"    {state:<7} {path:<44} {size // 1024:>4} KB"
                  f"{'' if changed else '   (unchanged)'}")
    print(f"\n✓ {written} file(s) written — run `npm run photos` to publish them\n")


if __name__ == "__main__":
    main()
