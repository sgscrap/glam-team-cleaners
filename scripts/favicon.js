import { writeFileSync } from 'node:fs';
import { FAVICON_FILE, FAVICON_TOKENS, faviconSvg, readPalette } from '../src/favicon.js';

/**
 * Writes the committed favicon. Run this after changing the brand tokens in
 * src/styles/01-tokens.css — the build fails until it does, because a tab that keeps showing the
 * old colours is drift nothing on the page would ever reveal.
 */
const palette = readPalette();
const svg = faviconSvg(palette);

writeFileSync(FAVICON_FILE, svg);
console.log(`${FAVICON_FILE}  ${Buffer.byteLength(svg)} bytes  ${FAVICON_TOKENS.map(name => `--${name} ${palette[name]}`).join(', ')}`);
