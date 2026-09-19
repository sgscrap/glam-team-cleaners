import { readdirSync } from 'node:fs';
import { ROBOTS_FILE, SITEMAP_FILE } from './seo.js';
import { ICON_FILES } from './favicon.js';

/**
 * The files the site is served from — the single owner of that list.
 *
 * The reference guard checks the page against it and `npm run stage` publishes exactly it,
 * so the page cannot point at a file the deploy does not publish, and the deploy cannot
 * publish a set that differs from the one that was checked.
 */
/**
 * Published by convention rather than by reference: the page a visitor lands on, and the two
 * files crawlers fetch by name. Everything else that ships has to earn its place by being
 * pointed at from something published, which is what `unreferencedFiles` holds it to.
 */
export const ENTRY_FILES = ['index.html', SITEMAP_FILE, ROBOTS_FILE];

/**
 * Asked for by name at the site root, whatever any page declares — /favicon.ico by a client that
 * found no declaration, /apple-touch-icon.png by a phone adding the site to a home screen.
 */
const NAMED_AT_ROOT = [ICON_FILES.ico, ICON_FILES.touch];

const ROOT_FILES = [...ENTRY_FILES, 'styles.css', 'script.js', ...NAMED_AT_ROOT];
const ASSET_DIRECTORY = 'assets';

/** Every file under a directory, as site-root-relative paths, so nested assets are covered. */
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);

export const shippedFiles = () => [...ROOT_FILES, ...walk(ASSET_DIRECTORY)];
