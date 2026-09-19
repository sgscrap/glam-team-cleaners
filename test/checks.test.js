/**
 * Every guard in src/checks.js, exercised in the direction the build never exercises it.
 *
 * `npm run check` runs these guards against content the build has just accepted, so it can
 * only ever prove that a guard passes. A guard that has stopped guarding — a regex that now
 * matches everything, a comparison that can no longer fail, a clause that a refactor made
 * unreachable — passes forever and is indistinguishable from a no-op. The negative case is
 * the one that has to be asserted, and this is where it lives.
 *
 * The accepting cases lean on the real project content rather than fixtures, so a guard whose
 * rule has drifted out of step with the site fails here as well as in the build.
 *
 * node:test and node:assert, so there is still nothing to install.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

import * as checks from '../src/checks.js';
import * as seo from '../src/seo.js';
import { site, business, icons, runtime, faqs } from '../src/data.js';
import { SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource } from '../src/social-card.js';
import { esc } from '../src/html.js';
import { ENTRY_FILES, shippedFiles } from '../src/ship.js';
import { MAX_BYTES, servedPhotographs } from '../src/photos.js';
import { BRAND_MARK, BRAND_MARK_STYLESHEET, ICON_FILES, ICON_LINKS } from '../src/favicon.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const indexHtml = read('index.html');
const stylesCss = read('styles.css');
const partials = readdirSync(new URL('../src/styles', import.meta.url));
const socialCard = readFileSync(new URL('../assets/social-preview.png', import.meta.url));
const portrait = readFileSync(new URL('../photos/emely/emely-01.png', import.meta.url));
const shipped = new Set(shippedFiles());
const pageUrl = `${site.url}/`;
const headerCss = read(BRAND_MARK_STYLESHEET);
const svgIcon = read(ICON_FILES.svg);

/**
 * The host this site was published from before it moved to its own domain, spelled here as a
 * literal rather than read from `checks.RETIRED_HOSTS`. If someone empties that list, these
 * cases must still fail — a test that asked the guard what it considers retired could only ever
 * agree with it, which is the shape of test that lets a rule quietly stop ruling.
 */
const retiredHost = 'https://sgscrap.github.io';

/**
 * A PNG with one text chunk and nothing else, so the reader can be exercised on structures the
 * real card does not happen to contain — malformed provenance above all. Chunk CRCs and the
 * IHDR body are left as zeroes: the reader is not a validator, and pretending otherwise would
 * only test this helper.
 */
const pngChunk = (type, data) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, Buffer.from(data), Buffer.alloc(4)]);
};
const pngWithProvenance = text => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', Buffer.alloc(13)),
  // iTXt: keyword \0 flags method language \0 translated \0 text, uncompressed
  pngChunk('iTXt', Buffer.concat([
    Buffer.from(SOCIAL_CARD_PROVENANCE_KEYWORD, 'latin1'),
    Buffer.alloc(5),
    Buffer.from(text, 'utf8'),
  ])),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const records = checks.assertEmbeddedJsonParses(indexHtml);
const blocks = records.map(({ data }) => data);
const businessRecord = checks.assertRecordPresent(blocks, business.type);

/** The FAQ markup as the sections render it, from the same data the structured copy uses. */
const faqHtml = items => items
  .map(({ q, a }) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
  .join('\n');
const faqCount = faqs.items.length;

/**
 * Cases for every exported function in checks.js. `accepts` must not throw — `expect` gets
 * the return value where the guard publishes one. `rejects` must throw a message matching its
 * pattern: asserting that something threw is not enough, since a guard can throw for a reason
 * it does not exist to report.
 */
const CASES = [
  {
    guard: 'between',
    accepts: [
      { why: 'text between two delimiters', run: () => checks.between('<a>1</a> <a>2</a>', '<a>', '</a>'), expect: found => assert.deepEqual(found, ['1', '2']) },
      { why: 'text without the delimiters', run: () => checks.between('<p>x</p>', '<a>', '</a>'), expect: found => assert.deepEqual(found, []) },
    ],
  },
  {
    guard: 'referencedFiles',
    accepts: [
      {
        why: 'the real page and stylesheet',
        run: () => checks.referencedFiles({ html: indexHtml, css: stylesCss }, site),
        expect: found => {
          for (const expected of ['styles.css', 'script.js', site.socialImage.file]) {
            assert.ok(found.has(expected), `expected the site to reference ${expected}`);
          }
          // Every candidate the browser can fetch counts, including the smaller ones only srcset
          // names: a scan that read `src` alone would call them dead weight and never notice one
          // that had been deleted.
          for (const { path } of servedPhotographs()) {
            assert.ok(found.has(path), `expected the srcset candidate ${path} to be a reference`);
          }
        },
      },
      {
        why: 'src, srcset candidates, href, stylesheet url() and site meta URLs',
        run: () => checks.referencedFiles({
          html: '<link rel=stylesheet href="styles.css"><script src="script.js?v=2"></script><img src="assets/a.png" srcset="assets/a-480.png 480w, assets/a-960.png 960w"><a href="#x">a</a><a href="tel:+1555">b</a><a href="https://elsewhere.test/p">c</a><meta property="og:image" content="https://site.test/app/assets/card.png"><meta property="og:image:alt" content="prose that is not a path"><link rel="canonical" href="https://site.test/app/">',
          css: `.a{background:url('assets/bg.png')} .b{background:url(assets/plain.png)} .c{background:url(https://cdn.test/f.woff2)}`,
        }, { url: 'https://site.test/app' }),
        expect: found => assert.deepEqual([...found].sort(), ['assets/a-480.png', 'assets/a-960.png', 'assets/a.png', 'assets/bg.png', 'assets/card.png', 'assets/plain.png', 'script.js', 'styles.css']),
      },
      { why: 'a page with no references at all', run: () => checks.referencedFiles({ html: '' }, site), expect: found => assert.equal(found.size, 0) },
    ],
  },
  {
    guard: 'assertReferencesShip',
    accepts: [
      {
        why: 'the real page and stylesheet against the real published set',
        run: () => checks.assertReferencesShip(checks.referencedFiles({ html: indexHtml, css: stylesCss }, site), shipped),
        expect: count => assert.ok(count > 0),
      },
    ],
    rejects: [
      ['a reference to a file that is not published', () => checks.assertReferencesShip(new Set(['src/data.js']), shipped), /do not ship: src\/data\.js/],
    ],
  },
  {
    guard: 'unreferencedFiles',
    accepts: [
      {
        why: 'the real published set',
        run: () => checks.unreferencedFiles(checks.referencedFiles({ html: indexHtml, css: stylesCss }, site), shipped),
        expect: found => found.forEach(file => assert.ok(!ENTRY_FILES.includes(file), `${file} is published by convention`)),
      },
      {
        why: 'a file nothing points at',
        run: () => checks.unreferencedFiles(new Set(['styles.css']), new Set(['index.html', 'sitemap.xml', 'robots.txt', 'styles.css', 'assets/dead.png'])),
        expect: found => assert.deepEqual(found, ['assets/dead.png']),
      },
      {
        why: 'a set where everything is referenced or published by convention',
        run: () => checks.unreferencedFiles(new Set(['styles.css']), new Set(['index.html', 'sitemap.xml', 'robots.txt', 'styles.css'])),
        expect: found => assert.deepEqual(found, []),
      },
    ],
  },
  {
    guard: 'assertImagesAreLocal',
    accepts: [
      {
        why: 'the real page',
        run: () => checks.assertImagesAreLocal(indexHtml),
        expect: count => assert.ok(count > 0, 'the page still shows photographs of its own'),
      },
      { why: 'a page with no images at all', run: () => checks.assertImagesAreLocal('<p>text</p>'), expect: count => assert.equal(count, 0) },
    ],
    rejects: [
      ['a photograph rented from a stock library', () => checks.assertImagesAreLocal('<img src="https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=1300" alt="Somebody else&#39;s kitchen">'), /loads pictures from another site.*images\.unsplash\.com/],
      ['a protocol-relative URL', () => checks.assertImagesAreLocal('<img src="//cdn.test/room.png" alt="A room">'), /loads pictures from another site.*cdn\.test/],
    ],
  },
  {
    guard: 'assertPhotographsWithinBudget',
    accepts: [
      {
        why: 'the real derivatives against the real budget',
        run: () => checks.assertPhotographsWithinBudget(
          servedPhotographs().map(({ path }) => ({ path, bytes: statSync(new URL(`../${path}`, import.meta.url)).size })),
          MAX_BYTES,
        ),
        expect: heaviest => assert.ok(heaviest.bytes > 0 && heaviest.bytes <= MAX_BYTES),
      },
      {
        why: 'nothing to measure',
        run: () => checks.assertPhotographsWithinBudget([], MAX_BYTES),
        expect: heaviest => assert.equal(heaviest.bytes, 0),
      },
    ],
    rejects: [
      ['a photograph over the budget', () => checks.assertPhotographsWithinBudget([{ path: 'assets/emely/emely-01-587.webp', bytes: MAX_BYTES + 1 }], MAX_BYTES), /over the 120 KB budget: assets\/emely\/emely-01-587\.webp \(120 KB\)/],
      ['the heaviest named first', () => checks.assertPhotographsWithinBudget([{ path: 'a.webp', bytes: MAX_BYTES + 1024 }, { path: 'b.webp', bytes: MAX_BYTES * 3 }], MAX_BYTES), /budget: b\.webp \(360 KB\), a\.webp \(121 KB\)/],
      ['one over budget among several that fit', () => checks.assertPhotographsWithinBudget([{ path: 'a.webp', bytes: 10 }, { path: 'b.webp', bytes: MAX_BYTES * 2 }], MAX_BYTES), /budget: b\.webp \(240 KB\)/],
    ],
  },
  {
    guard: 'assertHookNeedsNoInstall',
    accepts: [
      {
        why: 'the committed pre-commit hook',
        run: () => checks.assertHookNeedsNoInstall(read('.githooks/pre-commit')),
        expect: scripts => {
          assert.deepEqual(scripts, ['src/build.js', 'scripts/test.js'], 'the hook runs the drift check and the guard suite');
          for (const script of scripts) {
            assert.ok(existsSync(new URL(`../${script}`, import.meta.url)), `${script} is missing`);
          }
        },
      },
      {
        why: 'a hook that names npm in a comment and in a message but runs only node',
        run: () => checks.assertHookNeedsNoInstall('# install with npm install\nnode scripts/test.js\necho "run npm test for detail"'),
        expect: scripts => assert.deepEqual(scripts, ['scripts/test.js']),
      },
    ],
    rejects: [
      ['a hook that shells out to a package manager', () => checks.assertHookNeedsNoInstall('#!/bin/sh\nnpm run check'), /runs npm, so it needs something installed/],
      ['a hook that reaches into node_modules', () => checks.assertHookNeedsNoInstall('#!/bin/sh\nnode_modules/.bin/prettier --check .'), /reaches into node_modules/],
      ['a hook reduced to exiting clean', () => checks.assertHookNeedsNoInstall('#!/bin/sh\nexit 0'), /runs no node script/],
      ['an empty hook file', () => checks.assertHookNeedsNoInstall(''), /runs no node script/],
    ],
  },
  {
    guard: 'assertSiteUrl',
    accepts: [
      { why: 'the real site URL', run: () => checks.assertSiteUrl(site) },
      { why: 'a project-site URL carrying a path', run: () => checks.assertSiteUrl({ url: 'https://org.github.io/repo' }) },
    ],
    rejects: [
      ['a trailing slash', () => checks.assertSiteUrl({ url: `${site.url}/` }), /no trailing slash/],
      ['a path without a leading slash', () => checks.assertSiteUrl({ url: 'https://x.test repo' }), /no trailing slash/],
      ['a relative path', () => checks.assertSiteUrl({ url: '/repo' }), /no trailing slash/],
      ['a non-http scheme', () => checks.assertSiteUrl({ url: 'ftp://x.test/repo' }), /no trailing slash/],
      ['an empty value', () => checks.assertSiteUrl({ url: '' }), /no trailing slash/],
      ['a space in the host', () => checks.assertSiteUrl({ url: 'https://a b.test' }), /no trailing slash/],
    ],
  },
  {
    guard: 'assertE164Phone',
    accepts: [{ why: 'the real phone number', run: () => checks.assertE164Phone(site) }],
    rejects: [
      ['a formatted label instead of E.164', () => checks.assertE164Phone({ phone: { href: 'tel:(555) 014-7826' } }), /must be E\.164/],
      ['a href with no tel: scheme', () => checks.assertE164Phone({ phone: { href: '+15550147826' } }), /must be E\.164/],
    ],
  },
  {
    guard: 'assertSearchCopyFits',
    accepts: [{ why: 'the real title and description', run: () => checks.assertSearchCopyFits(site) }],
    rejects: [
      ['a title past the search limit', () => checks.assertSearchCopyFits({ ...site, title: 't'.repeat(61) }), /SEO copy will be truncated/],
      ['a description past the search limit', () => checks.assertSearchCopyFits({ ...site, description: 'd'.repeat(161) }), /SEO copy will be truncated/],
    ],
  },
  {
    guard: 'assertKnownIcons',
    accepts: [
      {
        why: 'the real page',
        run: () => checks.assertKnownIcons(indexHtml, icons),
        expect: used => {
          assert.ok(used.length > 0);
          used.forEach(name => assert.ok(icons[name], `${name} is not in the sprite`));
        },
      },
      { why: 'a sprite symbol the page uses', run: () => checks.assertKnownIcons('<use href="#i-shield">', icons), expect: used => assert.deepEqual(used, ['shield']) },
      { why: 'a page with no icons', run: () => checks.assertKnownIcons('<p>text</p>', icons), expect: used => assert.deepEqual(used, []) },
    ],
    rejects: [
      ['a symbol that is not in the sprite', () => checks.assertKnownIcons('<use href="#i-nope">', icons), /Unknown icons referenced: nope/],
    ],
  },
  {
    guard: 'assertBookingOptionsMatch',
    accepts: [
      { why: 'the real page', run: () => checks.assertBookingOptionsMatch(indexHtml) },
      { why: 'a CTA whose service matches an option', run: () => checks.assertBookingOptionsMatch('<option>Deep clean</option><a data-service="Deep clean">x</a>') },
    ],
    rejects: [
      ['a CTA pointing at a service with no option', () => checks.assertBookingOptionsMatch('<option>Deep clean</option><a data-service="Nope">x</a>'), /no matching option: Nope/],
      ['a CTA whose service id resolved to nothing', () => checks.assertBookingOptionsMatch('<option>Deep clean</option><a data-service="">x</a>'), /empty — a cta\.serviceId/],
    ],
  },
  {
    guard: 'assertStylePartialsNamed',
    accepts: [{ why: 'the real partial names', run: () => checks.assertStylePartialsNamed(partials) }],
    rejects: [
      ['a partial with no order prefix', () => checks.assertStylePartialsNamed(['01-tokens.css', 'base.css']), /must be named NN-name\.css so order is explicit: base\.css/],
      ['a partial numbered with one digit', () => checks.assertStylePartialsNamed(['1-tokens.css']), /must be named NN-name\.css/],
    ],
  },
  {
    guard: 'assertHtmlIsWellFormed',
    accepts: [
      { why: 'the real page', run: () => checks.assertHtmlIsWellFormed(indexHtml) },
      { why: 'void elements and self-closing tags', run: () => checks.assertHtmlIsWellFormed('<img src="a.png"><br><use href="#i-x"/><input type="text">') },
      { why: 'a literal < inside a script block', run: () => checks.assertHtmlIsWellFormed('<script>if (a < b && c > d) {}</script><p>ok</p>') },
      { why: 'a comment containing markup', run: () => checks.assertHtmlIsWellFormed('<!-- <p>unclosed --> <p>ok</p>') },
    ],
    rejects: [
      ['a closing tag that closes the wrong element', () => checks.assertHtmlIsWellFormed('<div><p>hi</div>'), /<\/div> closes <p>/],
      ['an element left open at the end', () => checks.assertHtmlIsWellFormed('<div><p>hi'), /unclosed: <div>, <p>/],
      ['a closing tag with nothing open', () => checks.assertHtmlIsWellFormed('</div>'), /closes <nothing open>/],
      ['the unclosed paragraph that once reached production', () => checks.assertHtmlIsWellFormed('<p class="eyebrow">A better kind of clean'), /unclosed: <p>/],
    ],
  },
  {
    guard: 'assertShareImageShips',
    accepts: [
      {
        why: 'the real page, site and published set',
        run: () => checks.assertShareImageShips(indexHtml, site, shipped),
        expect: file => assert.equal(file, site.socialImage.file),
      },
    ],
    rejects: [
      ['a twitter:image that drifted from og:image', () => checks.assertShareImageShips(indexHtml.replace(`<meta name="twitter:image" content="${site.url}/${site.socialImage.file}">`, '<meta name="twitter:image" content="https://x.test/old.png">'), site, shipped), /disagrees with site\.socialImage: twitter:image is/],
      ['an og:image that drifted from the data', () => checks.assertShareImageShips(indexHtml.replace(`<meta property="og:image" content="${site.url}/${site.socialImage.file}">`, '<meta property="og:image" content="https://images.unsplash.com/photo-1">'), site, shipped), /disagrees with site\.socialImage: og:image is/],
      ['a share image that does not ship', () => checks.assertShareImageShips(indexHtml, site, new Set(['index.html'])), /The share image does not ship/],
      ['an og:image:alt emptied out', () => checks.assertShareImageShips(indexHtml.replace(`<meta property="og:image:alt" content="${site.socialImage.alt}">`, '<meta property="og:image:alt" content="  ">'), site, shipped), /og:image:alt is empty/],
    ],
  },
  {
    guard: 'readPngText',
    accepts: [
      {
        why: 'the real card under its own keyword',
        run: () => checks.readPngText(socialCard, SOCIAL_CARD_PROVENANCE_KEYWORD),
        expect: found => assert.ok(JSON.parse(found).source.lead, 'the provenance should carry the copy'),
      },
      { why: 'a PNG under a keyword it does not carry', run: () => checks.readPngText(socialCard, 'some-other-keyword'), expect: found => assert.equal(found, null) },
      { why: 'a PNG with no text chunks at all', run: () => checks.readPngText(portrait, SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, null) },
      { why: 'a file that is not a PNG', run: () => checks.readPngText(Buffer.from(indexHtml), SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, null) },
      { why: 'nothing at all', run: () => checks.readPngText(null, SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, null) },
      { why: 'the PNG signature and nothing after it', run: () => checks.readPngText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, null) },
      { why: 'a chunk header cut short', run: () => checks.readPngText(socialCard.subarray(0, 40), SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, null) },
      { why: 'a hand-built uncompressed iTXt chunk', run: () => checks.readPngText(pngWithProvenance('{"hello":"world"}'), SOCIAL_CARD_PROVENANCE_KEYWORD), expect: found => assert.equal(found, '{"hello":"world"}') },
    ],
  },
  {
    guard: 'assertSocialCardMatchesCopy',
    accepts: [
      {
        why: 'the real card and the copy it was built from',
        run: () => checks.assertSocialCardMatchesCopy(socialCard, SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource()),
        expect: count => assert.equal(count, Object.keys(socialCardSource()).length),
      },
    ],
    rejects: [
      ['copy that has moved on since the card was built', () => checks.assertSocialCardMatchesCopy(socialCard, SOCIAL_CARD_PROVENANCE_KEYWORD, { ...socialCardSource(), lead: 'Spotlessly yours.' }), /lead is now "Spotlessly yours.", the card was built from "Beautifully clean."/],
      ['a tagline the card never saw', () => checks.assertSocialCardMatchesCopy(socialCard, SOCIAL_CARD_PROVENANCE_KEYWORD, { ...socialCardSource(), tagline: 'Something else entirely.' }), /tagline is now/],
      ['a portrait the card does not use', () => checks.assertSocialCardMatchesCopy(socialCard, SOCIAL_CARD_PROVENANCE_KEYWORD, { ...socialCardSource(), portrait: 'photos/emely/emely-03.png' }), /portrait is now "photos\/emely\/emely-03\.png"/],
      ['a card with no provenance at all', () => checks.assertSocialCardMatchesCopy(portrait, SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource()), /carries no provenance under "social-preview-source"/],
      ['a card whose provenance was stripped by an editor', () => checks.assertSocialCardMatchesCopy(Buffer.from(indexHtml), SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource()), /Regenerate it: npm run social/],
      ['provenance that is not valid JSON', () => checks.assertSocialCardMatchesCopy(pngWithProvenance('{not json'), SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource()), /provenance is not valid JSON/],
      ['provenance with no source recorded in it', () => checks.assertSocialCardMatchesCopy(pngWithProvenance('{"format":1}'), SOCIAL_CARD_PROVENANCE_KEYWORD, socialCardSource()), /the card was built from null/],
    ],
  },
  {
    guard: 'assertEmbeddedJsonParses',
    accepts: [
      {
        why: 'the real page',
        run: () => checks.assertEmbeddedJsonParses(indexHtml),
        expect: found => {
          assert.equal(found.filter(({ type }) => type === 'application/ld+json').length, 2);
          assert.equal(found.filter(({ type }) => type === 'application/json').length, 1);
        },
      },
      { why: 'a page with no data blocks', run: () => checks.assertEmbeddedJsonParses('<p>text</p>'), expect: found => assert.deepEqual(found, []) },
    ],
    rejects: [
      ['a truncated ld+json block', () => checks.assertEmbeddedJsonParses('<script type="application/ld+json">{"a":1</script>'), /Embedded application\/ld\+json block is not valid JSON/],
      ['a broken escape in the runtime island', () => checks.assertEmbeddedJsonParses('<script type="application/json">{"menu":"a\\q"}</script>'), /Embedded application\/json block is not valid JSON/],
    ],
  },
  {
    guard: 'assertRecordPresent',
    accepts: [
      { why: 'the real LocalBusiness record', run: () => checks.assertRecordPresent(blocks, business.type), expect: record => assert.equal(record.name, site.name) },
    ],
    rejects: [
      ['a record type that was never emitted', () => checks.assertRecordPresent([{ '@type': 'Thing' }], 'FAQPage'), /No FAQPage structured data block was emitted/],
      ['no blocks at all', () => checks.assertRecordPresent([], 'FAQPage'), /No FAQPage structured data block was emitted/],
    ],
  },
  {
    guard: 'assertBusinessFields',
    accepts: [{ why: 'the real record', run: () => checks.assertBusinessFields(businessRecord) }],
    rejects: [
      ['a record missing most of what a rich result needs', () => checks.assertBusinessFields({ '@type': 'LocalBusiness', name: 'x' }), /LocalBusiness structured data is missing: /],
      ['a record whose fields are present but empty', () => checks.assertBusinessFields({ ...businessRecord, telephone: '' }), /missing: telephone/],
    ],
  },
  {
    guard: 'assertRuntimeConfigKeys',
    accepts: [{ why: 'the real runtime config', run: () => checks.assertRuntimeConfigKeys(runtime) }],
    rejects: [
      ['an island that was never emitted', () => checks.assertRuntimeConfigKeys(undefined), /missing what script\.js reads: menu, success, mail/],
      ['an island missing one key', () => checks.assertRuntimeConfigKeys({ menu: {}, success: {} }), /missing what script\.js reads: mail/],
    ],
  },
  {
    guard: 'assertFaqMatchesPage',
    accepts: [
      { why: 'the real questions and answers', run: () => checks.assertFaqMatchesPage(faqHtml(faqs.items), seo.faqPage()), expect: count => assert.equal(count, faqCount) },
    ],
    rejects: [
      ['a page showing fewer questions than the markup lists', () => checks.assertFaqMatchesPage(faqHtml(faqs.items.slice(1)), seo.faqPage()), new RegExp(`the page shows ${faqCount - 1} questions and the markup lists ${faqCount}`)],
      ['a page showing no questions at all', () => checks.assertFaqMatchesPage('', seo.faqPage()), /the page shows 0 questions/],
      ['a question that differs from the one on the page', () => checks.assertFaqMatchesPage(faqHtml([{ q: 'A question the markup does not know', a: faqs.items[0].a }, ...faqs.items.slice(1)]), seo.faqPage()), /question 1 differs from the page/],
      ['a diverging answer', () => checks.assertFaqMatchesPage(faqHtml([{ q: faqs.items[0].q, a: 'An answer nobody wrote' }, ...faqs.items.slice(1)]), seo.faqPage()), /answer 1 differs from the page/],
      ['structured data listing no questions', () => checks.assertFaqMatchesPage(faqHtml(faqs.items), { '@type': seo.FAQ_TYPE, mainEntity: [] }), /it lists no questions/],
    ],
  },
  {
    guard: 'assertPublishedUrlsAgree',
    accepts: [
      { why: 'the real page, sitemap and robots', run: () => checks.assertPublishedUrlsAgree({ html: indexHtml, sitemap: seo.sitemap(), robots: seo.robots() }, site) },
    ],
    rejects: [
      ['a canonical link pointing at an old domain', () => checks.assertPublishedUrlsAgree({ html: indexHtml.replace(`<link rel="canonical" href="${pageUrl}">`, '<link rel="canonical" href="https://old.example/">'), sitemap: seo.sitemap(), robots: seo.robots() }, site), /the canonical link in index\.html is https:\/\/old\.example\//],
      ['a stale <loc> in the sitemap', () => checks.assertPublishedUrlsAgree({ html: indexHtml, sitemap: seo.sitemap().replace(`<loc>${pageUrl}</loc>`, '<loc>https://old.example/</loc>'), robots: seo.robots() }, site), /the <loc> in sitemap\.xml is https:\/\/old\.example\//],
      ['a stale Sitemap line in robots.txt', () => checks.assertPublishedUrlsAgree({ html: indexHtml, sitemap: seo.sitemap(), robots: seo.robots().replace(seo.sitemapUrl, 'https://old.example/sitemap.xml') }, site), /the Sitemap line in robots\.txt is https:\/\/old\.example\/sitemap\.xml/],
      ['a second <loc> nobody reviewed', () => checks.assertPublishedUrlsAgree({ html: indexHtml, sitemap: seo.sitemap().replace('</urlset>', '<url><loc>https://elsewhere.test/</loc></url>\n</urlset>'), robots: seo.robots() }, site), /Unexpected URLs published to crawlers: sitemap\.xml/],
      ['a missing canonical link', () => checks.assertPublishedUrlsAgree({ html: indexHtml.replace(`<link rel="canonical" href="${pageUrl}">`, ''), sitemap: seo.sitemap(), robots: seo.robots() }, site), /the canonical link in index\.html is missing/],
    ],
  },
  {
    guard: 'assertIconsMatchBrandMark',
    accepts: [
      { why: 'the real stylesheet and the icons generated from it', run: () => checks.assertIconsMatchBrandMark(headerCss, BRAND_MARK), expect: count => assert.equal(count, 11) },
    ],
    rejects: [
      ['a bar whose height changed in the stylesheet', () => checks.assertIconsMatchBrandMark(headerCss.replace('.brand-mark i:nth-child(2) { height: 25px;', '.brand-mark i:nth-child(2) { height: 24px;'), BRAND_MARK), /the height of bar 2 is 24 in src\/styles\/03-header\.css and 25 in the icons/],
      ['a wider bar', () => checks.assertIconsMatchBrandMark(headerCss.replace('.brand-mark i { display: block; width: 7px;', '.brand-mark i { display: block; width: 8px;'), BRAND_MARK), /the bar width is 8 in/],
      ['a different gap between the bars', () => checks.assertIconsMatchBrandMark(headerCss.replace('align-items: flex-end; gap: 2px;', 'align-items: flex-end; gap: 3px;'), BRAND_MARK), /the gap between the bars is 3 in/],
      ['the rose moving to another bar', () => checks.assertIconsMatchBrandMark(headerCss.replace('.brand-mark i:nth-child(2) { height: 25px; background: var(--rose); }', '.brand-mark i:nth-child(2) { height: 25px; }').replace('.brand-mark i:nth-child(3) { height: 19px; }', '.brand-mark i:nth-child(3) { height: 19px; background: var(--rose); }'), BRAND_MARK), /which bar is rose is 3 in/],
      ['a height that is no longer a px value', () => checks.assertIconsMatchBrandMark(headerCss.replace('.brand-mark i:nth-child(1) { height: 14px; }', '.brand-mark i:nth-child(1) { height: 0.9rem; }'), BRAND_MARK), /the height of bar 1 is not a plain px value in/],
      ['a rule that has gone', () => checks.assertIconsMatchBrandMark(headerCss.replace('.brand-mark i:nth-child(3) { height: 19px; }\n', ''), BRAND_MARK), /no longer declares bar 3/],
      ['a border-radius the icons cannot mirror', () => checks.assertIconsMatchBrandMark(headerCss.replace('border-radius: 5px 5px 1px 1px;', 'border-radius: 5px 2px 1px;'), BRAND_MARK), /3-value shorthand/],
      ['the ground corner rounded differently in the stylesheet', () => checks.assertIconsMatchBrandMark(headerCss.replace('--icon-radius: 25%;', '--icon-radius: 20%;'), BRAND_MARK), /the ground corner, as a share of the mark box is 20 in src\/styles\/03-header\.css and 25 in the icons/],
      ['a ground corner that is no longer a share', () => checks.assertIconsMatchBrandMark(headerCss.replace('--icon-radius: 25%;', '--icon-radius: 14px;'), BRAND_MARK), /declares no --icon-radius as a percentage/],
      ['a declaration that has gone', () => checks.assertIconsMatchBrandMark(headerCss.replace(' --icon-radius: 25%;', ''), BRAND_MARK), /declares no --icon-radius as a percentage on \.brand-mark/],
    ],
  },
  {
    guard: 'assertRetiredHostsAbsent',
    accepts: [
      { why: 'the published page, sitemap and robots', run: () => checks.assertRetiredHostsAbsent({ html: indexHtml, sitemap: seo.sitemap(), robots: seo.robots() }) },
    ],
    rejects: [
      ['the retired host in the canonical link', () => checks.assertRetiredHostsAbsent({ html: indexHtml.replace(pageUrl, `${retiredHost}/glam-team-cleaners/`), sitemap: seo.sitemap(), robots: seo.robots() }), /still name a retired host/],
      ['the retired host in a sitemap <loc>', () => checks.assertRetiredHostsAbsent({ html: indexHtml, sitemap: seo.sitemap().replace(pageUrl, `${retiredHost}/glam-team-cleaners/`), robots: seo.robots() }), /sitemap\.xml/],
      ['the retired host in the Sitemap line of robots.txt', () => checks.assertRetiredHostsAbsent({ html: indexHtml, sitemap: seo.sitemap(), robots: seo.robots().replace(seo.sitemapUrl, `${retiredHost}/glam-team-cleaners/${seo.SITEMAP_FILE}`) }), /robots\.txt/],
      ['the retired host only in the share card URL', () => checks.assertRetiredHostsAbsent({ html: indexHtml.replace(`<meta property="og:image" content="${pageUrl}${site.socialImage.file}">`, `<meta property="og:image" content="${retiredHost}/glam-team-cleaners/${site.socialImage.file}">`), sitemap: seo.sitemap(), robots: seo.robots() }), /still name a retired host/],
    ],
  },
  {
    guard: 'assertFaviconAdaptsToDarkScheme',
    accepts: [
      { why: 'the published vector icon', run: () => checks.assertFaviconAdaptsToDarkScheme(svgIcon), expect: count => assert.equal(count, 1) },
    ],
    rejects: [
      ['an icon with no dark-scheme rule at all', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace(/<style>[\s\S]*?<\/style>\n/, '')), /no longer carries a dark-scheme rule/],
      ['a dark-scheme rule that recolours the ground instead of dropping it', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace('{ fill: none; }', '{ fill: #fcfaf6; }')), /Only the ground's fill may vary with the colour scheme, and in assets\/favicon\.svg the dark-scheme rule changes \.ground \{ fill: #fcfaf6 \}/],
      ['a dark-scheme rule that recolours a bar', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace('{ fill: none; }', '{ fill: none; } .bar { fill: #2c1d20; }')), /changes \.ground \{ fill: none \}, \.bar \{ fill: #2c1d20 \}/],
      ['a ground that varies by more than its fill', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace('{ fill: none; }', '{ fill: none; opacity: 0; }')), /changes \.ground \{ fill: none; opacity: 0 \}/],
      ['a rule whose ground is gone from the markup', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace(' class="ground"', '')), /is inert: no element carries class="ground"/],
      ['a rule left outside a style element', () => checks.assertFaviconAdaptsToDarkScheme(svgIcon.replace(/<\/?style>\n?/g, '')), /is not inside a <style> element/],
    ],
  },
  {
    guard: 'assertIconsDeclared',
    accepts: [
      { why: 'the real page', run: () => checks.assertIconsDeclared(indexHtml, ICON_LINKS), expect: count => assert.equal(count, ICON_LINKS.length) },
    ],
    rejects: [
      ['a page declaring no icons at all', () => checks.assertIconsDeclared(indexHtml.replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n/g, ''), ICON_LINKS), /does not declare icon at favicon\.ico/],
      ['a page whose icon points somewhere else', () => checks.assertIconsDeclared(indexHtml.replace(`href="${ICON_FILES.svg}"`, 'href="assets/old-icon.svg"'), ICON_LINKS), /does not declare icon at assets\/favicon\.svg/],
      ['the right path declared under the wrong rel', () => checks.assertIconsDeclared(indexHtml.replace('rel="apple-touch-icon"', 'rel="mask-icon"'), ICON_LINKS), /does not declare apple-touch-icon at apple-touch-icon\.png/],
    ],
  },
];

for (const { guard, accepts = [], rejects = [] } of CASES) {
  describe(guard, () => {
    for (const { why, run, expect } of accepts) {
      test(`accepts ${why}`, () => {
        const value = run();
        if (expect) expect(value);
      });
    }
    for (const [why, run, pattern] of rejects) {
      test(`rejects ${why}`, () => assert.throws(run, { message: pattern }));
    }
  });
}

/* --- the suite covers the module ---------------------------------------- */

/**
 * The suite is only worth as much as its coverage of the module, and a guard added later
 * would otherwise be the one guard with no negative case — silently, which is the failure
 * mode this whole file exists to remove.
 */
const exercised = new Set(CASES.map(({ guard }) => guard));
const exported = Object.keys(checks).filter(name => typeof checks[name] === 'function');

test('every guard in checks.js is exercised', () => {
  assert.deepEqual(
    exported.filter(name => !exercised.has(name)),
    [],
    'guard(s) with no cases here — add an accepting case and one it must reject',
  );
});

test('every case names a guard that exists', () => {
  assert.deepEqual(
    [...exercised].filter(name => !exported.includes(name)),
    [],
    'case(s) naming something checks.js no longer exports',
  );
});

test('every guard is asserted in both directions, unless it only reads', () => {
  const queries = ['between', 'referencedFiles', 'unreferencedFiles', 'readPngText'];
  const withoutNegativeCase = CASES
    .filter(({ guard, rejects = [] }) => !queries.includes(guard) && rejects.length === 0)
    .map(({ guard }) => guard);
  assert.deepEqual(withoutNegativeCase, [], 'guard(s) that are only ever exercised on valid input');
});
