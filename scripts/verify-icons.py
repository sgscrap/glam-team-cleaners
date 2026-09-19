#!/usr/bin/env python3
"""
Render the published icons in a real browser and compare the pixels with the mark.

    npm run icons:verify

Nothing here is in the build, the hook or `npm test`: this needs a browser, and the gate is
deliberately dependency-free so it can run on a fresh clone with nothing installed. It needs
Python 3 with Playwright and Pillow
(`python3 -m pip install playwright pillow && python3 -m playwright install chromium`).

What layer this is. Every existing icon guard reads bytes. `assertIconsMatchBrandMark` reads the
stylesheet, `assertVectorIconMatchesTheMark` reads the SVG's markup, `assertIconsMatchIntendedGeometry`
decodes the raster containers with this project's own readers, and the drift check holds each file to
what src/ generates — which is the same as holding it to the encoders. All of those can be satisfied
while a browser paints something else, because none of them is a browser:

  * the SVG root's `viewBox` is read by no guard, and it is what maps the mark's 64-unit canvas onto
    pixels — change it and the mark renders at the wrong scale, clipped by the canvas.
  * the dark-scheme rule is checked as *text*: a selector nothing matches, or a rule the browser
    discards, is invisible to a regex that only has to find it.
  * the rasters are decoded by readers written against the encoder that wrote them. A browser
    decodes the same bytes to its own rules, and a container one of them accepts and the other does
    not is the disagreement no single implementation can notice.
  * an `.ico` is a table of frames, and which frame a browser draws — or whether it rescales the
    largest one instead — is its decision, not ours.

So every published file is rendered by Chromium, and the reference is painted *by the same browser*
from the numbers in src/favicon.js: a canvas path per shape, `roundRect` with the mark's top and
base radii. The browser's own rasteriser, driven by the same description — not this project's
sampler, and not the SVG path builder being checked.

Two comparisons, and the output says which one applied:

  * **exact** — every interior pixel must be the shape's colour and every pixel the mark leaves
    clear must be transparent. Applied when the browser is drawing the file at the file's own size,
    or when the file is vector and has no size to be drawn at. Pixels on a boundary are skipped
    (see below), and the count of skipped pixels is printed so the coverage is visible.
  * **coarse** — always. Both images are pooled to a small grid of mean RGBA and compared, which is
    robust to resampling and antialiasing and still cannot miss a mark painted at the wrong scale,
    in the wrong place, or in the wrong colour. This is what carries the `.ico` at 16 and 32px,
    where Chromium reports the file as 48x48 and scales it rather than picking the frame a tab
    would; a per-pixel test there would be measuring the browser's scaler, not the icon.

A pixel counts as interior only if it and all eight of its neighbours are the same opaque colour,
and as clear only if it and all eight are transparent. One neighbour of slack on every side is what
keeps antialiasing out of a comparison about what the file contains: a blended pixel never has nine
identical neighbours.
"""

import base64
import io
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fail(message):
    sys.exit(f"\n✗ {message}\n")


try:
    from PIL import Image
    from playwright.sync_api import sync_playwright
except ImportError as missing:
    fail(f"this check needs {missing.name or 'a browser library'}:\n"
         "  python3 -m pip install playwright pillow && python3 -m playwright install chromium")

# The sizes a tab, a bookmarks bar, a desktop shortcut and a home screen ask for, and the size the
# vector icon is inspected at. Spelled here rather than read from the encoder, the same way the
# build's own icon guard spells them: a requirement read from the thing it constrains agrees with it
# in the very commit that changes it.
ICO_SIZES = [16, 32, 48]
VECTOR_SIZES = [16, 32, 48]
VECTOR_DETAIL = 256
TOUCH_SIZE = 180

# Colour and coverage are allowed different amounts, because they fail differently. Colour is a
# fact about the file: an interior pixel must be the shape's colour, and four units is tighter than
# the gap between any two colours in the mark (the nearest pair are 20 apart, so a bar painted the
# wrong one cannot slip through). Coverage is a fact about the browser: the reference is a canvas
# `roundRect` and the vector icon is an SVG arc, two rasterisers that disagree by 5 in alpha where
# a corner meets a straight edge — measured on assets/favicon.svg at 256px, the only place in the
# set where any interior pixel differs at all.
TOLERANCE_COLOUR = 4
TOLERANCE_ALPHA = 8

# What a faithful rendering is allowed to differ by on the coarse comparison. Measured on the files
# this project ships: 0.07 to 2.91, the 2.91 being the `.ico` Chromium scales from 48 down to 16 —
# the largest honest difference in the set. A mark painted at the wrong scale, mirrored or
# recoloured lands far outside it: the generator mutations this check was built against are in the
# pass that added it, the smallest of them four times this tolerance.
COARSE_TOLERANCE = 6.0


def grid_for(size):
    """Coarse enough that resampling cancels out, fine enough that a wrong mark cannot hide."""
    if size < 64:
        return 4
    return 8 if size < 128 else 16


def mark_from_node():
    """The mark, in the browser's own numbers, read from the module that owns it."""
    script = (
        "import { markShapes, readPalette, ICON_CANVAS, ICON_FILES } from './src/favicon.js';"
        "const palette = readPalette();"
        "const shapes = markShapes(palette);"
        "process.stdout.write(JSON.stringify({"
        "  canvas: ICON_CANVAS,"
        "  files: ICON_FILES,"
        "  light: shapes,"
        "  dark: shapes.filter(shape => shape.class !== 'ground'),"
        "  touch: markShapes(palette, { bleed: true }),"
        "}));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode != 0:
        fail(f"could not read the mark from src/favicon.js:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def data_url(path, media_type):
    body = (ROOT / path).read_bytes()
    return f"data:{media_type};base64,{base64.b64encode(body).decode()}"


RENDER_SCRIPT = r"""
async ({ case: spec, shapes, canvas, source }) => {
  const paintMark = size => {
    const element = document.createElement('canvas');
    element.width = size;
    element.height = size;
    const context = element.getContext('2d');
    const scale = size / canvas;
    for (const shape of shapes) {
      context.fillStyle = shape.fill;
      context.beginPath();
      context.roundRect(
        shape.x * scale, shape.y * scale, shape.width * scale, shape.height * scale,
        [shape.top * scale, shape.top * scale, shape.base * scale, shape.base * scale],
      );
      context.fill();
    }
    return element.toDataURL('image/png');
  };

  const image = new Image();
  image.style.width = `${spec.size}px`;
  image.style.height = `${spec.size}px`;
  document.body.append(image);
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`${spec.file} did not load as an image in this browser`));
    image.src = source;
  });
  await loaded;
  const natural = `${image.naturalWidth}x${image.naturalHeight}`;

  const drawn = document.createElement('canvas');
  drawn.width = spec.size;
  drawn.height = spec.size;
  drawn.getContext('2d').drawImage(image, 0, 0, spec.size, spec.size);
  image.remove();

  return {
    size: spec.size,
    natural,
    reference: paintMark(spec.size),
    actual: drawn.toDataURL('image/png'),
  };
}
"""


def render_in_browser(mark, cases):
    """Every reference and every published file, painted by Chromium, as PNG data URLs."""
    # The label decides the media type: a data URL needs one a browser accepts, and `image/svg` and
    # `image/ico` are not it. The file is loaded from its own bytes, so a wrong type would fail
    # before the decoder this check is about ever saw them.
    sources = {
        "svg": data_url(mark["files"]["svg"], "image/svg+xml"),
        "ico": data_url(mark["files"]["ico"], "image/x-icon"),
        "touch": data_url(mark["files"]["touch"], "image/png"),
    }

    rendered = []
    with sync_playwright() as playwright:
        # The full Chromium build rather than the packaged headless shell: it is the browser a
        # visitor runs, and the shell is stripped to the point where the parts this check is about
        # — an ICO's frame handling, and an SVG's own prefers-color-scheme — are not guaranteed to
        # behave as they do in a tab.
        browser = playwright.chromium.launch(channel="chromium")
        version = browser.version
        page = browser.new_page()
        page.set_content("<title>icon render</title>")
        for case in cases:
            page.emulate_media(color_scheme="dark" if case.get("scheme") == "dark" else "light")
            outcome = page.evaluate(RENDER_SCRIPT, {
                "case": case,
                "shapes": mark[case["shapes"]],
                "canvas": mark["canvas"],
                "source": sources[case["file"]],
            })
            outcome["case"] = case
            rendered.append(outcome)
        browser.close()
    return rendered, version


def pixels(data_url_text):
    with Image.open(io.BytesIO(base64.b64decode(data_url_text.split(",", 1)[1]))) as image:
        return image.convert("RGBA")


def compare(rendered):
    """Interiors and clear space exactly where that is meaningful, and a coarse grid always."""
    case = rendered["case"]
    size = rendered["size"]
    reference = pixels(rendered["reference"])
    actual = pixels(rendered["actual"])
    want = reference.load()
    got = actual.load()

    # A file is drawn at its own size when it is vector — no size to be wrong about — or when the
    # browser reports the size the file is. Otherwise it scaled, and only the appearance is ours to
    # grade.
    vector = case["file"] == "svg"
    native = rendered["natural"] == f"{size}x{size}"
    exact = vector or native

    interior = clear = edges = 0
    worst_colour = worst_alpha = 0
    complaints = []

    for y in range(size):
        for x in range(size):
            around = [(min(size - 1, max(0, x + dx)), min(size - 1, max(0, y + dy)))
                      for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
            here = want[x, y]
            if here[3] == 255 and all(want[px, py] == here for px, py in around):
                interior += 1
                if exact:
                    colour = max(abs(here[channel] - got[x, y][channel]) for channel in range(3))
                    alpha = abs(here[3] - got[x, y][3])
                    worst_colour = max(worst_colour, colour)
                    worst_alpha = max(worst_alpha, alpha)
                    if colour > TOLERANCE_COLOUR or alpha > TOLERANCE_ALPHA:
                        complaints.append(f"({x},{y}) is ({tuple(got[x, y][:3])}, alpha "
                                          f"{got[x, y][3]}) where the mark is ({tuple(here[:3])}, "
                                          f"alpha {here[3]})")
            elif here[3] == 0 and all(want[px, py][3] == 0 for px, py in around):
                clear += 1
                if exact:
                    worst_alpha = max(worst_alpha, got[x, y][3])
                    if got[x, y][3] > TOLERANCE_ALPHA:
                        complaints.append(f"({x},{y}) is painted ({tuple(got[x, y][:3])}, alpha "
                                          f"{got[x, y][3]}) where the mark leaves the canvas clear")
            else:
                edges += 1

    grid = (grid_for(size), grid_for(size))
    pooled_reference = reference.resize(grid, Image.BOX).tobytes()
    pooled_actual = actual.resize(grid, Image.BOX).tobytes()
    coarse = sum(abs(a - b) for a, b in zip(pooled_reference, pooled_actual)) / len(pooled_reference)

    return {
        "size": size,
        "scheme": case.get("scheme", "light"),
        "natural": rendered["natural"],
        "mode": "exact" if exact else "coarse",
        "interior": interior,
        "clear": clear,
        "edges": edges,
        "worst_colour": worst_colour,
        "worst_alpha": worst_alpha,
        "coarse": round(coarse, 2),
        "complaints": complaints,
        "verdict": "ok" if not complaints and coarse <= COARSE_TOLERANCE else "WRONG",
    }


def main():
    mark = mark_from_node()
    names = mark["files"]
    cases = [
        *[{"file": "svg", "size": size, "shapes": "light"} for size in VECTOR_SIZES],
        {"file": "svg", "size": VECTOR_DETAIL, "shapes": "light"},
        {"file": "svg", "size": VECTOR_DETAIL, "shapes": "dark", "scheme": "dark"},
        *[{"file": "ico", "size": size, "shapes": "light"} for size in ICO_SIZES],
        {"file": "touch", "size": TOUCH_SIZE, "shapes": "touch"},
    ]

    rendered, version = render_in_browser(mark, cases)
    print(f"\nicons  {len(cases)} renderings in Chromium {version}; the reference is the mark "
          f"painted by the same browser\n")
    print(f"  {'file':<24} {'px':>4} {'scheme':<6} {'browser sees':>12} {'mode':<7}"
          f" {'interior':>9} {'colour':>6} {'alpha':>5} {'clear':>7} {'edges':>7} {'coarse':>7}"
          f"  verdict")

    results = []
    for entry in rendered:
        outcome = compare(entry)
        outcome["label"] = names[entry["case"]["file"]]
        results.append(outcome)
        print(f"  {outcome['label']:<24} {outcome['size']:>4} {outcome['scheme']:<6}"
              f" {outcome['natural']:>12} {outcome['mode']:<7} {outcome['interior']:>9}"
              f" {outcome['worst_colour']:>6} {outcome['worst_alpha']:>5} {outcome['clear']:>7}"
              f" {outcome['edges']:>7} {outcome['coarse']:>7}  {outcome['verdict']}")

    wrong = [outcome for outcome in results if outcome["verdict"] != "ok"]
    print()

    if wrong:
        details = []
        for outcome in wrong:
            shown = "\n".join(f"      {complaint}" for complaint in outcome["complaints"][:4])
            details.append(
                f"  {outcome['label']} at {outcome['size']}px ({outcome['scheme']}): "
                f"{len(outcome['complaints'])} pixel(s) wrong, worst colour difference "
                f"{outcome['worst_colour']}, worst coverage difference {outcome['worst_alpha']}, "
                f"coarse difference {outcome['coarse']}\n{shown}")
        fail(f"{len(wrong)} of {len(results)} renderings do not paint the mark:\n" + "\n".join(details))

    exact = [outcome for outcome in results if outcome["mode"] == "exact"]
    print(f"✓ {len(results)} renderings paint the mark — "
          f"{sum(o['interior'] for o in exact)} interior pixels checked pixel for pixel in the "
          f"{len(exact)} exact rendering(s), worst colour difference "
          f"{max(o['worst_colour'] for o in exact)}, worst coverage difference "
          f"{max(o['worst_alpha'] for o in exact)}, coarse worst "
          f"{max(o['coarse'] for o in results)} of {COARSE_TOLERANCE}\n")


if __name__ == "__main__":
    main()
