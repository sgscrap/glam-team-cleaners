import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { site, icons, runtime, ui, business } from './data.js';
import * as sections from './sections.js';
import * as seo from './seo.js';
import { jsonBlock, esc, GENERATED_NOTE } from './html.js';

const checkOnly = process.argv.includes('--check');

/** Check mode verifies rather than writes, so it does not narrate a build it never did. */
const log = checkOnly ? () => {} : console.log;

/** Text between two literal delimiters, in order. Used to read values out of emitted markup. */
const between = (text, open, close) => text.split(open).slice(1).map(part => part.slice(0, part.indexOf(close)));

/* --- index.html --------------------------------------------------------- */

function buildPage() {
  const main = sections.mainSections.map(render => render()).join('\n');

  /**
   * The sprite is derived from real usage, so an unused symbol cannot survive a build.
   */
  const referenced = new Set([...main.matchAll(/#i-([a-z-]+)/g)].map(match => match[1]));
  const missing = [...referenced].filter(name => !icons[name]);
  if (missing.length) throw new Error(`Unknown icons referenced: ${missing.join(', ')}`);
  const usedIcons = Object.keys(icons).filter(name => referenced.has(name));

  const sprite = `<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">\n${usedIcons.map(name => `<symbol id="i-${name}" viewBox="0 0 24 24">${icons[name]}</symbol>`).join('\n')}\n</svg>`;

  /**
   * Guard: every booking CTA must point at a service that has a matching <option>.
   * This is the drift the shared data model exists to prevent, so fail the build on it.
   */
  const optionLabels = new Set([...main.matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]));
  const ctaServices = [...new Set([...main.matchAll(/data-service="([^"]*)"/g)].map(m => m[1]))];
  const orphaned = ctaServices.filter(label => !optionLabels.has(label));
  if (orphaned.length) {
    const detail = orphaned
      .map(label => label || '(empty — a cta.serviceId matches no service id in services.items)')
      .join(', ');
    throw new Error(`Booking CTAs point at services with no matching option: ${detail}`);
  }

  /**
   * Guards for the machine-readable output. A malformed embedded block or a relative
   * canonical URL fails silently in a browser and only shows up in Search Console weeks
   * later, so both are checked here instead.
   */
  /**
   * `site.url` must be absolute and must not end in a slash, since every builder appends
   * its own. It may carry a path: a GitHub Pages project site is served from a
   * subdirectory, so an origin-only rule would reject the address the site really has.
   */
  if (!/^https?:\/\/[^/\s]+(?:\/[^/\s]+)*$/.test(site.url)) {
    throw new Error(`site.url must be an absolute http(s) URL with no trailing slash, got: ${site.url}`);
  }
  if (!site.phone.href.startsWith('tel:+')) {
    throw new Error(`site.phone.href must be E.164 for structured data (tel:+...), got: ${site.phone.href}`);
  }

  /** Search results truncate past these lengths, so long copy silently loses its tail. */
  const copyLimits = [['site.title', site.title, 60], ['site.description', site.description, 160]];
  const overlong = copyLimits
    .filter(([, text, max]) => text.length > max)
    .map(([field, text, max]) => `${field} (${text.length} > ${max})`);
  if (overlong.length) {
    throw new Error(`SEO copy will be truncated in search results: ${overlong.join(', ')}`);
  }

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

  /**
   * Validate every embedded data block exactly as it was emitted — this catches a broken
   * escape or a stray character in the real artifact, not in the object it came from.
   */
  const blocks = [...html.matchAll(/<script type="(application\/json|application\/ld\+json)"[^>]*>([\s\S]*?)<\/script>/g)];
  const embedded = blocks.map(([, type, body]) => {
    try {
      return { type, data: JSON.parse(body) };
    } catch (error) {
      throw new Error(`Embedded ${type} block is not valid JSON: ${error.message}`);
    }
  });

  // Located by @type rather than by position, so adding another block cannot shift these.
  const records = embedded.filter(block => block.type === 'application/ld+json').map(block => block.data);
  const runtimeConfig = embedded.find(block => block.type === 'application/json')?.data;

  const businessRecord = records.find(node => node['@type'] === business.type);
  const faqRecord = records.find(node => node['@type'] === seo.FAQ_TYPE);
  if (!businessRecord) throw new Error(`No ${business.type} structured data block was emitted`);
  if (!faqRecord) throw new Error(`No ${seo.FAQ_TYPE} structured data block was emitted`);

  const required = ['@context', '@type', 'name', 'url', 'telephone', 'email', 'image', 'openingHours', 'hasOfferCatalog'];
  const absent = required.filter(key => !businessRecord[key]);
  if (absent.length) {
    throw new Error(`LocalBusiness structured data is missing: ${absent.join(', ')}`);
  }

  /** script.js reads these off the island; without them its labels silently stop updating. */
  const runtimeKeys = ['menu', 'success', 'mail'];
  const missingRuntime = runtimeKeys.filter(key => !runtimeConfig?.[key]);
  if (missingRuntime.length) {
    throw new Error(`Runtime config island is missing what script.js reads: ${missingRuntime.join(', ')}`);
  }

  /**
   * The FAQ guard. The visible questions and the structured ones are both generated, so
   * this compares the two finished artifacts rather than re-reading the source array: if a
   * question is ever hardcoded into a section, or the FAQ markup stops carrying its
   * answers, the page and the markup diverge and this fails instead of shipping the split.
   */
  const renderedQuestions = between(html, '<summary>', '</summary>');
  const renderedAnswers = between(html, '</summary><p>', '</p></details>');
  const structuredQuestions = faqRecord.mainEntity.map(question => esc(question.name));
  const structuredAnswers = faqRecord.mainEntity.map(question => esc(question.acceptedAnswer.text));

  const faqFaults = [];
  if (!structuredQuestions.length) faqFaults.push('it lists no questions');
  if (structuredQuestions.some(text => !text.trim()) || structuredAnswers.some(text => !text.trim())) {
    faqFaults.push('a question or answer is empty');
  }
  if (renderedQuestions.length !== structuredQuestions.length) {
    faqFaults.push(`the page shows ${renderedQuestions.length} questions and the markup lists ${structuredQuestions.length}`);
  }
  /**
   * Report where the two sequences first diverge rather than every shifted position: one
   * inserted question misaligns the whole list, and five identical complaints about the
   * cascade would bury the one that matters.
   */
  const reportMismatch = (structured, rendered, label) => {
    const at = structured.findIndex((text, index) => text !== rendered[index]);
    if (at === -1) return;
    const alsoAfter = structured.filter((text, index) => index > at && text !== rendered[index]).length;
    faqFaults.push(`${label} ${at + 1} differs from the page${alsoAfter ? ` (and ${alsoAfter} more after it)` : ''}`);
  };
  reportMismatch(structuredQuestions, renderedQuestions, 'question');
  reportMismatch(structuredAnswers, renderedAnswers, 'answer');
  if (faqFaults.length) {
    throw new Error(`${seo.FAQ_TYPE} data is out of sync with the page: ${faqFaults.join('; ')}`);
  }

  log(`index.html  ${html.length} bytes  ${usedIcons.length} icons (${usedIcons.join(', ')})`);
  log(`structured data  ${businessRecord['@type']}  ${businessRecord.openingHours.length} opening-hours rules  ${businessRecord.hasOfferCatalog.itemListElement.length} services`);
  log(`${seo.FAQ_TYPE}  ${structuredQuestions.length} questions, matched to the rendered page`);
  log(`runtime config  ${runtimeKeys.join(', ')}`);
  return html;
}

/* --- styles.css --------------------------------------------------------- */

function buildStyles() {
  const STYLE_DIR = 'src/styles';
  const styleFiles = readdirSync(STYLE_DIR).filter(name => name.endsWith('.css')).sort();
  const misnamed = styleFiles.filter(name => !/^\d{2}-[a-z0-9-]+\.css$/.test(name));
  if (misnamed.length) {
    throw new Error(`Style partials must be named NN-name.css so order is explicit: ${misnamed.join(', ')}`);
  }

  // Normalize CRLF so an editor on Windows cannot rewrite every line of the artifact.
  const partials = styleFiles
    .map(name => readFileSync(`${STYLE_DIR}/${name}`, 'utf8').replace(/\r\n/g, '\n'))
    .join('');

  log(`styles.css  ${partials.length} chars  ${styleFiles.length} partials in order`);
  return `/* ${GENERATED_NOTE} Built from ${STYLE_DIR}/*.css in order. */\n${partials}`;
}

/* --- crawler files ------------------------------------------------------ */

/**
 * The canonical URL is published in three files, and all three have to agree with site.url:
 * the page's canonical link, the sitemap's <loc>, and the Sitemap line in robots.txt. A
 * stale domain in any one of them sends crawlers somewhere that is not this site, and no
 * file looks wrong on its own — which is why it is asserted rather than assumed.
 */
function assertPublishedUrlsAgree({ html, sitemap, robots }) {
  const pageUrl = `${site.url}/`;
  const locations = between(sitemap, '<loc>', '</loc>');
  const declared = robots.split('\n')
    .filter(line => line.startsWith('Sitemap:'))
    .map(line => line.slice('Sitemap:'.length).trim());

  const claims = [
    ['the canonical link in index.html', between(html, '<link rel="canonical" href="', '"')[0], pageUrl],
    [`the <loc> in ${seo.SITEMAP_FILE}`, locations[0], pageUrl],
    [`the Sitemap line in ${seo.ROBOTS_FILE}`, declared[0], seo.sitemapUrl],
  ];
  const wrong = claims
    .filter(([, found, expected]) => found !== expected)
    .map(([where, found, expected]) => `${where} is ${found ?? 'missing'}, expected ${expected}`);
  if (wrong.length) {
    throw new Error(`Published URLs disagree with site.url (${site.url}): ${wrong.join('; ')}`);
  }

  /** A second <loc> or Sitemap line means a URL nobody reviewed is being advertised. */
  const extra = [
    [seo.SITEMAP_FILE, locations.filter(url => url !== pageUrl)],
    [seo.ROBOTS_FILE, declared.filter(url => url !== seo.sitemapUrl)],
  ].filter(([, urls]) => urls.length);
  if (extra.length) {
    throw new Error(`Unexpected URLs published to crawlers: ${extra
      .map(([file, urls]) => `${file} (${urls.join(', ')})`).join('; ')}`);
  }

  log(`crawl files  ${seo.SITEMAP_FILE} + ${seo.ROBOTS_FILE} agree on ${pageUrl}`);
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
});

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
