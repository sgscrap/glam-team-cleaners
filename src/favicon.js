/**
 * The site's icons — one description of the brand mark, drawn three ways.
 *
 * The header already carries a mark: three bars, pale at the edges and rose in the middle, tallest
 * in the centre. Every icon the site publishes is that mark on the footer's dark ground, and all
 * of them are drawn from `markShapes` below, so the vector favicon, the `favicon.ico` a browser
 * asks for by name, and the home-screen icon cannot disagree about the shape.
 *
 * Its colours are read out of the stylesheet tokens rather than copied here, because the
 * stylesheet is where they are owned. The icons are built by src/build.js like the page and the
 * stylesheet are, so `npm run check` fails if a committed one no longer matches the tokens —
 * change `--rose` and the build stops until they are rebuilt, rather than letting a tab keep last
 * season's pink.
 */
import { readFileSync } from 'node:fs';
import { site } from './data.js';
import { GENERATED_NOTE } from './html.js';
import { draw, ico, png } from './raster.js';

const TOKENS_FILE = 'src/styles/01-tokens.css';

/** The icons as they are published, site-root relative. One spelling, shared by the build, the
    page's own declarations, and the guard that checks both. */
export const ICON_FILES = {
  svg: 'assets/favicon.svg',
  ico: 'favicon.ico',
  touch: 'apple-touch-icon.png',
};

/**
 * The declarations the page carries, in one place because two readers need them: the head emits
 * these, and the build asserts the page still declares exactly them. The conventional name comes
 * first as the fallback every client understands, then the vector icon for browsers that can use
 * it, then the home-screen one.
 */
export const ICON_LINKS = [
  { rel: 'icon', href: ICON_FILES.ico, sizes: '16x16 32x32 48x48' },
  { rel: 'icon', href: ICON_FILES.svg, type: 'image/svg+xml', sizes: 'any' },
  { rel: 'apple-touch-icon', href: ICON_FILES.touch, sizes: '180x180' },
];

/** The sizes an .ico should carry: a bookmarks bar draws 16, a tab 16 or 32, a desktop shortcut 48. */
const ICO_SIZES = [16, 32, 48];
/** Apple's own size for a home-screen icon, which a device also asks for at the site root. */
const TOUCH_SIZE = 180;

/**
 * The only colours the mark may use: the ground it sits on, the two outer bars, and the middle
 * one. Named as tokens rather than written as hex — this list is the shape of the palette, not the
 * palette.
 */
export const FAVICON_TOKENS = ['espresso', 'ivory', 'rose'];

/**
 * `--name: #hex` out of the token partial. A token that is not a plain hex is an error rather than
 * something to guess at: an icon drawn in a colour the site does not use is worse than a build
 * that stops and says which token moved.
 */
export const readPalette = (tokens = readFileSync(TOKENS_FILE, 'utf8')) => Object.fromEntries(
  FAVICON_TOKENS.map(name => {
    const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
    if (!match) {
      throw new Error(`${TOKENS_FILE} declares no --${name} as a plain hex colour, so the icons cannot be built from it`);
    }
    return [name, match[1].toLowerCase()];
  }),
);

/*
 * The header mark, as the stylesheet draws it: a 28-unit box holding three bars 7 wide, 2 apart,
 * 14 / 25 / 19 tall, flush to the bottom, with the 5px top radius a 7px-wide bar clamps to half
 * its width. These numbers are that box at 2x inside the icon's 64-unit canvas.
 */
const CANVAS = 64;
const MARK_BOX = 56;
const MARK_LEFT = 4;
const BAR_WIDTH = 14;
const BAR_GAP = 4;
const BAR_HEIGHTS = [28, 50, 38];
const BAR_TOKENS = ['ivory', 'rose', 'ivory'];
const TOP_RADIUS = BAR_WIDTH / 2;
const BASE_RADIUS = 2;
const GROUND_RADIUS = 14;

/**
 * Every shape the mark is made of, ground first so the bars paint over it, in the 64-unit canvas
 * the vector icon and the rasters share.
 *
 * `bleed` fills the canvas with the ground and squares its corners: the shape a home-screen icon
 * needs, because the platform applies its own corner mask and an icon that arrives pre-rounded
 * shows black wedges where the two disagree.
 */
export const markShapes = (palette, { bleed = false } = {}) => {
  const span = BAR_HEIGHTS.length * BAR_WIDTH + (BAR_HEIGHTS.length - 1) * BAR_GAP;
  const left = MARK_LEFT + (MARK_BOX - span) / 2;
  const bottom = MARK_LEFT + MARK_BOX;

  return [
    {
      fill: palette.espresso,
      x: 0,
      y: 0,
      width: CANVAS,
      height: CANVAS,
      top: bleed ? 0 : GROUND_RADIUS,
      base: bleed ? 0 : GROUND_RADIUS,
    },
    ...BAR_HEIGHTS.map((height, index) => ({
      fill: palette[BAR_TOKENS[index]],
      x: left + index * (BAR_WIDTH + BAR_GAP),
      y: bottom - height,
      width: BAR_WIDTH,
      height,
      top: TOP_RADIUS,
      base: BASE_RADIUS,
    })),
  ];
};

/**
 * One shape as SVG. The ground is a rectangle; a bar is a path, because its top is rounded to half
 * its width and its base barely at all, and one `rx` cannot say both.
 */
const shapeSvg = ({ fill, x, y, width, height, top, base }) => {
  if (top === base) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}"${top ? ` rx="${top}"` : ''} fill="${fill}"/>`;
  }
  const right = x + width;
  const bottom = y + height;
  const across = right - top > x + top ? `H${right - top}` : '';
  return `<path fill="${fill}" d="M${x + top} ${y}${across}`
    + `A${top} ${top} 0 0 1 ${right} ${y + top}V${bottom - base}`
    + `A${base} ${base} 0 0 1 ${right - base} ${bottom}H${x + base}`
    + `A${base} ${base} 0 0 1 ${x} ${bottom - base}V${y + top}`
    + `A${top} ${top} 0 0 1 ${x + top} ${y}z"/>`;
};

/** The vector icon: the mark's own shape, which is what a modern browser prefers to a raster. */
export const faviconSvg = (palette = readPalette()) => `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${GENERATED_NOTE} Built from src/favicon.js. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">
<title>${site.name}</title>
${markShapes(palette).map(shapeSvg).join('\n')}
</svg>
`;

/** What a browser reaches for by name at a site's root when a page declares nothing. */
export const faviconIco = (palette = readPalette()) => ico(
  ICO_SIZES.map(size => ({ size, pixels: draw(size, markShapes(palette), { canvas: CANVAS }) })),
);

/** The home-screen icon: the same mark, ground bled to the edges, at Apple's size for it. */
export const touchIconPng = (palette = readPalette()) => png(
  TOUCH_SIZE,
  draw(TOUCH_SIZE, markShapes(palette, { bleed: true }), { canvas: CANVAS }),
);

/** Every icon the site publishes, keyed by the path it is published at. */
export const iconFiles = (palette = readPalette()) => ({
  [ICON_FILES.svg]: faviconSvg(palette),
  [ICON_FILES.ico]: faviconIco(palette),
  [ICON_FILES.touch]: touchIconPng(palette),
});
