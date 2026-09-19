#!/usr/bin/env python3
"""
Generate the WebP derivatives the page serves, from the masters in photos/.

    npm run photos

Why this is a tool rather than part of the build: resizing a photograph needs an image library,
and the build has none at all — no Pillow, nothing to install. So the derivatives are committed
files like the social card, and this script is how they are produced. It needs Python 3 with
Pillow; nothing in `npm run build`, `npm run check` or `npm test` does.

The ladder, the format, the quality, the budget and the file names come from src/photos.js, read
through Node, so this file copies none of them and a change there cannot leave this output behind.

Two things are enforced here rather than trusted:

  * The master's real size must match the size src/data.js declares for it. A wrong `width` and
    `height` in the data is invisible in review and reserves the wrong box on the page, which is
    how one of these photographs spent its life claiming to be 640x960 when it is 587x837. This
    check is also what keeps the output honest: the ladder is capped at the declared width, so if
    the declaration matches the file, no derivative can be wider than the pixels that exist.
  * Nothing produced here may exceed the weight budget. The build enforces the same number, so a
    tool run that would break the build says so here first, where the cause is obvious.
"""

import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER_DIRECTORY = "photos"
SERVED_DIRECTORY = "assets"


def fail(message):
    sys.exit(f"\n✗ {message}\n")


def spec_from_node():
    """The pipeline, read from the module that owns it."""
    script = (
        "import { pipelineSpec } from './src/photos.js';"
        "process.stdout.write(JSON.stringify(pipelineSpec()));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail(f"could not read the pipeline spec from src/photos.js:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def render(source, width, quality):
    """One step of the ladder, as WebP bytes.

    No width check here on purpose: the ladder is capped at the declared width, and the caller has
    already refused to run at all unless the declaration matches the master's real size — so a
    request wider than the pixels that exist cannot reach this function.

    LANCZOS rather than a faster filter: this runs when a photograph changes, not on every
    commit, and a resize a visitor can see the seam in is not a saving.
    """
    height = round(source.size[1] * width / source.size[0])
    out = io.BytesIO()
    source.convert("RGB").resize((width, height), Image.LANCZOS).save(
        out, "WEBP", quality=quality, method=6
    )
    return out.getvalue()


def write_if_changed(path, body):
    """Rewriting an identical file would churn git on every run for no reason."""
    target = ROOT / path
    if target.exists() and target.read_bytes() == body:
        return False, target.stat().st_size
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return True, len(body)


def main():
    spec = spec_from_node()
    if not spec["photos"]:
        fail("no photographs to generate from — src/data.js names no masters")

    budget = spec["maxBytes"]
    ladder = sorted({width for photo in spec["photos"] for width in
                     [d["width"] for d in photo["derivatives"]]})
    print(f"\nphotographs  {len(spec['photos'])} masters → {spec['format']} q{spec['quality']}, "
          f"ladder {', '.join(str(width) for width in ladder)}px\n")

    written = 0
    over_budget = []
    expected = set()

    for photo in spec["photos"]:
        master = ROOT / photo["master"]
        if not master.exists():
            fail(f"{photo['master']} is named in src/data.js but does not exist")

        source = Image.open(master)
        if source.size != (photo["width"], photo["height"]):
            fail(
                f"{photo['master']} is {source.size[0]}x{source.size[1]}, but src/data.js declares "
                f"{photo['width']}x{photo['height']}.\n"
                f"  The attributes reserve the wrong box on the page; correct the data first."
            )

        before = master.stat().st_size
        print(f"  {photo['master']}  {source.size[0]}x{source.size[1]}  {before // 1024} KB PNG")
        after = 0

        for derivative in photo["derivatives"]:
            body = render(source, derivative["width"], spec["quality"])
            changed, size = write_if_changed(derivative["path"], body)
            expected.add(derivative["path"])
            after = max(after, size)
            if size > budget:
                over_budget.append((derivative["path"], size))
            print(f"    {derivative['width']:>5}px  {derivative['path']:<44} {size // 1024:>4} KB"
                  f"{'' if changed else '   (unchanged)'}")
            written += 1 if changed else 0

        print(f"    {'':>5}    {'largest of the ladder':<44} {after // 1024:>4} KB"
              f"   from {before // 1024} KB\n")

    # Anything this tool produced before and no longer produces: a ladder change would otherwise
    # leave the old file in assets/ to be deployed, referenced by nothing.
    stale = []
    for existing in sorted((ROOT / SERVED_DIRECTORY).rglob(f"*.{spec['format']}")):
        path = existing.relative_to(ROOT).as_posix()
        stem = existing.stem.rsplit("-", 1)
        if len(stem) == 2 and stem[1].isdigit() and path not in expected:
            stale.append(path)
            existing.unlink()

    if stale:
        print(f"  removed {len(stale)} stale derivative(s): {', '.join(stale)}\n")

    if over_budget:
        fail(
            "over the weight budget of "
            f"{budget // 1024} KB:\n"
            + "\n".join(f"  {path} is {size // 1024} KB" for path, size in over_budget)
        )

    if spec["unused"]:
        print(f"  masters not on the page: {', '.join(spec['unused'])}")

    print(f"\n✓ {written} file(s) written\n")


if __name__ == "__main__":
    main()
