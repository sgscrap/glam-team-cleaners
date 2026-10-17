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
 * the only differences here are the two things that must differ: the address it calls itself, and
 * the fact that its icons sit beside it instead of one directory up.
 *
 * `links-site/` is committed like every other generated artifact — `npm run check` holds it to src/
 * — but it is not part of `src/ship.js`, so it is never uploaded to the main site. The README and
 * workflow that belong to the second repository live in `deploy/links-site/`.
 */
import { LINK_HOST } from './dns.js';
import { ICON_FILES } from './favicon.js';
import { linksHtml } from './links.js';

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
export const linkSiteFiles = icons => ({
  [`${LINK_SITE_DIR}/index.html`]: linksHtml({ canonical: LINK_SITE_URL, prefix: '' }),
  [LINK_SITE_CNAME]: `${LINK_HOST}\n`,
  [`${LINK_SITE_DIR}/${ICON_FILES.ico}`]: icons[ICON_FILES.ico],
  [`${LINK_SITE_DIR}/${ICON_FILES.svg}`]: icons[ICON_FILES.svg],
  [`${LINK_SITE_DIR}/${ICON_FILES.touch}`]: icons[ICON_FILES.touch],
});
