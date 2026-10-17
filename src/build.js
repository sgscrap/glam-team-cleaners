import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { site, icons, runtime, ui, business, links } from './data.js';
import { HOST, PAGES_A, PAGES_AAAA } from './dns.js';
import { SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource } from './social-card.js';
import * as sections from './sections.js';
import * as seo from './seo.js';
import { jsonBlock, esc, GENERATED_NOTE } from './html.js';
import { shippedFiles } from './ship.js';
import { LINKS_FILE, LINKS_ICON_LINKS, LINKS_URL, linksHtml, linksIconLinks } from './links.js';
import { LINK_SITE_DIR, LINK_SITE_URL, linkSiteFiles } from './link-site.js';
import { ZONE_FILE, zoneFile } from './dns.js';
import { BRAND_MARK, BRAND_MARK_STYLESHEET, ICON_FILES, ICON_LINKS, iconFiles } from './favicon.js';
import { MAX_BYTES, photographs, servedPhotographs, unusedMasters } from './photos.js';
import {
  RUNTIME_KEYS,
  between,
  assertBookingOptionsMatch,
  assertBusinessFields,
  assertE164Phone,
  assertEmbeddedJsonParses,
  assertEmail,
  assertFaqMatchesPage,
  assertLinksPageHasEveryChannel,
  assertSitemapListsEveryPage,
  assertHtmlIsWellFormed,
  assertFaviconAdaptsToDarkScheme,
  assertIconsDeclared,
  assertIconsMatchIntendedGeometry,
  assertVectorIconMatchesTheMark,
  assertIconsMatchBrandMark,
  assertImagesAreLocal,
  assertKnownIcons,
  assertPhotographsMatchTheirMasters,
  assertPhotographsWithinBudget,
  assertPublishedUrlsAgree,
  assertRecordPresent,
  assertReferencesShip,
  assertRetiredHostsAbsent,
  assertRuntimeConfigKeys,
  assertSearchCopyFits,
  assertShareImageShips,
  assertSiteUrl,
  assertSocialCardMatchesCopy,
  assertStylePartialsNamed,
  referencedFiles,
  unreferencedFiles,
} from './checks.js';

const checkOnly = process.argv.includes('--check');

/** Check mode verifies rather than writes, so it does not narrate a build it never did. */
const log = checkOnly ? () => {} : console.log;

/** The published set, computed once: both directions of the ship-set check compare against it. */
const shipped = new Set(shippedFiles());

/* --- index.html --------------------------------------------------------- */

function buildPage() {
  assertSiteUrl(site);
  assertE164Phone(site);
  assertEmail(site);
  assertSearchCopyFits(site);

  const main = sections.mainSections.map(render => render()).join('\n');

  // The sprite is derived from real usage, so an unused symbol cannot survive a build.
  const usedIcons = assertKnownIcons(main, icons);
  assertBookingOptionsMatch(main);

  const sprite = `<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">\n${usedIcons.map(name => `<symbol id="i-${name}" viewBox="0 0 24 24">${icons[name]}</symbol>`).join('\n')}\n</svg>`;

  const page = `<!doctype html>
<!-- ${GENERATED_NOTE} -->
<html lang="en">
<head>
${seo.head()}
</head>
<body>
<a class="skip-link" href="#main">${esc(ui.skipLink)}</a>
${sprite}
${sections.announcement()}
${sections.header()}
<main id="main">
${main}
</main>
${sections.footerSection()}
${sections.mobileCta()}
${jsonBlock('application/json', runtime, ' id="runtime-config"')}
<script src="script.js"></script>
</body>
</html>
`;

  /**
   * Same CRLF guard as the stylesheet, for the same reason: a module saved with Windows
   * line endings would otherwise leak \r\n into the generated HTML.
   */
  const html = page.replace(/\r\n/g, '\n');

  // Structure before content: a malformed page would otherwise surface as whichever
  // content guard happens to read the markup next.
  assertHtmlIsWellFormed(html);
  // The share image first: it is the one reference nothing requests, so it is the one whose
  // absence is only ever discovered from the meta tags, and it should say so by name rather
  // than arrive as one more entry in the list of references that do not ship.
  const shareImage = assertShareImageShips(html, site, shipped);

  // The card ships and is named correctly; this asks whether it still says the right thing.
  const cardFields = assertSocialCardMatchesCopy(
    readFileSync(site.socialImage.file),
    SOCIAL_CARD_PROVENANCE_KEYWORD,
    socialCardSource(),
  );

  const embedded = assertEmbeddedJsonParses(html);
  const records = embedded.filter(block => block.type === 'application/ld+json').map(block => block.data);
  const businessRecord = assertRecordPresent(records, business.type);
  assertBusinessFields(businessRecord);
  const faqRecord = assertRecordPresent(records, seo.FAQ_TYPE);
  assertRuntimeConfigKeys(embedded.find(block => block.type === 'application/json')?.data);
  const questionCount = assertFaqMatchesPage(html, faqRecord);

  log(`index.html  ${html.length} bytes  ${usedIcons.length} icons (${usedIcons.join(', ')})`);
  log('rendered output  well-formed');
  log(`share preview  ${shareImage}  built from ${cardFields} fields of the current copy`);
  log(`structured data  ${businessRecord['@type']}  ${businessRecord.openingHours.length} opening-hours rules  ${businessRecord.hasOfferCatalog.itemListElement.length} services`);
  log(`${seo.FAQ_TYPE}  ${questionCount} questions, matched to the rendered page`);
  log(`runtime config  ${RUNTIME_KEYS.join(', ')}`);
  return html;
}

/* --- links/index.html --------------------------------------------------- */

/**
 * The link-in-bio page. Built here like every other artifact so `npm run check` holds it to src/
 * as well: it is the page a stranger reaches first, from a bio, on a phone, and the one page here
 * that nothing else on the site would notice going stale.
 */
function buildLinksPage(linked) {
  const html = linksHtml();
  assertHtmlIsWellFormed(html);
  assertIconsDeclared(html, LINKS_ICON_LINKS);
  assertLinksPageHasEveryChannel(html, site);
  log(`links  ${LINKS_FILE}  ${html.length} bytes  ${linked} channels, icons declared`);
  return html;
}

/* --- styles.css --------------------------------------------------------- */

function buildStyles() {
  const STYLE_DIR = 'src/styles';
  const styleFiles = readdirSync(STYLE_DIR).filter(name => name.endsWith('.css')).sort();
  assertStylePartialsNamed(styleFiles);

  // Normalize CRLF so an editor on Windows cannot rewrite every line of the artifact.
  const partials = styleFiles
    .map(name => readFileSync(`${STYLE_DIR}/${name}`, 'utf8').replace(/\r\n/g, '\n'))
    .join('');

  log(`styles.css  ${partials.length} chars  ${styleFiles.length} partials in order`);
  return `/* ${GENERATED_NOTE} Built from ${STYLE_DIR}/*.css in order. */\n${partials}`;
}

/* --- write, or verify that the committed artifacts are current ----------- */

const builtPage = buildPage();

// Drawn once: the link page's second publication ships the same icon bytes, and two drawings of
// the mark could disagree with each other.
const iconArtifacts = iconFiles();

const artifacts = {
  'index.html': builtPage,
  [LINKS_FILE]: buildLinksPage(links.items.length),
  'styles.css': buildStyles(),
  [seo.SITEMAP_FILE]: seo.sitemap(),
  [seo.ROBOTS_FILE]: seo.robots(),
  // Not a published file: the records the domain needs, so the change at the DNS provider is a
  // copy-paste. Generated like everything else, so it cannot drift from the addresses the
  // domain check compares against.
  [ZONE_FILE]: zoneFile(),
  // The icons are generated here rather than by a script of their own, so the check below covers
  // them like every other generated file: a committed icon that no longer matches the stylesheet
  // tokens is stale output, not a judgement call.
  ...iconArtifacts,
  // The same page as a site of its own, for links.glamcleaners.net. Generated and drift-checked
  // here so it cannot fall behind src/, but deliberately absent from src/ship.js: it belongs to
  // the second repository, never to this site's upload.
  ...linkSiteFiles(iconArtifacts),
};

// The canonicals read back out of the pages that were just built, rather than the list of pages
// somebody meant to build: that is what makes the sitemap check two-sided.
const canonicals = ['index.html', LINKS_FILE].map(file => between(artifacts[file], '<link rel="canonical" href="', '"')[0]);

// Two addresses serve the link page and only one of them may be indexed. Both copies name the
// apex path, so this is the guard that keeps the subdomain from quietly becoming a second page: a
// self-canonical there would be a duplicate in every search engine's index, and nothing else in
// the build would notice.
const linkCanonicals = [LINKS_FILE, `${LINK_SITE_DIR}/index.html`]
  .map(file => between(artifacts[file], '<link rel="canonical" href="', '"')[0]);
if (linkCanonicals.some(url => url !== LINKS_URL)) {
  throw new Error(`The link page must name ${LINKS_URL} from both addresses; the copies name ${linkCanonicals.join(' and ')}`);
}
console.log(`links page  ${LINKS_URL} from both addresses — one indexed, one short to share`);

assertPublishedUrlsAgree({
  html: artifacts['index.html'],
  sitemap: artifacts[seo.SITEMAP_FILE],
  robots: artifacts[seo.ROBOTS_FILE],
}, site);
const listedPages = assertSitemapListsEveryPage({ sitemap: artifacts[seo.SITEMAP_FILE], pages: canonicals });
console.log(`sitemap  ${listedPages} pages listed, each one a canonical this build emitted`);
console.log(`dns  ${ZONE_FILE}  ${PAGES_A.length + PAGES_AAAA.length + 2} records for ${HOST} and ${LINK_SITE_URL.replace('https://', '').replace(/\/$/, '')}`);

// Only now that every file a crawler reads exists: the guard reads all of each one, not just the
// canonical line, so a retired host in the share card's absolute URL is caught here too.
assertRetiredHostsAbsent({
  html: artifacts['index.html'],
  sitemap: artifacts[seo.SITEMAP_FILE],
  robots: artifacts[seo.ROBOTS_FILE],
  pages: { [LINKS_FILE]: artifacts[LINKS_FILE] },
});

/**
 * The ship-set check, both directions, run here rather than inside the page builder because
 * only now do all the artifacts exist: the stylesheet is built after the page, and a
 * reference it contains has to count exactly as much as one in the markup.
 */
const referenced = new Set([
  ...referencedFiles({ html: artifacts['index.html'], css: artifacts['styles.css'] }, site),
  // The links page is a directory deep, so its own references (`../favicon.ico`) are resolved from
  // `links/` — otherwise the icons it declares would be read as files the site does not publish.
  ...referencedFiles({ html: artifacts[LINKS_FILE], base: 'links/' }, site),
]);
const referenceCount = assertReferencesShip(referenced, shipped);
const unreferenced = unreferencedFiles(referenced, shipped);
const unreferencedBytes = unreferenced.reduce((total, file) => total + statSync(file).size, 0);
const publishedSummary = unreferenced.length
  ? `${unreferenced.length} referenced by nothing (${Math.round(unreferencedBytes / 1024)} KB): ${unreferenced.join(', ')}`
  : 'every file referenced';
console.log(`published set  ${shipped.size} files — ${referenceCount} references, all ship; ${publishedSummary}`);

// The second site is its own root, so the files its page names are read out of the set *it*
// publishes rather than this site's: an icon path left behind from the `/links/` copy — one
// directory up, where this site has nothing — would be a 404 on a phone and a green build here.
const linkSite = linkSiteFiles(iconArtifacts);
const linkSitePaths = new Set(Object.keys(linkSite).map(path => path.slice(LINK_SITE_DIR.length + 1)));
const linkSiteRefs = assertReferencesShip(
  referencedFiles({ html: artifacts[`${LINK_SITE_DIR}/index.html`] }, { url: LINK_SITE_URL }),
  linkSitePaths,
);
assertIconsDeclared(artifacts[`${LINK_SITE_DIR}/index.html`], linksIconLinks(''));
console.log(`links site  ${linkSitePaths.size} files, ${linkSiteRefs} references, none of them leaving it`);

// The icons the page declares, checked against the paths just published. Both directions matter:
// an icon nothing declares is a file a client will never ask for by that name, and a declaration
// naming a path that is not published sends it to the /favicon.ico fallback instead.
const declaredIcons = assertIconsDeclared(artifacts['index.html'], ICON_LINKS);
console.log(`icons  ${declaredIcons} declared and published: ${ICON_LINKS.map(({ href }) => href).join(', ')}`);

// And the one of them that follows the browser's colour scheme. The rasters are pixels and cannot,
// so this reads the vector icon's own rule: the ground steps aside in a dark scheme, and the mark's
// colours do not vary at all.
const schemeRules = assertFaviconAdaptsToDarkScheme(artifacts[ICON_FILES.svg]);
console.log(`dark scheme  ${schemeRules} rule in ${ICON_FILES.svg}: the ground steps aside, the mark's colours stay`);

// And what the rasters contain, read back out of the files rather than taken from the encoder that
// wrote them: the drift check can only hold them to src/, which would carry a drawing bug just as
// happily as the correct mark.
// And what the vector icon says, read out of the markup a browser renders rather than compared with
// the builder that wrote it: the rasters below are drawn from markShapes, so a bug in the path the
// SVG describes is the one thing on the page a screenshot of the rasters cannot contradict.
const measuredShapes = assertVectorIconMatchesTheMark(artifacts[ICON_FILES.svg]);
console.log(`vector icon  ${measuredShapes} shapes in ${ICON_FILES.svg} measured against the mark: every box, both corner radii, every colour`);

const measuredFrames = assertIconsMatchIntendedGeometry({
  ico: artifacts[ICON_FILES.ico],
  touch: artifacts[ICON_FILES.touch],
});
console.log(`icon geometry  ${measuredFrames} frames measured against the mark: bar tops, bases, colours and the ground between them`);

// And the shape they are drawn from, read out of the stylesheet that draws the header's mark: the
// icon's numbers are geometry and the stylesheet's are CSS, and one silently drifting from the other
// shows up in a tab nobody inspects.
const markValues = assertIconsMatchBrandMark(readFileSync(BRAND_MARK_STYLESHEET, 'utf8'), BRAND_MARK);
console.log(`brand mark  ${markValues} values in ${BRAND_MARK_STYLESHEET} agree with the icons`);

// What the page is allowed to show. A photograph the business does not own is not decoration
// here: it stands in for work under a caption claiming that work was done.
const pagePhotographs = assertImagesAreLocal(artifacts['index.html']);

// And what those photographs cost. Every derivative is measured, including the alternatives only
// srcset names, because those are files a real browser downloads. Safe to stat: a derivative
// missing from disk is a reference that does not ship, which the guard above has already thrown
// on by name rather than as an unexplained ENOENT here.
const servedVariants = servedPhotographs().map(({ path }) => ({ path, bytes: statSync(path).size }));

// And what those derivatives are, from their own containers: the ladder's width at the master's
// shape, opaque and single-frame. The generator runs outside the build, so these two are the only
// things here that ever look at a photograph the build did not make.
const measuredPhotographs = assertPhotographsMatchTheirMasters(servedPhotographs(), photographs());
console.log(`photograph geometry  ${measuredPhotographs} derivatives at the ladder's width and their master's shape, opaque, one frame each`);
const heaviest = assertPhotographsWithinBudget(servedVariants, MAX_BYTES);
console.log(`photographs  ${pagePhotographs} in the page from ${photographs().length} masters, ${servedVariants.length} derivatives — heaviest ${heaviest.path} ${Math.round(heaviest.bytes / 1024)} KB of ${MAX_BYTES / 1024} KB`);

const unused = unusedMasters();
console.log(`masters  ${photographs().length} in use${unused.length ? `, ${unused.length} not on the page: ${unused.join(', ')}` : ', all in use'}`);

if (checkOnly) {
  const readIfPresent = name => {
    try {
      return readFileSync(name);
    } catch {
      return null;
    }
  };
  // Compared as bytes, because the icons are buffers while the page and the stylesheet are text —
  // one comparison then covers both, with no second code path to keep in step.
  const asBytes = content => (Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  const stale = Object.entries(artifacts).filter(([name, content]) => {
    const published = readIfPresent(name);
    return published === null || !published.equals(asBytes(content));
  });
  if (stale.length) {
    // The fix command is built from the artifact list, so it cannot drift as files are added.
    const names = stale.map(([name]) => name).join(' ');
    console.error(`\n✗ Out of date with src/: ${names}`);
    console.error(`  These files are generated. Fix with: npm run build && git add ${names}\n`);
    process.exit(1);
  }
  console.log(`\n✓ ${Object.keys(artifacts).join(', ')} match src/`);
} else {
  // The links page is published from a directory of its own, so an artifact's path is not
  // necessarily at the root of the repository.
  for (const [name, content] of Object.entries(artifacts)) {
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, content);
  }
}
