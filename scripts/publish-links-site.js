/**
 * Copies `links-site/` into a checkout of the repository that publishes `links.glamcleaners.net`.
 *
 *   node scripts/publish-links-site.js ../glam-links
 *
 * Run from a clean checkout of sgscrap/glam-links; the workflow then commits whatever this
 * changed, so an unchanged page produces no commit and a changed page produces one. The mapping
 * lives in src/link-site.js and is tested there; this is only the part that talks to a terminal.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { publishLinkSite } from '../src/link-site.js';

const checkout = process.argv[2];

if (!checkout) {
  console.error('usage: node scripts/publish-links-site.js <checkout of sgscrap/glam-links>');
  process.exit(1);
}

if (!existsSync(join(checkout, '.git'))) {
  // A directory that is not a checkout would be overwritten in place and then remembered nowhere.
  console.error(`✗ ${checkout} is not a git checkout — clone the repository that publishes the subdomain first.`);
  process.exit(1);
}

const { written, unchanged, stale } = publishLinkSite(checkout);

for (const path of written) console.log(`  wrote  ${path}`);
for (const path of unchanged) console.log(`  same   ${path}`);
if (stale.length) console.log(`  left   ${stale.join(', ')} (not produced by this site)`);

console.log(`\n${written.length} written, ${unchanged.length} unchanged`);
