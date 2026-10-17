/**
 * Whether the business's own address actually serves this site.
 *
 * The site publishes one canonical host — `site.url` — in every place a crawler reads it: the
 * canonical link, og:url, the sitemap, and the `@id` of the structured data. Nothing in the build
 * checks that the host answers, because nothing in a build can: it is a property of DNS and of the
 * Pages settings, both of which live outside the repository. That is exactly how this broke — the
 * domain was configured at its DNS provider as a forward to the default Pages address, so every
 * canonical pointed at a URL that immediately redirected away from itself, and the new /links/
 * address lost its path entirely on the way.
 *
 * So this asks the question directly: does the canonical host serve these bytes? It reads the two
 * pages this build emits, fetches them from the domain, and compares them byte for byte — which is
 * stronger than a 200, because a stale deployment or a parking page also answers 200.
 *
 * Run it by hand after touching DNS or Pages settings:
 *
 *     npm run domain
 *
 * It is deliberately not in `npm test`: a guard suite that depends on DNS fails in CI for reasons
 * that have nothing to do with the commit, and a red build nobody can act on is a red build people
 * learn to ignore.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import { site } from '../src/data.js';

/**
 * GitHub Pages' own addresses for a custom apex domain, spelled out rather than discovered: they
 * are what the DNS records have to contain, so a check that read them from the place it is
 * checking would agree with any mistake. From GitHub's "Managing a custom domain" documentation.
 */
const PAGES_A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const PAGES_AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];

/** The default Pages address this repository is published at, which a custom domain replaces. */
const DEFAULT_DOMAIN = 'sgscrap.github.io';

/** The pages this build emits, as the URL path each is published at and the file holding it. */
const PAGES = [
  { path: '', file: 'index.html' },
  { path: 'links/', file: 'links/index.html' },
];

const host = new URL(site.url).hostname;
const failures = [];
const notes = [];

const say = (mark, text) => console.log(`${mark} ${text}`);
const pass = text => say('✓', text);
const fail = (text, why) => {
  failures.push(text);
  say('✗', why ? `${text} — ${why}` : text);
};

/** Every address the name answers with, sorted, so two lists compare as sets and not as orders. */
const addresses = async (name, type) => {
  try {
    const found = await (type === 'AAAA' ? resolve6(name) : resolve4(name));
    return [...new Set(found)].sort();
  } catch (error) {
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') return [];
    throw error;
  }
};

const sameSet = (left, right) => left.join() === [...right].sort().join();

/* --- DNS ----------------------------------------------------------------- */

const apex = await addresses(host, 'A');
if (sameSet(apex, PAGES_A)) {
  pass(`DNS  ${host} A → the four GitHub Pages addresses`);
} else if (!apex.length) {
  fail(`DNS  ${host} has no A record`, 'nothing can answer for the domain');
} else {
  fail(
    `DNS  ${host} A → ${apex.join(', ')}`,
    `GitHub Pages answers only on ${PAGES_A.join(', ')}`,
  );
}

const apexV6 = await addresses(host, 'AAAA');
if (!apexV6.length) {
  // Optional, per GitHub's own guidance: IPv6 is recommended, never required.
  notes.push(`no AAAA record for ${host} — optional, the site works over IPv4`);
} else if (sameSet(apexV6, PAGES_AAAA)) {
  pass(`DNS  ${host} AAAA → the four GitHub Pages addresses`);
} else {
  fail(`DNS  ${host} AAAA → ${apexV6.join(', ')}`, 'GitHub Pages answers only on its own four');
}

const www = `www.${host}`;
let wwwCname = [];
try {
  wwwCname = await resolveCname(www);
} catch {
  // A CNAME is not the only way to point a subdomain at Pages — several providers flatten it.
}
const wwwA = await addresses(www, 'A');
if (wwwCname.some(name => name.toLowerCase() === `${DEFAULT_DOMAIN}.`) || sameSet(wwwA, PAGES_A)) {
  pass(`DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : 'the GitHub Pages addresses'}`);
} else {
  fail(
    `DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : wwwA.join(', ') || 'nothing'}`,
    `it should be a CNAME to ${DEFAULT_DOMAIN}`,
  );
}

/* --- HTTP ---------------------------------------------------------------- */

/**
 * Two things a 200 does not prove, both asked here: that the host serves this site rather than
 * forwarding somewhere else (so a redirect is read, never followed), and that what it serves is
 * the build in this checkout rather than an older one.
 *
 * A raw `https.get` rather than `fetch`, because a redirect has to stay a value this script can
 * report rather than something invisible, and because the response that has been answering the
 * domain is not valid HTTP/1.1 at all — its lines end in a bare newline, which curl tolerates and
 * every Node client refuses. That is worth naming when it happens instead of surfacing as a bare
 * "fetch failed".
 */
const digest = buffer => createHash('sha256').update(buffer).digest('hex').slice(0, 12);

const probe = url => new Promise((resolve, reject) => {
  const request = get(url, { headers: { 'user-agent': 'glam-team-cleaners domain check' } }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      location: response.headers.location,
      body: Buffer.concat(chunks),
    }));
    response.on('error', reject);
  });
  request.setTimeout(20000, () => request.destroy(new Error('no answer within 20s')));
  request.on('error', reject);
});

for (const { path, file } of PAGES) {
  const url = `${site.url}/${path}`;
  const local = readFileSync(file);
  let response;
  try {
    response = await probe(url);
  } catch (error) {
    // A parse error is not a network hiccup: the host answered, in something that is not HTTP.
    const malformed = /HPE_|protocol|Expected CR/i.test(`${error.code ?? ''} ${error.message}`);
    fail(`HTTP ${url}`, malformed
      ? `the host answers with a response that is not valid HTTP/1.1 (${error.message}), so it is not serving this site`
      : `the request failed: ${error.message}`);
    continue;
  }

  if (response.status >= 300 && response.status < 400) {
    fail(`HTTP ${url} → ${response.status} ${response.location ?? ''}`.trim(),
      'the address must serve the page, not forward it: every canonical names this URL');
    continue;
  }
  if (response.status !== 200) {
    fail(`HTTP ${url} → ${response.status}`, 'the page is not being served');
    continue;
  }

  if (response.body.equals(local)) {
    pass(`HTTP ${url} serves ${file} byte for byte (${digest(response.body)})`);
  } else {
    fail(
      `HTTP ${url} serves something else (${response.body.length} bytes, ${digest(response.body)}, where ${file} is ${local.length}, ${digest(local)})`,
      'what is live is not this checkout, so a canonical or a contact detail could be stale',
    );
  }
}

/* --- the verdict --------------------------------------------------------- */

for (const note of notes) say('·', note);

if (failures.length) {
  console.error(`\n✗ ${failures.length} thing(s) stand between ${host} and this site.\n`);
  console.error('  The DNS records belong to the domain\'s provider — these are their values:');
  console.error(`     A     @    ${PAGES_A.join(', ')}`);
  console.error(`     AAAA  @    ${PAGES_AAAA.join(', ')}   (optional)`);
  console.error(`     CNAME www  ${DEFAULT_DOMAIN}`);
  console.error('  Remove any forward or redirect set on the domain: a forward rewrites every path');
  console.error('  to one URL, which is why /links/ currently lands on the homepage.');
  console.error('\n  Then attach the domain to the repository once, and GitHub issues its certificate:');
  console.error(`     gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=${host}`);
  console.error('');
  process.exit(1);
}

console.log(`\n✓ ${host} serves this build, both pages, and every published URL names it.`);
