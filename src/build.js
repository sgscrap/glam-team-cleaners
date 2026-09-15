import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { site, icons, runtime, ui, business } from './data.js';
import * as sections from './sections.js';
import * as seo from './seo.js';
import { jsonBlock, esc, GENERATED_NOTE } from './html.js';
import { shippedFiles } from './ship.js';
import {
  RUNTIME_KEYS,
  assertBookingOptionsMatch,
  assertBusinessFields,
  assertE164Phone,
  assertEmbeddedJsonParses,
  assertFaqMatchesPage,
  assertHtmlIsWellFormed,
  assertKnownIcons,
  assertPublishedUrlsAgree,
  assertRecordPresent,
  assertReferencesShip,
  assertRuntimeConfigKeys,
  assertSearchCopyFits,
  assertSiteUrl,
  assertStylePartialsNamed,
} from './checks.js';

const checkOnly = process.argv.includes('--check');

/** Check mode verifies rather than writes, so it does not narrate a build it never did. */
const log = checkOnly ? () => {} : console.log;

/* --- index.html --------------------------------------------------------- */

function buildPage() {
  assertSiteUrl(site);
  assertE164Phone(site);
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
  const referenceCount = assertReferencesShip(html, new Set(shippedFiles()));

  const embedded = assertEmbeddedJsonParses(html);
  const records = embedded.filter(block => block.type === 'application/ld+json').map(block => block.data);
  const businessRecord = assertRecordPresent(records, business.type);
  assertBusinessFields(businessRecord);
  const faqRecord = assertRecordPresent(records, seo.FAQ_TYPE);
  assertRuntimeConfigKeys(embedded.find(block => block.type === 'application/json')?.data);
  const questionCount = assertFaqMatchesPage(html, faqRecord);

  log(`index.html  ${html.length} bytes  ${usedIcons.length} icons (${usedIcons.join(', ')})`);
  log(`rendered output  well-formed, ${referenceCount} local references all ship`);
  log(`structured data  ${businessRecord['@type']}  ${businessRecord.openingHours.length} opening-hours rules  ${businessRecord.hasOfferCatalog.itemListElement.length} services`);
  log(`${seo.FAQ_TYPE}  ${questionCount} questions, matched to the rendered page`);
  log(`runtime config  ${RUNTIME_KEYS.join(', ')}`);
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

const artifacts = {
  'index.html': buildPage(),
  'styles.css': buildStyles(),
  [seo.SITEMAP_FILE]: seo.sitemap(),
  [seo.ROBOTS_FILE]: seo.robots(),
};

assertPublishedUrlsAgree({
  html: artifacts['index.html'],
  sitemap: artifacts[seo.SITEMAP_FILE],
  robots: artifacts[seo.ROBOTS_FILE],
}, site);

if (checkOnly) {
  const readIfPresent = name => {
    try {
      return readFileSync(name, 'utf8');
    } catch {
      return null;
    }
  };
  const stale = Object.entries(artifacts).filter(([name, content]) => readIfPresent(name) !== content);
  if (stale.length) {
    // The fix command is built from the artifact list, so it cannot drift as files are added.
    const names = stale.map(([name]) => name).join(' ');
    console.error(`\n✗ Out of date with src/: ${names}`);
    console.error(`  These files are generated. Fix with: npm run build && git add ${names}\n`);
    process.exit(1);
  }
  console.log(`\n✓ ${Object.keys(artifacts).join(', ')} match src/`);
} else {
  for (const [name, content] of Object.entries(artifacts)) writeFileSync(name, content);
}
