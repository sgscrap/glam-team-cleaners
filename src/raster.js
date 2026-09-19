/**
 * Turning shapes into pixels, and pixels into the two container formats the icons need.
 *
 * Deliberately small and dependency-free. The mark is a rounded ground and three rounded bars, so
 * drawing it is a point-in-shape test per sample rather than an SVG engine, and a PNG or an ICO is
 * a header plus deflated scanlines — a few hundred bytes of either, which is why both live here
 * instead of behind an image library that a fresh clone would have to install.
 *
 * The two readers at the end go the other way, so a guard can measure a published file instead of
 * trusting the encoder that wrote it. They are the strict inverse of `png` and `ico` and nothing
 * more: a reader that guessed at the rest of either format would be a second implementation to keep
 * correct, and one that quietly accepted a different image would have a guard measuring the wrong
 * thing.
 *
 * Shapes are `{ fill: '#rrggbb', x, y, width, height, top, base }` in canvas units, drawn in order
 * so a later one paints over an earlier one.
 */
import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Whether a point falls inside a rectangle whose top and bottom corners are rounded — `top` for
 * both upper ones, `base` for both lower. A point inside a corner square is inside the shape only
 * if it is also inside that corner's quarter circle, which is all the geometry these icons use.
 */
const inShape = (px, py, { x, y, width, height, top, base }) => {
  const right = x + width;
  const bottom = y + height;
  if (px < x || px > right || py < y || py > bottom) return false;

  const inCorner = (cx, cy, r) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  if (py < y + top) {
    if (px < x + top) return inCorner(x + top, y + top, top);
    if (px > right - top) return inCorner(right - top, y + top, top);
  }
  if (py > bottom - base) {
    if (px < x + base) return inCorner(x + base, bottom - base, base);
    if (px > right - base) return inCorner(right - base, bottom - base, base);
  }
  return true;
};

/** '#rrggbb' → the three channel values. */
const channels = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

/**
 * The shapes drawn into an RGBA raster `size` pixels square, over a `canvas`-unit coordinate
 * space. Each pixel is sampled `samples` times per axis and averaged, which is what keeps the
 * curves smooth at 16px — the size that matters most, since a tab draws the icon about that
 * large. Colour is averaged over the covered samples only, so an edge does not darken toward the
 * background it is fading into.
 */
export const draw = (size, shapes, { canvas = 64, samples = 4 } = {}) => {
  const filled = shapes.map(({ fill, ...shape }) => ({ rgb: channels(fill), ...shape }));
  const pixels = Buffer.alloc(size * size * 4);
  const step = canvas / (size * samples);
  const samplesPerPixel = samples * samples;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const cx = (px * canvas) / size + (sx + 0.5) * step;
          const cy = (py * canvas) / size + (sy + 0.5) * step;
          const hit = filled.reduce((found, shape) => (inShape(cx, cy, shape) ? shape : found), null);
          if (hit) {
            [red, green, blue] = [red + hit.rgb[0], green + hit.rgb[1], blue + hit.rgb[2]];
            covered += 1;
          }
        }
      }
      const at = (py * size + px) * 4;
      pixels[at] = covered ? Math.round(red / covered) : 0;
      pixels[at + 1] = covered ? Math.round(green / covered) : 0;
      pixels[at + 2] = covered ? Math.round(blue / covered) : 0;
      pixels[at + 3] = Math.round((255 * covered) / samplesPerPixel);
    }
  }
  return pixels;
};

/* --- PNG ----------------------------------------------------------------- */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/**
 * An 8-bit RGBA PNG. Every row carries filter 0 rather than a predictor: these are flat shapes with
 * no gradients, so nothing predicts a row better than the row itself, and a fixed filter is one
 * less thing that can be wrong.
 */
export const png = (size, pixels) => {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let row = 0; row < size; row += 1) pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bits per channel
  header[9] = 6;   // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * A published PNG as RGBA pixels, top-down. 8-bit RGBA with filter 0 on every row is the only shape
 * the encoder writes, so it is the only shape this reads; anything else throws rather than being
 * guessed at.
 */
export const readPng = buffer => {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (buffer[24] !== 8 || buffer[25] !== 6) {
    throw new Error(`The PNG is not 8-bit RGBA (depth ${buffer[24]}, colour type ${buffer[25]}), which is the only shape the encoder writes`);
  }

  const parts = [];
  for (let at = 8; at + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(at);
    if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    if (filter !== 0) throw new Error(`Row ${row} of the PNG carries filter ${filter}, and the encoder writes filter 0 on every row`);
    raw.copy(pixels, row * stride, row * (stride + 1) + 1, row * (stride + 1) + 1 + stride);
  }
  return { width, height, pixels };
};

/* --- ICO ----------------------------------------------------------------- */

/** One frame as a bottom-up 32-bit DIB, followed by the 1-bit mask the format still requires. */
const dib = (size, pixels) => {
  const bitmap = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const from = ((size - 1 - row) * size + column) * 4;
      const to = (row * size + column) * 4;
      bitmap[to] = pixels[from + 2];
      bitmap[to + 1] = pixels[from + 1];
      bitmap[to + 2] = pixels[from];
      bitmap[to + 3] = pixels[from + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);   // colour rows, plus the mask's
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(bitmap.length + maskStride * size, 20);
  // The mask is all zeros: 32-bit frames carry their own alpha, and the format only insists the
  // mask exist.
  return Buffer.concat([header, bitmap, Buffer.alloc(maskStride * size)]);
};

/** An .ico holding several sizes, which is what a browser asks for by name at a site's root. */
export const ico = frames => {
  const images = frames.map(({ size, pixels }) => ({ size, data: dib(size, pixels) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);   // 1: icon, as opposed to 2: cursor
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size > 255 ? 0 : size;   // 0 means 256
    entry[1] = size > 255 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
};

/**
 * A published .ico as its frames, each RGBA and top-down like `readPng` returns, so a guard can
 * measure either container the same way.
 *
 * The container's own claim about a frame is checked against the bitmap inside it: an entry that
 * says 32 over a 16-pixel image renders as a blurred icon and looks like nothing else — exactly the
 * kind of breakage that only shows up when something measures it.
 */
export const readIco = buffer => Array.from({ length: buffer.readUInt16LE(4) }, (_, index) => {
  const entry = 6 + index * 16;
  const size = buffer[entry] === 0 ? 256 : buffer[entry];
  const at = buffer.readUInt32LE(entry + 12);
  const header = buffer.readUInt32LE(at);
  const width = buffer.readInt32LE(at + 4);
  const height = buffer.readInt32LE(at + 8) / 2;
  const bits = buffer.readUInt16LE(at + 14);
  if (header !== 40 || bits !== 32) {
    throw new Error(`Frame ${index} of the .ico is not a 32-bit DIB of the shape the encoder writes (${header}-byte header, ${bits} bits per pixel)`);
  }
  if (width !== size || height !== size) {
    throw new Error(`Frame ${index} of the .ico is listed as ${size}px and holds a ${width}x${height} bitmap`);
  }

  const pixels = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      // The DIB stores its rows bottom-up, in BGRA.
      const from = at + 40 + ((size - 1 - row) * size + column) * 4;
      const to = (row * size + column) * 4;
      pixels[to] = buffer[from + 2];
      pixels[to + 1] = buffer[from + 1];
      pixels[to + 2] = buffer[from];
      pixels[to + 3] = buffer[from + 3];
    }
  }
  return { size, pixels };
});
