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
 * The alias is asked four times, not once (see src/alias.js), and its certificate is read from the
 * handshake itself: a 301 behind a warning is not a working link, and neither is a 302.
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
import { site } from '../src/data.js';
import { aliasForms, redirectVerdict, tlsVerdict } from '../src/alias.js';
import { dechunk, probe } from '../src/probe.js';
import { HOST, LINK_HOST, MAIL_OBSERVED_ON, PAGES_A, PAGES_AAAA, PAGES_DOMAIN, ZONE_FILE } from '../src/dns.js';
import { collectAnswers, diffZone, rowLine, targetRecords } from '../src/zone-diff.js';
import { LINKS_URL } from '../src/links.js';

/**
 * A lookup that failed ends the script with one line instead of a stack trace, and says which kind
 * of answer is missing. Not every record here is a failure waiting to happen: a name that holds no
 * record and a name whose lookup timed out look identical in a resolver's log and mean opposite
 * things, and only one of them is worth acting on.
 */
process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing was judged: a lookup that failed is not the same answer as a record');
  console.error('  that is missing. Re-run it.\n');
  process.exitCode = 1;
});

/**
 * The pages this build emits, as the address each must answer on and the file holding it. Both are
 * compared byte for byte — a stale deployment also answers 200, so the bytes are the check.
 *
 * The subdomain is not in this list: it is the alias for the second of these pages, and it is asked
 * a different question below — whether it redirects here, or serves the same bytes.
 */
const PAGES = [
  { url: `${site.url}/`, file: 'index.html' },
  { url: `${site.url}/links/`, file: 'links/index.html' },
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

/* --- DNS, the target state record by record ------------------------------- */

/**
 * Every record the target state holds, against what the domain answers — one line per record, under
 * the check that owns it. The check lines keep the wording they have always had, because each one is
 * a sentence about what the domain is doing; what is new is the line beneath: which of the records
 * that check owns disagree, and what answered instead. A check that passes prints nothing under it
 * unless a record has something to say — a mail value the provider has changed since it was
 * recorded, or a record answering that the target state does not know about.
 */
const target = targetRecords();
const probeName = `wildcard-${Math.random().toString(36).slice(2, 8)}.${host}`;
const answers = await collectAnswers([...new Set(target.map(record => record.name)), probeName]);
const diff = diffZone(target, answers);

const liveAt = (name, type) => answers[name]?.[type] ?? [];
const sameSet = (left, right) => [...left].map(String).sort().join('\u0000') === [...right].map(String).sort().join('\u0000');

/** The rows one check owns, and the ones worth printing: all of them when it failed. */
const rowsAt = (name, types) => diff.filter(row => row.name === name && types.includes(row.type));
const detail = (rows, failed) => {
  const shown = failed ? rows : rows.filter(row => row.severity !== 'pass' || row.why);
  for (const row of shown) console.log(rowLine(row));
};

console.log(`\nDNS  the target state, against what ${host} answers\n`);

const apexRows = rowsAt(host, ['A']);
const apexA = liveAt(host, 'A');
if (sameSet(apexA, PAGES_A)) {
  pass(`DNS  ${host} A → the four GitHub Pages addresses`);
  detail(apexRows, false);
} else if (!apexA.length) {
  fail(`DNS  ${host} has no A record`, 'nothing can answer for the domain');
  detail(apexRows, true);
} else {
  fail(
    `DNS  ${host} A → ${apexA.join(', ')}`,
    `GitHub Pages answers only on ${PAGES_A.join(', ')}`,
  );
  detail(apexRows, true);
}

const v6Rows = rowsAt(host, ['AAAA']);
const apexV6 = liveAt(host, 'AAAA');
if (!apexV6.length) {
  // Optional, per GitHub's own guidance: IPv6 is recommended, never required — so its four records
  // are not listed as missing, which would read as four things to fix.
  notes.push(`no AAAA record for ${host} — optional, the site works over IPv4`);
} else if (sameSet(apexV6, PAGES_AAAA)) {
  pass(`DNS  ${host} AAAA → the four GitHub Pages addresses`);
  detail(v6Rows, false);
} else {
  fail(`DNS  ${host} AAAA → ${apexV6.join(', ')}`, 'GitHub Pages answers only on its own four');
  detail(v6Rows, true);
}

// A CNAME is not the only way to point a subdomain at Pages — several providers flatten it into the
// site's own addresses, which GitHub accepts, and which the diff reads as the record being answered.
const www = `www.${host}`;
const wwwCname = liveAt(www, 'CNAME');
const wwwA = liveAt(www, 'A');
const wwwRows = rowsAt(www, ['CNAME', 'A']);
if (wwwCname.includes(PAGES_DOMAIN) || sameSet(wwwA, PAGES_A)) {
  pass(`DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : 'the GitHub Pages addresses'}`);
  detail(wwwRows, false);
} else {
  fail(
    `DNS  ${www} → ${wwwCname.length ? wwwCname.join(', ') : wwwA.join(', ') || 'nothing'}`,
    `it should be a CNAME to ${PAGES_DOMAIN}`,
  );
  detail(wwwRows, true);
}

/**
 * The subdomain. The record exists so the name resolves and, once proxied, so Cloudflare can see it
 * and apply the redirect rule — until that record exists and is proxied, the wildcard answers for it
 * with the forwarder.
 */
const linksCname = liveAt(LINK_HOST, 'CNAME');
const linksA = liveAt(LINK_HOST, 'A');
const linksRows = rowsAt(LINK_HOST, ['CNAME', 'A']);
if (linksCname.includes(PAGES_DOMAIN)) {
  pass(`DNS  ${LINK_HOST} → ${linksCname.join(', ')}`);
  detail(linksRows, false);
} else if (sameSet(linksA, PAGES_A)) {
  pass(`DNS  ${LINK_HOST} → the GitHub Pages addresses`);
  detail(linksRows, false);
} else if (linksA.length) {
  fail(
    `DNS  ${LINK_HOST} → ${linksA.join(', ')}`,
    `it should be a CNAME to ${PAGES_DOMAIN}; today the wildcard is answering`,
  );
  detail(linksRows, true);
} else {
  fail(`DNS  ${LINK_HOST} has no record`, `add a CNAME for links pointing at ${PAGES_DOMAIN}`);
  detail(linksRows, true);
}

/**
 * The mail records the target state records, asked the same way and under the same rule the diff
 * applies to them: carried across a move rather than prescribed by it, so a value that answers
 * differently is reported — the mail platform may have changed it since it was recorded, and that is
 * not this migration's business — while a record that answers nothing at all is a failure, because
 * that is mail with nowhere to go and no other check in this script would see it.
 */
const mailRows = [...rowsAt(host, ['MX', 'TXT']), ...rowsAt(`_dmarc.${host}`, ['TXT'])];
const recorded = mailRows.filter(row => row.source === 'observed');
const missing = recorded.filter(row => row.status === 'missing');

if (missing.length) {
  fail(
    `DNS  the mail records recorded in the target state → nothing answers for ${missing.map(row => `${row.type} ${row.name}`).join(', ')}`,
    'mail routes on exactly these records, and nothing else here reports one missing',
  );
  detail(mailRows, true);
} else {
  pass(`DNS  the mail records recorded in the target state → MX, SPF and DMARC answer, as recorded on ${MAIL_OBSERVED_ON}`);
  detail(mailRows, false);
}

/**
 * A wildcard is why every name under the domain "works", including the ones nobody configured —
 * `links.` included, which answers with the forwarder rather than with the site. GitHub's own
 * guidance is not to use one, since it hands any unclaimed subdomain to whoever asks; reported
 * rather than failed, because the apex is what the canonicals depend on.
 */
const wildcard = liveAt(probeName, 'A');
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
 * The request is written by hand (src/probe.js) and the answer parsed leniently, for one reason:
 * the provider currently answering this domain ends its header lines with a bare newline, which
 * `fetch` and `https.get` both refuse to parse. Refusing to read it would leave the check saying
 * "the request failed" about a server that answered perfectly clearly — with a 301 to the Pages
 * address.
 */
const digest = buffer => createHash('sha256').update(buffer).digest('hex').slice(0, 12);

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
  if (served.equals(local)) {
    pass(`HTTP ${url} serves ${file} byte for byte (${digest(served)})`);
  } else {
    fail(
      `HTTP ${url} serves something else (${served.length} bytes, ${digest(served)}, where ${file} is ${local.length}, ${digest(local)})`,
      'what is live is not this checkout, so a canonical or a contact detail could be stale',
    );
  }
}

/* --- the alias ------------------------------------------------------------ */

/**
 * The link page has one address and one name that points at it: a 301 to the canonical page, in
 * every form the alias can be reached in (src/alias.js lists which, and why each one is a separate
 * question).
 *
 * A page answering instead is the pre-rule state — or the forwarder — and is reported as that,
 * rather than as a missing page: the two states have different fixes and only one of them involves
 * DNS. The page that used to answer here was a second Pages site, and it is retired, so nothing
 * maintained lives behind this name any more.
 */

/**
 * The certificate, read before any redirect is judged. Cloudflare issues for a proxied name as soon
 * as it is proxied, so this is a separate question with a separate cause — and a 301 nobody can
 * reach past a warning is not a working link. Verification is Node's own: the chain and the name
 * are checked against the system roots to get this far, so all that is left is to report it.
 */
let handshake;
try {
  const { certificate } = await probe(`https://${LINK_HOST}/`);
  handshake = { certificate };
} catch (error) {
  handshake = { error };
}

const tls = tlsVerdict(handshake);
if (tls.ok) {
  pass(`TLS  ${LINK_HOST} — ${tls.text}`);
} else {
  fail(`TLS  ${LINK_HOST}`, tls.why);
  notes.push('the alias forms were not asked: the connection never became a trusted HTTPS session');
}

if (tls.ok) {
  for (const { form, url, expected } of aliasForms()) {
    let response;
    try {
      response = await probe(url);
    } catch (error) {
      fail(`alias  ${form}  ${url}`, `the request failed: ${error.message}`);
      continue;
    }

    const verdict = redirectVerdict(expected, response);
    if (verdict.ok) {
      pass(`alias  ${form}  ${url} → ${verdict.text}`);
      continue;
    }

    // A 200 here means something answered with a page instead of a redirect. Saying so separates
    // "the redirect is missing" from "the host answers with something else".
    const served = response.chunked ? dechunk(response.body) : response.body;
    const answered = response.status === 200;
    const canonical = answered
      ? /<link rel="canonical" href="([^"]+)"/.exec(served.toString('utf8'))?.[1]
      : undefined;

    fail(
      `alias  ${form}  ${url}`,
      answered
        ? `the name answers with a page${canonical ? ` naming ${canonical}` : ''} instead of a 301 — the rule is not in front of it, or the record is still not proxied`
        : verdict.why,
    );
  }
}

/* --- the verdict --------------------------------------------------------- */

for (const note of notes) say('·', note);

if (failures.length) {
  console.error(`\n✗ ${failures.length} thing(s) stand between ${host} and this site.\n`);

  /**
   * Two different repairs, and the message picks the one that applies. With DNS right and only the
   * alias failing, sending someone back to the DNS panel would be advice for a problem they no
   * longer have; with the zone not moved yet, the redirect rule is not the first thing to fix.
   */
  const onlyAlias = failures.every(text => /^(alias|TLS)\b/.test(text));

  if (onlyAlias) {
    console.error('  DNS and both pages are right. What is left is the alias: the redirect rule, and');
    console.error('  the proxy state that lets Cloudflare see the name at all. Both are installed by');
    console.error('  the second half of the same command, which is safe to re-run:');
    console.error('');
    console.error('     npm run dns:cloudflare -- --apply');
    console.error('');
    console.error('  If that changes nothing, read the two things it wrote: the rule must match');
    console.error(`  ${LINK_HOST} in http_request_dynamic_redirect, and its CNAME must be proxied.`);
    console.error('');
  } else {
    console.error(`  One action fixes the DNS: replace what is at the panel with ${ZONE_FILE},`);
    console.error('  and delete the forward and any wildcard record. The ✗ rows above name exactly');
    console.error('  which records disagree, and the ! rows what is answering in their place.');
    console.error('');
    console.error('  The same records, inline:');
    console.error('');
    console.error(`     A      @     ${PAGES_A.join(', ')}`);
    console.error(`     AAAA   @     ${PAGES_AAAA.join(', ')}            (optional)`);
    console.error(`     CNAME  www   ${PAGES_DOMAIN}`);
    console.error(`     CNAME  links ${PAGES_DOMAIN}`);
    console.error('');
    console.error('  The forward is the part that rewrites every path, which is why /links/ lands on');
    console.error('  the homepage instead of the page a bio would point at. Links is its own name:');
    console.error('  a redirect to the canonical page, which npm run dns:cloudflare installs along');
    console.error('  with the records.');
    console.error('');

    console.error('  Once DNS answers, attaching the domain is one call — GitHub then issues the');
    console.error('  certificate, and the default Pages address starts redirecting here:');
    console.error(`     gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=${host}`);
    console.error('');
  }

  process.exit(1);
}

console.log(`\n✓ ${host} serves this build, every published URL names it, and ${LINK_HOST} redirects to ${LINKS_URL} in every form, over a trusted certificate.`);
