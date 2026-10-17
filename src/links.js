/**
 * The link-in-bio page, `/links/` — the one short address a bio can hold.
 *
 * A page of its own rather than a section of the homepage, because the job is different: it has
 * to load in a second on a phone, fit above the fold, and answer "how do I reach these people"
 * without the visitor scrolling past a hero. So it carries no marketing sections, no photograph,
 * and one small stylesheet — the brand's own tokens with a page of rules on top.
 *
 * Every value is read from src/data.js, including the numbers and the optional text link, so this
 * page cannot quote a rate the site does not charge or offer a channel the business does not
 * answer. `assertLinksPageHasEveryChannel` in checks.js holds it to that: the number, the mailbox
 * and the site are not decoration here, they are the page.
 */
import { readFileSync } from 'node:fs';
import { links, icons, site } from './data.js';
import { esc, GENERATED_NOTE } from './html.js';

/** Where the page is published. `links/` is a directory so the address stays `/links/`. */
export const LINKS_FILE = 'links/index.html';

/** Its canonical URL — the base for the sitemap entry and the Open Graph address alike. */
export const LINKS_URL = `${site.url}/links/`;

/** Colours and type come from the site's own tokens; the rules below them are this page's own. */
const TOKENS = 'src/styles/01-tokens.css';
const STYLESHEET = 'src/links.css';

/**
 * The icons this page declares. Spelled here rather than reusing ICON_LINKS because the paths are
 * relative to the page instead of the site root — and the build asserts the page declares exactly
 * these, so a path that only works from one directory cannot slip through.
 *
 * The prefix is a parameter because this page is published twice: at `/links/`, one directory below
 * the site root, and at the root of its own subdomain. Both addresses must name files that really
 * sit beside them, and neither may borrow the other's paths.
 */
export const linksIconLinks = prefix => [
  { rel: 'icon', href: `${prefix}favicon.ico`, sizes: '16x16 32x32 48x48' },
  { rel: 'icon', href: `${prefix}assets/favicon.svg`, type: 'image/svg+xml', sizes: 'any' },
  { rel: 'apple-touch-icon', href: `${prefix}apple-touch-icon.png`, sizes: '180x180' },
];

/** The declarations the `/links/` copy carries — the default, and the one the build asserts. */
export const LINKS_ICON_LINKS = linksIconLinks('../');

/** The same families the site uses, so a click from the page lands on a page that matches it. */
const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600;1,700&display=swap';

/** A stylesheet read from disk, with the same CRLF guard the site's own build applies. */
const readCss = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

/**
 * The logo is the home-screen icon rather than the vector favicon, on purpose: the vector one drops
 * its ground in a dark colour scheme, and a phone whose system theme is dark would load this page
 * light with a logo that had stepped aside for a dark background this page does not have. The
 * home-screen PNG is the same mark on the same ground in either scheme.
 */

/** An icon out of the shared set, inline — this page has no sprite to reference. */
const icon = name => `<svg class="link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;

const linkItem = ({ id, icon: name, label, detail, href, primary }) => `<a class="link${primary ? ' link-primary' : ''}" href="${esc(href)}" data-channel="${esc(id)}">
${icon(name)}
<span class="link-text"><span class="link-label">${esc(label)}</span><span class="link-detail">${esc(detail)}</span></span>
<span class="link-arrow" aria-hidden="true">↗</span>
</a>`;

/**
 * The page. No JSON-LD and no runtime script: everything on it is a link, and the one thing that
 * could be wrong — an address that does not match the card — is checked at build time instead of
 * repaired in the browser.
 *
 * `canonical` and `prefix` are what the second publication of this page changes: the subdomain's
 * copy is its own root, so its files sit beside it rather than one directory up, and its address is
 * the bare host. Everything below that — the copy, the numbers, the channels — is one source, so
 * the two addresses cannot drift apart.
 */
export const linksHtml = ({ canonical = LINKS_URL, prefix = '../' } = {}) => `<!doctype html>
<!-- ${GENERATED_NOTE} Built from src/data.js and src/links.css. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(links.title)}</title>
<meta name="description" content="${esc(links.description)}">
<link rel="canonical" href="${esc(canonical)}">
${linksIconLinks(prefix).map(({ rel, href, ...attributes }) => `<link rel="${rel}" href="${esc(href)}"${
  Object.entries(attributes).map(([name, value]) => ` ${name}="${value}"`).join('')}>`).join('\n')}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(links.title)}">
<meta property="og:description" content="${esc(links.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(`${site.url}/${site.socialImage.file}`)}">
<meta property="og:image:alt" content="${esc(site.socialImage.alt)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(links.title)}">
<meta name="twitter:description" content="${esc(links.description)}">
<meta name="twitter:image" content="${esc(`${site.url}/${site.socialImage.file}`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>
${readCss(TOKENS)}${readCss(STYLESHEET)}</style>
</head>
<body>
<main class="card">
<header class="identity">
<img class="logo" src="${prefix}apple-touch-icon.png" alt="" width="60" height="60">
<p class="eyebrow"><i aria-hidden="true"></i> ${esc(links.eyebrow)}</p>
<h1>${esc(links.heading.lead)}<br><em>${esc(links.heading.accent)}</em></h1>
<p class="lede">${esc(links.lede)}</p>
<p class="person">${esc(links.person.name)} <span>${esc(links.person.role)}</span></p>
<p class="person-note">${esc(links.personNote)}</p>
</header>
<nav class="links" aria-label="${esc(links.navLabel)}">
${links.items.map(linkItem).join('\n')}
</nav>
<footer class="page-footer">
<p class="hours-title">${esc(links.hoursTitle)}</p>
<p class="hours">${links.hours.map(esc).join('<br>')}</p>
<a class="site-link" href="${esc(links.siteLink.href)}">${esc(links.siteLink.label)}</a>
<p class="credit">${esc(links.credit)}</p>
</footer>
</main>
</body>
</html>
`.replace(/\r\n/g, '\n');
