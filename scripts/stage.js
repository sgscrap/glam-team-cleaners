import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { shippedFiles } from '../src/ship.js';

/**
 * Assembles the deployable site from the same list the build's reference guard checks, so
 * the published file set cannot drift from the one that was validated.
 */
const OUT = '_site';
const files = shippedFiles();

rmSync(OUT, { recursive: true, force: true });
for (const file of files) {
  mkdirSync(dirname(`${OUT}/${file}`), { recursive: true });
  cpSync(file, `${OUT}/${file}`);
}

console.log(`${OUT}/  ${files.length} files staged`);
