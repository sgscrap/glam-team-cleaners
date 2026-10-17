/**
 * The link page's second publication — `links.glamcleaners.net`.
 *
 * Two addresses, one page. The risk this file exists to catch is the obvious one: a second copy
 * that starts as the same page and then quietly stops being it, quoting last season's rate or a
 * number the business no longer answers. So the two copies are compared against each other here,
 * not read back from the committed files alone.
 *
 * It also catches the other way a second site breaks: paths written for one address and published
 * at the other. `/links/` sits one directory deep and names its icons `../favicon.ico`; the
 * subdomain's copy is the root of its own site, where `../` points above the site and 404s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINK_HOST } from '../src/dns.js';
import { ICON_FILES } from '../src/favicon.js';
import { LINKS_FILE, linksHtml } from '../src/links.js';
import {
  LINK_SITE_CNAME,
  LINK_SITE_DIR,
  LINK_SITE_URL,
  linkSiteFiles,
  linkSitePublished,
  publishLinkSite,
} from '../src/link-site.js';
import { site } from '../src/data.js';

/** A path from the repository root, resolved from this file so the suite is cwd-independent. */
const at = path => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** The icons the build draws once and hands to both sites. */
const icons = {
  [ICON_FILES.svg]: readFileSync(at(ICON_FILES.svg)),
  [ICON_FILES.ico]: readFileSync(at(ICON_FILES.ico)),
  [ICON_FILES.touch]: readFileSync(at(ICON_FILES.touch)),
};
const files = linkSiteFiles(icons);
const page = files[`${LINK_SITE_DIR}/index.html`];

/** Everything after the opening tag, so the two heads can differ without failing the comparison. */
const body = html => html.slice(html.indexOf('<main class="card">'));
/** The one thing the body is allowed to spell differently: where its logo is. */
const withOneLogoPath = html => body(html).replace('src="../apple-touch-icon.png"', 'src="apple-touch-icon.png"');

test('the subdomain is the same page, under its own address', () => {
  assert.match(page, new RegExp(`<link rel="canonical" href="${LINK_SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
  assert.match(page, new RegExp(`<meta property="og:url" content="${LINK_SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
  assert.equal(linksHtml().includes(LINK_SITE_URL), false, 'the /links/ copy must not claim the subdomain');
  assert.equal(
    withOneLogoPath(page),
    withOneLogoPath(linksHtml()),
    'every channel, number and word on the two addresses comes from one source and must match',
  );
});

test('the page names only files that sit beside it', () => {
  assert.equal(page.includes('src="../'), false, 'the subdomain is a root, so no reference may climb out of it');
  assert.equal(page.includes('href="../'), false);
  for (const path of [ICON_FILES.ico, ICON_FILES.svg, ICON_FILES.touch]) {
    assert.ok(files[`${LINK_SITE_DIR}/${path}`], `${path} is named by the page and missing from the site`);
    assert.ok(
      files[`${LINK_SITE_DIR}/${path}`].equals(icons[path]),
      `${path} is the same drawing on both sites, byte for byte`,
    );
  }
  assert.ok(page.includes(`href="${ICON_FILES.touch}"`), 'the touch icon is declared at the root it is served from');
});

test('the CNAME file names the host, and only the host', () => {
  assert.equal(LINK_HOST, `links.${new URL(site.url).hostname}`, "the subdomain sits under the site's own canonical host");
  assert.equal(files[LINK_SITE_CNAME], 'links.glamcleaners.net\n', 'Pages reads a bare hostname; a URL or a trailing slash is not one');
});

test('the committed second site is what the generator emits', () => {
  for (const [path, content] of Object.entries(files)) {
    assert.ok(
      readFileSync(at(path)).equals(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')),
      `regen: npm run build — ${path} is generated from src/link-site.js`,
    );
  }
});

test('publishing copies every file and leaves the rest of the repository alone', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'glam-links-'));
  try {
    writeFileSync(join(checkout, 'README.md'), '# glam-links\n');

    const first = publishLinkSite(checkout);
    assert.deepEqual(
      [...first.written].sort(),
      linkSitePublished(LINK_SITE_DIR),
      'every file the subdomain serves is written, and no other',
    );
    for (const path of first.written) {
      assert.ok(
        readFileSync(join(checkout, path)).equals(readFileSync(at(join(LINK_SITE_DIR, path)))),
        `${path} arrives byte for byte`,
      );
    }
    assert.equal(readFileSync(join(checkout, 'README.md'), 'utf8'), '# glam-links\n', 'the README is not this site\'s to overwrite');

    // The property that makes an instant rebuild cheap: a deploy that changed nothing upstream
    // writes no commit, so pushing the page twice is not two commits saying the same thing.
    const second = publishLinkSite(checkout);
    assert.deepEqual(second.written, []);
    assert.deepEqual([...second.unchanged].sort(), linkSitePublished(LINK_SITE_DIR));
    assert.deepEqual(second.stale, ['README.md']);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test('the second site is not part of the first one', () => {
  // The main site uploads `src/ship.js`, and the subdomain's files must never be in that list: a
  // copy of the page inside the main site would answer on the wrong host with the wrong canonical.
  assert.equal(LINKS_FILE, 'links/index.html');
  assert.equal(Object.keys(files).some(path => path === LINKS_FILE), false);
});
