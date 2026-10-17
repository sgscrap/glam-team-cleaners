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
 * It also names what the domain is doing instead, when it is doing something else. The response
 * that has been answering this one is not even valid HTTP/1.1 — its lines end in a bare newline —
 * so the request is read off the socket rather than through a client that would refuse it, and a
 * redirect is reported with its destination instead of being followed.
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
import { connect } from 'node:tls';
import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import { site } from '../src/data.js';
import { HOST, LINK_HOST, PAGES_A, PAGES_AAAA, PAGES_DOMAIN, ZONE_FILE } from '../src/dns.js';
import { LINK_SITE_URL } from '../src/link-site.js';

/**
 * The pages this build emits, as the address each must answer on and the file holding it. Two
 * hosts, because the link page is served twice: at `/links/` on the site, and at the root of its
 * own Pages site. Both are compared byte for byte — a subdomain that shows an older copy of the
 * page is the failure this list exists to make visible.
 */
const PAGES = [
  { url: `${site.url}/`, file: 'index.html' },
  { url: `${site.url}/links/`, file: 'links/index.html' },
  { url: LINK_SITE_URL, file: 'links-site/index.html' },
];

const host = HOST;
const failures = [];
const notes = [];

const say = (mark, text) => console.log(`${mark} ${text}`);
const pass = text => say('✓', text);
const fail = (text, why) => {
  failures.push(text);
  say('✗', why ? `${text} — ${why}` : text);
};

/** A decision about every other name on the domain, not something the canonicals depend on. */
const warn = text => say('!', text);

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
if (wwwCname.some(name => name.toLowerCase() === `${PAGES_DOMAIN}.`) || sameSet(wwwA, PAGES_A)) {
  pass(`DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : 'the GitHub Pages addresses'}`);
} else {
  fail(
    `DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : wwwA.join(', ') || 'nothing'}`,
    `it should be a CNAME to ${PAGES_DOMAIN}`,
  );
}

/**
 * The subdomain. It is a second Pages site rather than a path, so its record is a CNAME of its
 * own — and until that record exists, the wildcard is what answers for it, with the forwarder.
 */
let linksCname = [];
try {
  linksCname = await resolveCname(LINK_HOST);
} catch {
  // A flattened CNAME answers in A records instead; GitHub accepts either.
}
const linksA = await addresses(LINK_HOST, 'A');
if (linksCname.some(name => name.toLowerCase() === `${PAGES_DOMAIN}.`)) {
  pass(`DNS  ${LINK_HOST} → ${linksCname.join(', ')}`);
} else if (sameSet(linksA, PAGES_A)) {
  pass(`DNS  ${LINK_HOST} → the GitHub Pages addresses`);
} else if (linksA.length) {
  fail(
    `DNS  ${LINK_HOST} → ${linksA.join(', ')}`,
    `it should be a CNAME to ${PAGES_DOMAIN}; today the wildcard is answering`,
  );
} else {
  fail(`DNS  ${LINK_HOST} has no record`, `add a CNAME for links pointing at ${PAGES_DOMAIN}`);
}

/**
 * A wildcard is why every name under the domain "works", including the ones nobody configured —
 * `links.` included, which answers with the forwarder rather than with the site. GitHub's own
 * guidance is not to use one, since it hands any unclaimed subdomain to whoever asks; reported
 * rather than failed, because the apex is what the canonicals depend on.
 */

const probeName = `wildcard-${Math.random().toString(36).slice(2, 8)}.${host}`;
const wildcard = await addresses(probeName, 'A');
if (wildcard.length) {
  warn(`DNS  *.${host} resolves (${probeName} → ${wildcard.join(', ')}) — a wildcard answers for every subdomain, and today it answers with the forwarder`);
} else {
  pass(`DNS  no wildcard under ${host}: an unconfigured subdomain does not resolve`);
}

/* --- HTTP ---------------------------------------------------------------- */

/**
 * Two things a 200 does not prove, both asked here: that the host serves this site rather than
 * forwarding somewhere else (so a redirect is read, never followed), and that what it serves is
 * the build in this checkout rather than an older one.
 *
 * The request is written by hand and the answer parsed leniently, for one reason: the provider
 * currently answering this domain ends its header lines with a bare newline, which `fetch` and
 * `https.get` both refuse to parse. Refusing to read it would leave the check saying "the request
 * failed" about a server that answered perfectly clearly — with a 301 to the Pages address.
 */
const digest = buffer => createHash('sha256').update(buffer).digest('hex').slice(0, 12);

/** De-frame a chunked body: GitHub sends one, and the comparison is on bytes, not on framing. */
const dechunk = buffer => {
  const parts = [];
  let at = 0;
  while (at < buffer.length) {
    const end = buffer.indexOf('\r\n', at);
    if (end === -1) break;
    const size = Number.parseInt(buffer.subarray(at, end).toString('latin1'), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    parts.push(buffer.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return Buffer.concat(parts);
};

const probe = url => new Promise((resolve, reject) => {
  const { hostname, pathname, search } = new URL(url);
  const socket = connect({ host: hostname, servername: hostname, port: 443 }, () => {
    socket.write(`GET ${pathname}${search} HTTP/1.1\r\n`
      + `Host: ${hostname}\r\n`
      + 'User-Agent: glam-team-cleaners domain check\r\n'
      + 'Accept: */*\r\n'
      + 'Connection: close\r\n\r\n');
  });
  const chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  socket.on('end', () => {
    const raw = Buffer.concat(chunks);
    // Headers end at the first blank line, in whichever line-ending convention the server used.
    const crlf = raw.indexOf('\r\n\r\n');
    const lf = raw.indexOf('\n\n');
    const boundary = crlf !== -1 ? crlf + 4 : lf !== -1 ? lf + 2 : raw.length;
    const lines = raw.subarray(0, boundary).toString('latin1').split(/\r?\n/);
    const header = name => lines
      .map(line => new RegExp(`^${name}:\\s*(.+)$`, 'i').exec(line.trim())?.[1]?.trim())
      .find(Boolean);
    resolve({
      status: Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(lines[0]?.trim() ?? '')?.[1]),
      location: header('location'),
      chunked: /chunked/i.test(header('transfer-encoding') ?? ''),
      body: raw.subarray(boundary),
    });
  });
  socket.on('error', reject);
  socket.setTimeout(20000, () => socket.destroy(new Error('no answer within 20s')));
});

/** What each address says it is, read from the page it served. */
const declared = new Map();

for (const { url, file } of PAGES) {
  const local = readFileSync(file);
  let response;
  try {
    response = await probe(url);
  } catch (error) {
    fail(`HTTP ${url}`, `the request failed: ${error.message}`);
    continue;
  }

  if (!Number.isFinite(response.status)) {
    fail(`HTTP ${url}`, 'the host answered with bytes that are not an HTTP response at all');
    continue;
  }

  if (response.status >= 300 && response.status < 400) {
    fail(
      `HTTP ${url} → ${response.status} ${response.location ?? ''}`.trim(),
      response.location?.includes(PAGES_DOMAIN)
        ? `it is a domain forward to the Pages address, so every path on the domain lands on one page`
        : 'the address must serve the page, not forward it: every canonical names this URL',
    );
    continue;
  }
  if (response.status !== 200) {
    fail(`HTTP ${url} → ${response.status}`, 'the page is not being served');
    continue;
  }

  const served = response.chunked ? dechunk(response.body) : response.body;
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(served.toString('utf8'))?.[1];
  if (canonical) declared.set(url, canonical);
  if (served.equals(local)) {
    pass(`HTTP ${url} serves ${file} byte for byte (${digest(served)})`);
  } else {
    fail(
      `HTTP ${url} serves something else (${served.length} bytes, ${digest(served)}, where ${file} is ${local.length}, ${digest(local)})`,
      'what is live is not this checkout, so a canonical or a contact detail could be stale',
    );
  }
}

/* --- one page, one address ------------------------------------------------ */

/**
 * The link page is served twice — at `/links/` and at the bare subdomain — and only one of them
 * may be indexed. Both copies name the same canonical, so a search engine that finds either files
 * the page under one address. If they ever disagree, the two addresses compete with each other.
 * Checked only when both served: an unreachable address has already been reported above.
 */
const linkAddresses = [`${site.url}/links/`, LINK_SITE_URL];
const named = linkAddresses.map(url => declared.get(url));
if (named.every(Boolean)) {
  if (named[0] === named[1]) {
    pass(`canonical  both link addresses name ${named[0]}`);
  } else {
    fail(`canonical  ${named[0]} and ${named[1]}`, 'the two addresses must name one page, or search engines index two');
  }
}

/* --- the verdict --------------------------------------------------------- */

for (const note of notes) say('·', note);

if (failures.length) {
  console.error(`\n✗ ${failures.length} thing(s) stand between ${host} and this site.\n`);
  console.error(`  One action fixes them: replace what is at the DNS panel with ${ZONE_FILE},`);
  console.error('  and delete the forward and any wildcard record. The same records, inline:');
  console.error('');
  console.error(`     A      @     ${PAGES_A.join(', ')}`);
  console.error(`     AAAA   @     ${PAGES_AAAA.join(', ')}            (optional)`);
  console.error(`     CNAME  www   ${PAGES_DOMAIN}`);
  console.error(`     CNAME  links ${PAGES_DOMAIN}`);
  console.error('');
  console.error('  The forward is the part that rewrites every path, which is why /links/ lands on');
  console.error('  the homepage instead of the page a bio would point at. The links CNAME is the');
  console.error('  second Pages site: without it the wildcard keeps answering and the subdomain');
  console.error('  shows the homepage.');
  console.error('');
  console.error('  Once DNS answers, attaching the domain is one call — GitHub then issues the');
  console.error('  certificate, and the default Pages address starts redirecting here:');
  console.error(`     gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=${host}`);
  console.error('');
  process.exit(1);
}

console.log(`\n✓ ${host} serves this build, every published URL names it, and ${LINK_HOST} serves the link page at its root.`);
