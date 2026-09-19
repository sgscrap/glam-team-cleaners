/**
 * The site's icons — one description of the brand mark, drawn three ways.
 *
 * The header already carries a mark: three bars, pale at the edges and rose in the middle, tallest
 * in the centre. Every icon the site publishes is that mark on the footer's dark ground, and all
 * of them are drawn from `markShapes` below, so the vector favicon, the `favicon.ico` a browser
 * asks for by name, and the home-screen icon cannot disagree about the shape.
 *
 * Its colours are read out of the stylesheet tokens rather than copied here, because the
 * stylesheet is where they are owned. Its geometry is the header's mark restated in the one place a
 * canvas can read, and `assertIconsMatchBrandMark` compares the ten numbers below against
 * 03-header.css — so reshaping the header stops the build rather than leaving a tab on the old
 * proportions. The icons are built by src/build.js like the page and the stylesheet are, so
 * `npm run check` fails if a committed one no longer matches the tokens — change `--rose` and the
 * build stops until they are rebuilt, rather than letting a tab keep last season's pink.
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

/**
 * The header mark, as 03-header.css draws it, and the scale the icons draw it at.
 *
 * These are the stylesheet's own numbers restated where a canvas can read them — one is CSS and the
 * other is geometry, and neither can import the other. That is the drift the guard exists to catch:
 * change a bar's height in the stylesheet and the build stops, rather than leaving a tab showing
 * proportions the site stopped using, in a file nobody opens.
 */
export const BRAND_MARK = {
  box: 28,
  barWidth: 7,
  gap: 2,
  heights: [14, 25, 19],
  topRadius: 5,
  baseRadius: 1,
  /** Which bar carries the rose, counted the way `:nth-child` counts. */
  rose: 2,
  /**
   * The corner on the icon's ground, as a percentage of the mark's box — `--icon-radius` on
   * `.brand-mark`. A share rather than a length, because the same icon is drawn from a 16px tab to a
   * 180px home screen and a fixed corner would be wrong at one end of that range.
   */
  groundRadius: 25,
  /** The icons draw the mark at 2x, so a 7px bar becomes 14 units of a 64-unit canvas. */
  scale: 2,
};

/** The partial that draws the mark, so the guard that ties the icons to it reads the right file. */
export const BRAND_MARK_STYLESHEET = 'src/styles/03-header.css';

/**
 * The canvas the mark's numbers are in, which the geometry guard measures the published frames
 * against. Exported because that guard reads the files from outside rather than drawing them, and
 * the two have to be talking about the same coordinate space to be comparing anything.
 */
export const ICON_CANVAS = 64;

/* Everything below is the mark's numbers at the icon's scale, so there is one description of the
   shape rather than one per file. */
const MARK_BOX = BRAND_MARK.box * BRAND_MARK.scale;
const MARK_LEFT = (ICON_CANVAS - MARK_BOX) / 2;
const BAR_WIDTH = BRAND_MARK.barWidth * BRAND_MARK.scale;
const BAR_GAP = BRAND_MARK.gap * BRAND_MARK.scale;
const BAR_HEIGHTS = BRAND_MARK.heights.map(height => height * BRAND_MARK.scale);
const BAR_TOKENS = BRAND_MARK.heights.map((_, index) => (index + 1 === BRAND_MARK.rose ? 'rose' : 'ivory'));

/**
 * The tops are half-round: the stylesheet asks for a 5px radius on a 7px bar, and a browser clamps
 * that to half the width, which is why the mark reads as three rounded pillars. The icon has to
 * clamp the same way or it would draw a shape the header never shows.
 */
const TOP_RADIUS = Math.min(BRAND_MARK.topRadius, BRAND_MARK.barWidth / 2) * BRAND_MARK.scale;
const BASE_RADIUS = BRAND_MARK.baseRadius * BRAND_MARK.scale;

/**
 * The ground the mark sits on inside the icon: the one shape here that the stylesheet has no drawing
 * of, since a tab has a square of its own and the header has no tile around the mark. Its corner is
 * therefore the mark's own — the share `--icon-radius` declares of the box — so the ground still
 * follows the header rather than being the one number an icon gets to keep to itself.
 */
// Rounded to a hundredth of a canvas unit: a share of an odd box lands on a long binary fraction
// (10% of 56 is 5.6000000000000005), and these artifacts are files someone opens and reads.
const GROUND_RADIUS = Math.round(MARK_BOX * (BRAND_MARK.groundRadius / 100) * 100) / 100;

/**
 * The ground's class in the vector icon, so the one shape that varies with the browser's colour
 * scheme can be addressed by the stylesheet inside it. Named here because two things need the
 * same spelling: the shape that carries it, and the guard that checks something carries it.
 */
export const GROUND_CLASS = 'ground';

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
      class: GROUND_CLASS,
      x: 0,
      y: 0,
      width: ICON_CANVAS,
      height: ICON_CANVAS,
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
const shapeSvg = ({ fill, class: kind, x, y, width, height, top, base }) => {
  const named = kind ? ` class="${kind}"` : '';
  if (top === base) {
    return `<rect${named} x="${x}" y="${y}" width="${width}" height="${height}"${top ? ` rx="${top}"` : ''} fill="${fill}"/>`;
  }
  const right = x + width;
  const bottom = y + height;
  const across = right - top > x + top ? `H${right - top}` : '';
  return `<path${named} fill="${fill}" d="M${x + top} ${y}${across}`
    + `A${top} ${top} 0 0 1 ${right} ${y + top}V${bottom - base}`
    + `A${base} ${base} 0 0 1 ${right - base} ${bottom}H${x + base}`
    + `A${base} ${base} 0 0 1 ${x} ${bottom - base}V${y + top}`
    + `A${top} ${top} 0 0 1 ${x + top} ${y}z"/>`;
};

/**
 * The vector icon: the mark's own shape, which is what a modern browser prefers to a raster.
 *
 * It is the only icon that can follow the browser's colour scheme — the `favicon.ico` and the
 * home-screen PNG are pixels, fixed at the colours they were encoded with — so the tile is left to
 * the stylesheet here. The ground is the light scheme's backdrop, because the mark's pale bars need
 * something dark to sit on; where the browser reports a dark scheme the strip the icon is drawn on
 * is already that backdrop, so the tile steps aside and the mark sits on it directly, exactly as
 * the header draws the mark on the site's own dark surfaces. The mark's colours never vary: the
 * bars are the brand in either scheme, and only the ground may move.
 */
export const faviconSvg = (palette = readPalette()) => `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${GENERATED_NOTE} Built from src/favicon.js. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}">
<title>${site.name}</title>
<style>
  @media (prefers-color-scheme: dark) { .${GROUND_CLASS} { fill: none; } }
</style>
${markShapes(palette).map(shapeSvg).join('\n')}
</svg>
`;

/** What a browser reaches for by name at a site's root when a page declares nothing. */
export const faviconIco = (palette = readPalette()) => ico(
  ICO_SIZES.map(size => ({ size, pixels: draw(size, markShapes(palette), { canvas: ICON_CANVAS }) })),
);

/** The home-screen icon: the same mark, ground bled to the edges, at Apple's size for it. */
export const touchIconPng = (palette = readPalette()) => png(
  TOUCH_SIZE,
  draw(TOUCH_SIZE, markShapes(palette, { bleed: true }), { canvas: ICON_CANVAS }),
);

/** Every icon the site publishes, keyed by the path it is published at. */
export const iconFiles = (palette = readPalette()) => ({
  [ICON_FILES.svg]: faviconSvg(palette),
  [ICON_FILES.ico]: faviconIco(palette),
  [ICON_FILES.touch]: touchIconPng(palette),
});
