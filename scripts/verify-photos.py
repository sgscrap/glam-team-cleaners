#!/usr/bin/env python3
"""
Compare every published photograph with the master it was made from, coarsely but honestly.

    npm run photos:verify        (also runs at the end of `npm run photos`)

Why this is not in the build, the hook or `npm test`: reading WebP pixels needs an image library,
and this project's whole gate is dependency-free — that is what lets the hook run on a fresh
clone. So this is a tool, like `npm run photos` and `npm run social`, and it needs Python 3 with
Pillow.

What it closes that the build's own photograph guard cannot. `assertPhotographsMatchTheirMasters`
reads the container: the canvas is the ladder step, the height is the master's aspect, there is no
alpha and one frame. Every one of those numbers can be right while the picture itself is wrong —
a derivative made from the wrong master, a crop where the ladder does a resize, a mirror, a
channel swap, a colour profile applied to one file. Nothing committed here would reveal it, the
page would still render, and the only symptom is a visitor seeing the wrong photograph.

The measurement is a coarse fingerprint: each image, master and derivative, is averaged down to a
16x16 grid of mean RGB — `Image.BOX`, which is a true area average — and the two grids are
compared cell by cell across all three channels. That is deliberately blunt. It cannot see a few
regenerated pixels or a slightly different sharpening, which is what makes it stable, and it very
much sees a different picture.

The separation is measured, not guessed. On the photographs the site currently ships:

    correct derivatives (5 files)     0.15 - 0.73   mean absolute channel difference
    the other master instead          62.95
    a centre crop instead of a resize 70.33
    mirrored / flipped                59.87 / 64.32
    cropped 8% off the top            27.98
    greyscale                         22.76
    one channel shifted 15%            4.49

So the tolerance below sits at 3.0: four times the worst honest difference, and roughly a tenth of
the smallest wrong picture. A change that starts failing this is a change to look at, not a
threshold to raise — the margin is the whole point.

What it deliberately does not check: shape. A stretched derivative fingerprints the same as a
faithful one, because both are pooled to the same grid regardless of aspect. Geometry is the
build's business and it already holds every canvas to the master's aspect; this tool only answers
"is this the same picture".
"""

import sys
from pathlib import Path

from PIL import Image

from photos import fail, spec_from_node

ROOT = Path(__file__).resolve().parent.parent

# The fingerprint's resolution, and the widest mean difference two renderings of one photograph
# may differ by. Both are calibrated above; see the measurements in this file's docstring.
GRID = (16, 16)
TOLERANCE = 3.0


def fingerprint(image):
    """Mean RGB of every cell in a fixed grid — the picture, at 16x16."""
    pooled = image.convert("RGB").resize(GRID, Image.BOX)
    return list(pooled.tobytes())


def difference(one, other):
    """How far apart two fingerprints are: the mean channel difference, and the worst cell."""
    deltas = [abs(a - b) for a, b in zip(one, other)]
    return sum(deltas) / len(deltas), max(deltas)


def main():
    spec = spec_from_node()
    if not spec["photos"]:
        fail("no photographs to verify — src/data.js names no masters")

    print(f"\nphotographs  {len(spec['photos'])} masters vs their derivatives, "
          f"{GRID[0]}x{GRID[1]} grid, tolerance {TOLERANCE}\n")

    checked = 0
    worst = (0.0, "")
    wrong = []

    for photo in spec["photos"]:
        master = ROOT / photo["master"]
        if not master.exists():
            fail(f"{photo['master']} is named in src/data.js but does not exist")

        with Image.open(master) as source:
            expected = fingerprint(source)
        print(f"  {photo['master']}")

        for derivative in photo["derivatives"]:
            path = ROOT / derivative["path"]
            if not path.exists():
                fail(f"{derivative['path']} is named by the ladder and is not on disk, so nothing "
                     f"can be compared with {photo['master']}")

            with Image.open(path) as served:
                actual = fingerprint(served)
            mean, cell = difference(expected, actual)
            checked += 1
            if mean > worst[0]:
                worst = (mean, derivative["path"])

            verdict = "ok" if mean <= TOLERANCE else "WRONG PICTURE"
            print(f"    {derivative['width']:>5}px  {derivative['path']:<40}"
                  f" diff {mean:>6.2f}  worst cell {cell:>3}  {verdict}")
            if mean > TOLERANCE:
                wrong.append((derivative["path"], photo["master"], mean, cell))

    print()

    if wrong:
        fail(
            f"{len(wrong)} derivative(s) do not look like the master they are named after "
            f"(tolerance {TOLERANCE}):\n"
            + "\n".join(
                f"  {path} differs from {master} by {mean:.2f} (worst cell {cell}).\n"
                f"    It is the right size, so nothing in the build would notice — regenerate it "
                f"with `npm run photos`."
                for path, master, mean, cell in wrong
            )
        )

    print(f"✓ {checked} file(s) match their master — worst is {worst[1]} at {worst[0]:.2f}, "
          f"against a tolerance of {TOLERANCE}\n")


if __name__ == "__main__":
    main()
