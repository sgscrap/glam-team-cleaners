/**
 * The link page as a site of its own — `links.glamcleaners.net`.
 *
 * Why a second site rather than a subdomain of the first: GitHub Pages gives a site one custom
 * domain, and its documentation lists an apex plus a custom subdomain as unsupported, with a CNAME
 * file that can hold only one name. A bare subdomain is therefore a second Pages site, in a second
 * repository, publishing this directory as its root.
 *
 * What is *not* duplicated is the page. The markup, the copy and every channel are built by
 * src/links.js from src/data.js, so the subdomain and `/links/` cannot quote different numbers, and
 * the only difference here is the one that must exist: its icons sit beside it instead of one
 * directory up.
 *
 * One page on two addresses, and only one of them may be indexed. The canonical is the apex path —
 * `https://glamcleaners.net/links/` — on both copies, because that is where the site's own links,
 * its sitemap and its structured data already point, so authority stays on the one host a search
 * engine has a property for. The subdomain keeps working as a short address a bio can hold, and
 * nothing about it is indexed twice: a page that canonicals elsewhere is the consolidation, not a
 * duplicate. The check in src/build.js holds both copies to that one URL.
 *
 * A hard redirect from the subdomain would consolidate further still — no second copy to fetch at
 * all — and becomes possible once the zone is on Cloudflare, where a redirect rule can answer for
 * it. Until then the alias serves the page, which is also what keeps it useful.
 *
 * `links-site/` is committed like every other generated artifact — `npm run check` holds it to src/
 * — but it is not part of `src/ship.js`, so it is never uploaded to the main site. The README and
 * workflow that belong to the second repository live in `deploy/links-site/`.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LINK_HOST } from './dns.js';
import { ICON_FILES } from './favicon.js';
import { LINKS_URL, linksHtml } from './links.js';

/** Where the second site is published, and the hostname it must answer on. */
export const LINK_SITE_URL = `https://${LINK_HOST}/`;

/** The directory in this repository that mirrors the second repository's root. */
export const LINK_SITE_DIR = 'links-site';

/** Pages reads the custom domain from this file in the artifact, so it is part of the build. */
export const LINK_SITE_CNAME = `${LINK_SITE_DIR}/CNAME`;

/**
 * The files the second site publishes. The icons are passed in rather than regenerated: they are
 * the same bytes the main site ships, and building them twice would be two drawings that could
 * disagree.
 */
/**
 * Every file the second site publishes, as a path relative to that repository's root. Read from
 * disk rather than from `linkSiteFiles` because the publisher runs in CI against the committed
 * build, where the icons are already files — and because what is pushed should be what `npm run
 * check` verified, byte for byte, not a second rendering of it.
 */
export const linkSitePublished = root => {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
  return walk(root).map(path => relative(root, path).split('\\').join('/')).sort();
};

/**
 * Copy the built site into a checkout of the repository that publishes it, then say what changed.
 *
 * A checkout rather than an API call: the workflow pushes one commit, so the second site keeps a
 * history that says what its page said and when — and a push of the same bytes writes no commit at
 * all. Everything already in that repository that is not one of these files is left alone; the
 * README is the only such file today, and it is not this function's to overwrite.
 */
export const publishLinkSite = (checkout, { root = LINK_SITE_DIR } = {}) => {
  const written = [];
  const unchanged = [];

  for (const path of linkSitePublished(root)) {
    const source = readFileSync(join(root, path));
    const destination = join(checkout, path);
    let existing = null;
    try {
      existing = readFileSync(destination);
    } catch {
      // Not there yet: the first publish of a file is not a change to compare against.
    }
    if (existing && existing.equals(source)) {
      unchanged.push(path);
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, path), destination);
    written.push(path);
  }

  // Files at the root that the site does not produce: reported, never deleted. A stray page on a
  // public site is worth seeing in a workflow log, but it is not this script's to remove.
  const ours = new Set(linkSitePublished(root));
  const stale = readdirSync(checkout)
    .filter(entry => statSync(join(checkout, entry)).isFile() && !ours.has(entry));

  return { written, unchanged, stale };
};

export const linkSiteFiles = icons => ({
  // `canonical: LINKS_URL` rather than `LINK_SITE_URL`: the subdomain is the alias, and a second
  // self-canonical link page is exactly the duplicate this file exists to prevent.
  [`${LINK_SITE_DIR}/index.html`]: linksHtml({ canonical: LINKS_URL, prefix: '' }),
  [LINK_SITE_CNAME]: `${LINK_HOST}\n`,
  [`${LINK_SITE_DIR}/${ICON_FILES.ico}`]: icons[ICON_FILES.ico],
  [`${LINK_SITE_DIR}/${ICON_FILES.svg}`]: icons[ICON_FILES.svg],
  [`${LINK_SITE_DIR}/${ICON_FILES.touch}`]: icons[ICON_FILES.touch],
});
