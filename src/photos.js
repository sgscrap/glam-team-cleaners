/**
 * The photograph pipeline: how a master becomes what the page serves.
 *
 * Masters are the owner's originals. They live in photos/ and are never deployed; the files the
 * page loads are generated from them into assets/ by `npm run photos`. That is what makes
 * everything in assets/ mean "published" — a file a visitor or a crawler actually fetches — and
 * it is why the masters are not simply left beside their derivatives.
 *
 * Two things this pipeline fixes, in order of how much they weigh:
 *
 * 1. Format. These masters are 356-621 KB PNGs, which is the wrong container for a photograph
 *    by an order of magnitude: the same pixels as WebP are 29-43 KB. Nothing else here comes
 *    close to that saving.
 * 2. Size. A phone rendering the hero 366px wide has no use for pixels it will never show, so
 *    each photograph is served as a ladder of widths and the browser picks one.
 *
 * One rule the generator enforces and this file encodes: a derivative is never wider than its
 * master. A browser can scale up as well as we can, and an invented pixel costs the same as a
 * real one — so the largest candidate is the master's own width, and a photograph too small for
 * the box it fills is reported rather than padded.
 */
import { existsSync, readdirSync } from 'node:fs';
import { gallery, hero, team } from './data.js';

/** The two directories, related in exactly one place. */
const MASTER_DIRECTORY = 'photos';
const SERVED_DIRECTORY = 'assets';

/**
 * The widths a photograph is offered at, smallest first. Only the steps below a master's own
 * width are used, so a small photograph produces a short ladder instead of upscaled copies.
 *
 * These are the widths the layout actually asks for, measured in a browser rather than derived
 * from the CSS: the hero is 326px wide on a phone, capped at 580px at tablet and 467px on a wide
 * screen; the team portrait 347px, 560px and 337px. The 460px once written here was a guess, and
 * it made a 337px box fetch the 480px derivative.
 */
export const WIDTHS = [360, 480, 960];

/**
 * WebP rather than AVIF: measured on these masters, AVIF is another 28% smaller (31 KB against
 * 43 KB at full width), which is not worth a `<picture>` element carrying two ladders, and it
 * needs an encoder that is not present wherever this tool happens to run — Pillow only writes
 * AVIF where it was built against libavif. WebP is one constant here if that trade changes.
 */
export const FORMAT = 'webp';
export const QUALITY = 82;

/**
 * What one photograph the page renders may weigh, measured on the largest derivative — the file
 * a browser that understands nothing else will download. The heaviest today is 43 KB, so this
 * leaves room for a larger master while catching what actually goes wrong: a generator run
 * skipped, or a photograph dropped in at full resolution. The share card is not measured here;
 * it is not a page image, and it has its own guards.
 */
export const MAX_BYTES = 120 * 1024;

/**
 * Every photograph the page shows, in document order. The gallery contributes nothing until a
 * real photograph is set on an entry, which is the honest state of a portfolio with no pictures.
 */
export const photographs = () => [
  hero.image,
  team.portrait,
  ...gallery.items.map(item => item.photo).filter(Boolean),
];

const served = master => master.replace(`${MASTER_DIRECTORY}/`, `${SERVED_DIRECTORY}/`);

/** `photos/emely/emely-01.png` at 480 → `assets/emely/emely-01-480.webp` */
export const derivativePath = (master, width) =>
  `${served(master).replace(/\.[^./]+$/, '')}-${width}.${FORMAT}`;

/**
 * The widths one photograph is served at: the ladder steps below it, plus its own width so the
 * full-resolution file is always among the candidates. `width` on a photograph is the master's
 * real pixel width, which is what the `width` attribute of the emitted `<img>` declares.
 */
export const derivativeWidths = photo => [...WIDTHS.filter(width => width < photo.width), photo.width];

/** What a browser without srcset support gets, and what structured data names. */
export const largestPath = photo => derivativePath(photo.master, derivativeWidths(photo).at(-1));

/** The candidate list, e.g. `assets/emely/emely-01-360.webp 360w, ...` */
export const srcset = photo =>
  derivativeWidths(photo).map(width => `${derivativePath(photo.master, width)} ${width}w`).join(', ');

/** Every derivative the site serves, for the ship-set and weight guards to walk. */
export const servedPhotographs = () => photographs().flatMap(photo =>
  derivativeWidths(photo).map(width => ({ path: derivativePath(photo.master, width), width })));

/** Every file under a directory, as site-root-relative paths, so nested masters are covered. */
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory()
    ? walk(`${directory}/${entry.name}`)
    : [`${directory}/${entry.name}`]);

/**
 * Masters in photos/ that no slot uses. Worth reporting for the same reason the ship set reports
 * an unreferenced file: a master is not deployed, so nothing else here would ever mention it, and
 * "this photograph is not on the page" is a decision to make rather than a state to discover.
 */
export const unusedMasters = () => {
  if (!existsSync(MASTER_DIRECTORY)) return [];
  const used = new Set(photographs().map(photo => photo.master));
  return walk(MASTER_DIRECTORY).filter(file => !used.has(file));
};

/**
 * Everything the generator needs, serialised as JSON by scripts/photos.py — so the ladder, the
 * quality and the naming are read from this file rather than copied into a second language.
 */
export const pipelineSpec = () => ({
  format: FORMAT,
  quality: QUALITY,
  maxBytes: MAX_BYTES,
  photos: photographs().map(photo => ({
    master: photo.master,
    width: photo.width,
    height: photo.height,
    derivatives: derivativeWidths(photo).map(width => ({ path: derivativePath(photo.master, width), width })),
  })),
  unused: unusedMasters(),
});
