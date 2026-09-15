/**
 * Every assertion the build makes, each one named and callable on its own.
 *
 * They are separate from the assembly in build.js so that a guard can be exercised in
 * isolation, and so a failure names the rule that broke rather than the function it happened
 * to be sitting inside.
 */
import { FAQ_TYPE, ROBOTS_FILE, SITEMAP_FILE, sitemapUrl } from './seo.js';
import { ENTRY_FILES } from './ship.js';
import { esc } from './html.js';

/** Search results truncate past these lengths, silently losing the tail of the copy. */
export const SEARCH_LIMITS = [['title', 60], ['description', 160]];

/**
 * What script.js reads off the runtime-config island. Deliberately a literal rather than
 * `Object.keys(runtime)`: deriving it would let the island and this list agree by
 * construction, so a key dropped from the data would silently strip the consumer's labels
 * instead of failing the build.
 */
export const RUNTIME_KEYS = ['menu', 'success', 'mail'];

/** What a LocalBusiness rich result needs; whatever is absent is named in the failure. */
export const REQUIRED_BUSINESS_FIELDS = [
  '@context', '@type', 'name', 'url', 'telephone', 'email', 'image', 'openingHours', 'hasOfferCatalog',
];

/** Elements that never take a closing tag, so no `</x>` is expected for them. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Text between two literal delimiters, in order. Used to read values out of emitted markup. */
export const between = (text, open, close) =>
  text.split(open).slice(1).map(part => part.slice(0, part.indexOf(close)));

/* --- the content the page is assembled from ----------------------------- */

/**
 * `site.url` must be absolute and must not end in a slash, since every builder appends its
 * own. It may carry a path: a GitHub Pages project site is served from a subdirectory, so an
 * origin-only rule would reject the address the site really has.
 */
export function assertSiteUrl({ url }) {
  if (/^https?:\/\/[^/\s]+(?:\/[^/\s]+)*$/.test(url)) return;
  throw new Error(`site.url must be an absolute http(s) URL with no trailing slash, got: ${url}`);
}

/** Structured data wants E.164; a pretty-printed label in the href breaks it silently. */
export function assertE164Phone({ phone }) {
  if (phone.href.startsWith('tel:+')) return;
  throw new Error(`site.phone.href must be E.164 for structured data (tel:+...), got: ${phone.href}`);
}

/** A title or description past the limit loses its tail in search results. */
export function assertSearchCopyFits(site) {
  const overlong = SEARCH_LIMITS
    .filter(([key, max]) => site[key].length > max)
    .map(([key, max]) => `site.${key} (${site[key].length} > ${max})`);
  if (overlong.length) throw new Error(`SEO copy will be truncated in search results: ${overlong.join(', ')}`);
}

/* --- the markup the page is assembled from ------------------------------ */

/** The sprite is derived from real usage, so an unused symbol cannot survive a build. */
export function assertKnownIcons(markup, icons) {
  const referenced = new Set([...markup.matchAll(/#i-([a-z-]+)/g)].map(match => match[1]));
  const unknown = [...referenced].filter(name => !icons[name]);
  if (unknown.length) throw new Error(`Unknown icons referenced: ${unknown.join(', ')}`);
  return Object.keys(icons).filter(name => referenced.has(name));
}

/**
 * Every booking CTA must point at a service with a matching <option>. This is the drift the
 * shared data model exists to prevent, so the build fails rather than a visitor's click.
 */
export function assertBookingOptionsMatch(markup) {
  const optionLabels = new Set([...markup.matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]));
  const ctaServices = [...new Set([...markup.matchAll(/data-service="([^"]*)"/g)].map(match => match[1]))];
  const orphaned = ctaServices.filter(label => !optionLabels.has(label));
  if (!orphaned.length) return;
  const detail = orphaned
    .map(label => label || '(empty — a cta.serviceId matches no service id in services.items)')
    .join(', ');
  throw new Error(`Booking CTAs point at services with no matching option: ${detail}`);
}

/* --- the stylesheet partials ------------------------------------------- */

/** Partial order is the cascade, so a file that does not sort predictably is rejected. */
export function assertStylePartialsNamed(files) {
  const misnamed = files.filter(name => !/^\d{2}-[a-z0-9-]+\.css$/.test(name));
  if (misnamed.length) {
    throw new Error(`Style partials must be named NN-name.css so order is explicit: ${misnamed.join(', ')}`);
  }
}

/* --- the emitted artifact ---------------------------------------------- */

/**
 * Well-formedness. The drift check cannot tell you this: it compares the artifact against a
 * fresh build, so a tag opened and never closed in the templates produces a matching pair of
 * broken files and passes. A browser will not tell you either, because it closes `<p>`
 * implicitly — which is how ten unclosed paragraphs once reached a public URL unseen.
 *
 * Raw-text elements go first: script and style contents are not markup, and a literal '<'
 * inside them would otherwise be read as a tag. An unterminated one is stripped to the end,
 * which is also where a browser would stop looking.
 */
export function assertHtmlIsWellFormed(html) {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, '');

  const open = [];
  const faults = [];
  for (const [, closing, name, , selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>])*?)(\/?)>/g)) {
    const tag = name.toLowerCase();
    if (closing) {
      const expected = open.pop();
      if (expected !== tag) faults.push(`</${tag}> closes <${expected ?? 'nothing open'}>`);
    } else if (!VOID_ELEMENTS.has(tag) && !selfClosing) {
      open.push(tag);
    }
  }
  if (open.length) faults.push(`unclosed: ${open.map(tag => `<${tag}>`).join(', ')}`);

  if (faults.length) {
    // Report the first fault and how many followed: one unclosed tag cascades into a
    // complaint per element after it, and that list would bury the cause.
    const alsoAfter = faults.length > 1 ? ` (and ${faults.length - 1} more after it)` : '';
    throw new Error(`Emitted HTML is not well-formed: ${faults[0]}${alsoAfter}`);
  }
}

/**
 * Every file the published artifacts point at, as site-root-relative paths.
 *
 * One definition of "referenced", shared by both directions of the ship-set check below: if
 * the two asked the question differently, a file could be called dead weight by one and in
 * use by the other.
 *
 * Three kinds of reference count. `src`/`href` in the page, `url()` in the stylesheet, and
 * meta content naming this site — because the share card lives in an absolute URL in a meta
 * tag and is fetched by no browser request at all, so a scan that read only `src`/`href`
 * would report the site's own social preview as a file nothing uses.
 */
export function referencedFiles({ html, css = '' }, site) {
  const underSite = `${site.url}/`;
  const asPath = value => (value.startsWith(underSite) ? value.slice(underSite.length) : value);
  const values = [
    ...[...html.matchAll(/(?:src|href)="([^"]*)"/g)].map(([, value]) => value),
    ...[...html.matchAll(/content="([^"]*)"/g)]
      .map(([, value]) => value)
      .filter(value => value.startsWith(underSite)),
    ...[...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(([, value]) => value),
  ];
  return new Set(values
    .map(asPath)
    .map(path => path.split(/[?#]/)[0])
    .filter(path => path && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)));
}

/**
 * Every reference must resolve to a file the deploy publishes. Checking the filesystem is not
 * enough: a reference into src/ exists in the repository and would still 404, because only
 * the runtime files are staged.
 */
export function assertReferencesShip(referenced, shipped) {
  const missing = [...referenced].filter(path => !shipped.has(path));
  if (missing.length) throw new Error(`The site references files that do not ship: ${missing.join(', ')}`);
  return referenced.size;
}

/**
 * The other direction: files that are published but that nothing published points at.
 *
 * No visitor pays for them, since no browser requests them — but they are deployed, they are
 * counted in what the site publishes, and no other guard here can see them, because every
 * other check asks whether something that should exist does. This one asks whether something
 * that exists should.
 *
 * Entry files are exempt, being published by convention: the page a visitor lands on is not
 * referenced by anything either.
 *
 * Reported rather than thrown. An unreferenced file is a decision to make — a photograph the
 * client still wants, or a leftover — and a build that refused to run until someone made it
 * would take that decision away by freezing every deploy in the meantime.
 */
export function unreferencedFiles(referenced, shipped) {
  return [...shipped].filter(file => !referenced.has(file) && !ENTRY_FILES.includes(file));
}

/**
 * The share card is named by absolute URL, so the reference guard above cannot see it:
 * nothing on the page ever requests it, which means a renamed or missing file would ship
 * silently and every share would show a broken preview instead of the brand card. Both meta
 * tags are asserted against one value, because a preview where og:image and twitter:image
 * disagree is a preview nobody can predict by reading the markup.
 */
export function assertShareImageShips(html, site, shipped) {
  const expected = `${site.url}/${site.socialImage.file}`;
  const declared = [
    ['og:image', between(html, '<meta property="og:image" content="', '"')[0]],
    ['twitter:image', between(html, '<meta name="twitter:image" content="', '"')[0]],
  ];
  const wrong = declared
    .filter(([, value]) => value !== expected)
    .map(([name, value]) => `${name} is ${value ?? 'missing'}, expected ${expected}`);
  if (wrong.length) {
    throw new Error(`The share image disagrees with site.socialImage: ${wrong.join('; ')}`);
  }
  if (!shipped.has(site.socialImage.file)) {
    throw new Error(`The share image does not ship (${site.socialImage.file}): every share would show a broken preview`);
  }
  if (!between(html, '<meta property="og:image:alt" content="', '"')[0]?.trim()) {
    throw new Error('og:image:alt is empty: the share card would be undescribed');
  }
  return site.socialImage.file;
}

/**
 * Validate every embedded data block exactly as emitted — this catches a broken escape or a
 * stray character in the real artifact, not in the object it came from.
 */
export function assertEmbeddedJsonParses(html) {
  const blocks = [...html.matchAll(/<script type="(application\/json|application\/ld\+json)"[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks.map(([, type, body]) => {
    try {
      return { type, data: JSON.parse(body) };
    } catch (error) {
      throw new Error(`Embedded ${type} block is not valid JSON: ${error.message}`);
    }
  });
}

/** Located by @type rather than by position, so adding another block cannot shift these. */
export function assertRecordPresent(records, type) {
  const record = records.find(node => node['@type'] === type);
  if (!record) throw new Error(`No ${type} structured data block was emitted`);
  return record;
}

export function assertBusinessFields(record) {
  const absent = REQUIRED_BUSINESS_FIELDS.filter(key => !record[key]);
  if (absent.length) throw new Error(`${record['@type']} structured data is missing: ${absent.join(', ')}`);
}

export function assertRuntimeConfigKeys(island) {
  const missing = RUNTIME_KEYS.filter(key => !island?.[key]);
  if (missing.length) {
    throw new Error(`Runtime config island is missing what script.js reads: ${missing.join(', ')}`);
  }
}

/**
 * The visible FAQ and the structured one are both generated, so this compares the two
 * finished artifacts rather than re-reading the source array: if a question is ever
 * hardcoded into a section, or the FAQ markup stops carrying its answers, the page and the
 * markup diverge and this fails instead of shipping the split.
 */
export function assertFaqMatchesPage(html, faqRecord) {
  const renderedQuestions = between(html, '<summary>', '</summary>');
  const renderedAnswers = between(html, '</summary><p>', '</p></details>');
  const structuredQuestions = faqRecord.mainEntity.map(question => esc(question.name));
  const structuredAnswers = faqRecord.mainEntity.map(question => esc(question.acceptedAnswer.text));

  const faults = [];
  if (!structuredQuestions.length) faults.push('it lists no questions');
  if (structuredQuestions.some(text => !text.trim()) || structuredAnswers.some(text => !text.trim())) {
    faults.push('a question or answer is empty');
  }
  if (renderedQuestions.length !== structuredQuestions.length) {
    faults.push(`the page shows ${renderedQuestions.length} questions and the markup lists ${structuredQuestions.length}`);
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
    faults.push(`${label} ${at + 1} differs from the page${alsoAfter ? ` (and ${alsoAfter} more after it)` : ''}`);
  };
  reportMismatch(structuredQuestions, renderedQuestions, 'question');
  reportMismatch(structuredAnswers, renderedAnswers, 'answer');

  if (faults.length) throw new Error(`${FAQ_TYPE} data is out of sync with the page: ${faults.join('; ')}`);
  return structuredQuestions.length;
}

/* --- the files published to crawlers ------------------------------------ */

/**
 * The canonical URL is published in three files, and all three have to agree with site.url:
 * the page's canonical link, the sitemap's <loc>, and the Sitemap line in robots.txt. A
 * stale domain in any one of them sends crawlers somewhere that is not this site, and no
 * file looks wrong on its own — which is why it is asserted rather than assumed.
 */
export function assertPublishedUrlsAgree({ html, sitemap, robots }, site) {
  const pageUrl = `${site.url}/`;
  const locations = between(sitemap, '<loc>', '</loc>');
  const declared = robots.split('\n')
    .filter(line => line.startsWith('Sitemap:'))
    .map(line => line.slice('Sitemap:'.length).trim());

  const claims = [
    ['the canonical link in index.html', between(html, '<link rel="canonical" href="', '"')[0], pageUrl],
    [`the <loc> in ${SITEMAP_FILE}`, locations[0], pageUrl],
    [`the Sitemap line in ${ROBOTS_FILE}`, declared[0], sitemapUrl],
  ];
  const wrong = claims
    .filter(([, found, expected]) => found !== expected)
    .map(([where, found, expected]) => `${where} is ${found ?? 'missing'}, expected ${expected}`);
  if (wrong.length) {
    throw new Error(`Published URLs disagree with site.url (${site.url}): ${wrong.join('; ')}`);
  }

  /** A second <loc> or Sitemap line means a URL nobody reviewed is being advertised. */
  const extra = [
    [SITEMAP_FILE, locations.filter(url => url !== pageUrl)],
    [ROBOTS_FILE, declared.filter(url => url !== sitemapUrl)],
  ].filter(([, urls]) => urls.length);
  if (extra.length) {
    throw new Error(`Unexpected URLs published to crawlers: ${extra
      .map(([file, urls]) => `${file} (${urls.join(', ')})`).join('; ')}`);
  }
}
