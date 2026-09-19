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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/** Every derivative the site serves, for the ship-set, weight and geometry guards to walk. The
    master comes along so a guard can measure a derivative against the photograph it came from
    without taking its file name apart. */
export const servedPhotographs = () => photographs().flatMap(photo =>
  derivativeWidths(photo).map(width => ({ path: derivativePath(photo.master, width), width, master: photo.master })));

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

/* --- reading a published file back --------------------------------------- */

/** The bytes of a file that has to be there, so a missing one fails by name rather than as ENOENT. */
const bytesOf = path => {
  if (!existsSync(path)) {
    throw new Error(`${path} is named by the pipeline and is not on disk, so nothing about it can be measured`);
  }
  return readFileSync(path);
};

/**
 * A master's real pixel size, from the PNG header — which is the whole of the file that has to be
 * read for it, and deliberately not the decoder in src/raster.js: that one is the inverse of what
 * this project writes, and a master is somebody else's file in whatever shape it came in.
 */
export const masterSize = path => {
  const header = bytesOf(path).subarray(0, 24);
  if (header.toString('latin1', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG, and a master is expected to be one`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

/**
 * What a published WebP says it is, read from its container.
 *
 * Nothing here decodes the image: the pixels are compressed with VP8, which is not a format this
 * project can afford to implement and not one it should install a library to read. What the
 * container does carry is enough to catch a photograph pipeline going wrong — the canvas the
 * frames are in, whether there is an alpha channel, and whether the file is even a WebP. A
 * derivative that is the wrong size, the wrong shape or carrying an alpha channel the pipeline
 * never made is a file no eye would catch in a page of photographs.
 *
 * Three container shapes, as the format defines them: a bare lossy or lossless frame, and the
 * extended one that announces its features up front and holds the frame after them.
 */
export const readWebp = path => {
  const bytes = bytesOf(path);
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error(`${path} is not a WebP: it begins ${JSON.stringify(bytes.toString('latin1', 0, 12))}`);
  }

  const chunks = [];
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = bytes.toString('latin1', at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    chunks.push({ type, at: at + 8, length });
    at += 8 + length + (length % 2);   // chunks are padded to an even length
  }

  const chunk = type => chunks.find(entry => entry.type === type);
  const frame = chunk('VP8 ') ?? chunk('VP8L');
  const canvas = chunk('VP8X');
  if (!frame && !canvas) {
    throw new Error(`${path} holds no image: its chunks are ${chunks.map(({ type }) => type).join(', ') || 'none'}`);
  }

  let size;
  let alpha = Boolean(chunk('ALPH'));
  if (frame?.type === 'VP8 ') {
    // A 3-byte frame tag, the 3-byte start code, then 14 bits of width and 14 of height.
    const payload = bytes.subarray(frame.at, frame.at + frame.length);
    if (!(payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a)) {
      throw new Error(`${path} starts its VP8 frame with something other than a key frame's start code`);
    }
    const packed = payload.readUInt32LE(6);
    size = { width: packed & 0x3fff, height: (packed >> 16) & 0x3fff };
  } else if (frame?.type === 'VP8L') {
    const payload = bytes.subarray(frame.at, frame.at + frame.length);
    if (payload[0] !== 0x2f) throw new Error(`${path} starts its VP8L frame with something other than its signature byte`);
    const bits = payload.readUInt32LE(1);
    size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    alpha = alpha || Boolean((bits >> 28) & 1);
  } else {
    // VP8X states the canvas the frames live in, one less than the size, in three bytes each.
    size = { width: bytes.readUIntLE(canvas.at + 4, 3) + 1, height: bytes.readUIntLE(canvas.at + 7, 3) + 1 };
  }

  return {
    container: frame ? frame.type.trim() : 'VP8X',
    ...size,
    alpha,
    animated: Boolean(chunk('ANIM')),
    chunks: chunks.map(({ type }) => type.trim()),
  };
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
