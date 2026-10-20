/**
 * Move `glamcleaners.net` onto Cloudflare, from the same source that builds the site.
 *
 * The domain's zone is hosted by a provider whose control panel has no address any more —
 * `businessidentity.llc` and every `*` name under it answer with no A record — so the records are
 * imported here instead of typed into a page nobody can reach. What this script writes is the
 * site's records from src/dns.js, plus the mail records read out of the live zone — MX, SPF, DMARC
 * and any DKIM key its selector names — so the mailbox survives the move.
 *
 * Cloudflare is only half the change. The nameservers are set at the registrar — DomainRegistry.com
 * LLC, the registrar the domain was bought with through Northwest Registered Agent, signed into at
 * https://www.domainregistry.com/login/ — and that is a login this machine does not hold, so the
 * script prints the pair to use and where to put it.
 *
 *   node scripts/dns-cloudflare.js            # dry run: what would be written, and why
 *   node scripts/dns-cloudflare.js --apply    # create the zone and its records
 *
 * An apply run also takes the mail baseline itself — what the domain answers for MX, SPF, DMARC and
 * each DKIM key, read while the old zone is still authoritative — saves it (mail-baseline.json, or
 * the file `--baseline` names) and compares the zone against it before it prints the nameserver
 * pair. A zone that lost or reworded a mail record ends the run with exit 1 instead: after the
 * nameservers move there is no second chance to notice, and the symptom is refused mail weeks later.
 * The file is kept, never re-taken, so the later `npm run mail:records -- --compare` measures a
 * baseline that was genuinely taken before the move.
 *
 * Credentials come from the environment, or from a file outside the repository:
 *
 *   CF_API_TOKEN=...      Zone → DNS → Edit, Zone → Dynamic Redirect → Edit and Zone → Zone → Read
 *   CF_ACCOUNT_ID=...
 *
 *   ~/.cloudflare-zone.env  with those two lines, if you would rather not export them.
 *
 * The deletion is deliberately narrow: the old web records at `@`, `www`, `links` and the `*`
 * wildcard, because those are the ones that send every path to the forwarder and answer for every
 * subdomain. Mail is never touched — an MX, SPF or DMARC record this script did not write is
 * listed and left exactly as it is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { discoverDkim, selectorsFrom } from '../src/dkim.js';
import { HOST, LINK_HOST } from '../src/dns.js';
import {
  MAIL_BASELINE,
  captureMailBaseline,
  compareMail,
  zoneSnapshot,
} from '../src/mail-records.js';
import { REGISTRAR_LOGIN } from '../src/accounts.js';
import {
  aliasRedirectRule,
  dkimRecords,
  dmarcRecords,
  finalProxyState,
  mailRecords,
  REQUIRED_PERMISSIONS,
  obsoleteWebRecords,
  recordKey,
  redirectWrites,
  webRecords,
  withAliasRedirect,
} from '../src/cloudflare.js';

const API = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');

/**
 * Where this run keeps the mail baseline. `--baseline <file>` moves it, which is the only way to
 * point the same run at the file an earlier one saved.
 */
const BASELINE = (() => {
  const index = process.argv.indexOf('--baseline');
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith('-')) {
      console.error('\n✗ --baseline needs a file: node scripts/dns-cloudflare.js --apply --baseline before.json\n');
      process.exit(1);
    }
    return value;
  }
  const inline = process.argv.find(argument => argument.startsWith('--baseline='));
  return inline ? inline.slice('--baseline='.length) : MAIL_BASELINE;
})();

/** Credentials from the environment, or from one file the repository does not contain. */
function credentials() {
  const fromFile = `${homedir()}/.cloudflare-zone.env`;
  const values = { ...process.env };
  if (existsSync(fromFile)) {
    for (const line of readFileSync(fromFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (match) values[match[1]] ??= match[2];
    }
  }
  return { token: values.CF_API_TOKEN, account: values.CF_ACCOUNT_ID };
}

/**
 * A failed request ends the script with one line instead of a stack trace.
 *
 * The API calls are top-level awaits, so a rejection is an uncaught exception — and on Windows,
 * tearing down while a socket is mid-close raises a libuv assertion on top of the real error, which
 * buries the one message that says what Cloudflare objected to.
 */
process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing else was written. The writes are idempotent: fix the cause and re-run.\n');
  process.exitCode = 1;
});

/** One request, with Cloudflare's own error list surfaced rather than a bare status. */
async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = (payload.errors ?? []).map(error => `${error.code} ${error.message}`).join('; ');
    throw new Error(`${method} ${path} → ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
  return payload.result;
}

const describe = records => records
  .map(({ type, name, content, priority }) => `  ${type.padEnd(5)} ${name.padEnd(28)} ${priority ? `${priority} ` : ''}${content}`)
  .join('\n');

const { token, account } = credentials();

if (!token || !account) {
  console.error('\n✗ No Cloudflare credentials.');
  console.error('  Create an API token for the account with these permissions:');
  for (const { name, why } of REQUIRED_PERMISSIONS) {
    console.error(`    ${name.padEnd(34)}(${why})`);
  }
  console.error('  then either export');
  console.error('  CF_API_TOKEN and CF_ACCOUNT_ID, or write them into ~/.cloudflare-zone.env:');
  console.error('      CF_API_TOKEN=...');
  console.error('      CF_ACCOUNT_ID=...');
  console.error('\n  Nothing was changed.\n');
  process.exit(1);
}

const [mx, apexTxt, dmarcTxt] = await Promise.all([
  resolveMx(HOST),
  resolveTxt(HOST).catch(() => []),
  resolveTxt(`_dmarc.${HOST}`).catch(() => []),
]);

/**
 * DKIM is read from the live zone before anything is written, because its name is not knowable in
 * advance: the selector belongs to the mail platform. A lookup that fails is retried and then
 * raised, so a timeout cannot masquerade as "no key" and drop the record mid-move.
 */
const asked = selectorsFrom(process.argv.slice(2), process.env.DKIM_SELECTOR);
const dkim = await discoverDkim(HOST, { selectors: asked });

const desired = [
  ...webRecords(),
  ...mailRecords(mx, apexTxt),
  ...dmarcRecords(dmarcTxt),
  ...dkimRecords(HOST, dkim.found),
];

console.log(`\n${HOST}: ${desired.length} records for the move to Cloudflare\n`);
console.log(describe(desired));

if (dkim.found.length) {
  for (const key of dkim.found) {
    console.log(`\n  dkim  ${key.name}  ${key.bits ? `${key.bits}-bit ` : ''}key copied verbatim`);
  }
} else {
  console.log(`\n  dkim  no key at ${dkim.tried.length} selector names — nothing to copy.`);
  console.log('        A key that is not published cannot verify a signature under this domain.');
  console.log('        If the panel names a selector, ask again: npm run dkim -- --selector <name>');
}
if (asked.length) {
  console.log(`        asked by name: ${asked.join(', ')} (${dkim.found.filter(key => asked.includes(key.selector)).length} found)`);
}

if (dkim.delegated.length && !dkim.found.length) {
  console.error('\n  ! DKIM is delegated by a CNAME and no selector answered through it:');
  for (const line of dkim.delegated) console.error(`      ${line}`);
  console.error('    Recreating the zone without that CNAME would leave every selector unverifiable.');
  if (APPLY) {
    console.error('    Nothing was written. Plan that CNAME first, or name the selector with');
    console.error('    --selector so the key can be copied individually.\n');
    process.exit(1);
  }
}

const redirect = aliasRedirectRule();
const { from_value: from } = redirect.action_parameters;
console.log(`\nAnd ${LINK_HOST} stops being a second copy of the page — this rule, in the zone:`);
console.log(`  when ${redirect.expression}`);
console.log(`  then ${from.status_code} → ${from.target_url.value}${from.preserve_query_string ? ' (query string preserved)' : ''}`);
console.log('  which also turns that one DNS record orange: Cloudflare sees no traffic for a grey name.\n');

if (!APPLY) {
  console.log('Dry run. Re-run with --apply to create the zone and write these records.\n');
  process.exit(0);
}

// The zone, or a new one. A zone created here is not active until the registrar points at it.

/* --- the mail baseline, before anything is written ------------------------ */

// Not a separate command anyone can forget: the comparison that proves mail survived is only worth
// something against a reading taken while the old zone still answers, so the reading is part of the
// run. A lookup that fails here ends the run before the token writes, rather than leaving a move
// with no way to tell whether the mailbox came along.
const baseline = await captureMailBaseline(BASELINE, { selectors: asked });
const before = baseline.snapshot;
console.log(`\nMail baseline  ${baseline.path}  (${baseline.wrote ? 'taken now' : 'kept from an earlier run'})`);
console.log(`  MX        ${before.mx.length ? before.mx.map(({ priority, exchange }) => `${priority} ${exchange}`).join(', ') : '(none)'}`);
console.log(`  SPF       ${before.spf ?? '(none)'}`);
console.log(`  DMARC     ${before.dmarc ?? '(none)'}`);
console.log(`  DKIM      ${before.dkim.length ? before.dkim.map(key => key.selector).join(', ') : '(none)'}`);
if (!baseline.wrote) {
  console.log('  A baseline is never refreshed: delete the file deliberately if this really is a new move.');
}

const existing = await api(`/zones?name=${encodeURIComponent(HOST)}`, { token });
let zone = existing[0];
if (!zone) {
  try {
    zone = await api(`/accounts/${account}/zones`, {
      method: 'POST',
      token,
      body: { name: HOST, type: 'full', jump_start: false },
    });
  } catch (error) {
    // Creating a zone needs a permission the "Edit zone DNS" template does not grant. Say which
    // fix is wanted, instead of Cloudflare's wording about com.cloudflare.api.account.zone.create.
    if (/403|zone\.create/i.test(error.message)) {
      console.error(`\n✗ This token cannot add the zone.\n  Add ${HOST} in the Cloudflare dashboard first, then re-run.`);
      console.error('  That is enough: writing records needs Zone Read and DNS Edit only.\n');
      process.exit(1);
    }
    throw error;
  }
}

console.log(`zone  ${zone.id}  ${zone.name}  status: ${zone.status}`);

const current = await api(`/zones/${zone.id}/dns_records?per_page=100`, { token });
const present = new Map(current.map(record => [recordKey(record), record]));

for (const record of desired) {
  const found = present.get(recordKey(record));
  if (!found) {
    await api(`/zones/${zone.id}/dns_records`, { method: 'POST', token, body: record });
    console.log(`+ ${record.type.padEnd(5)} ${record.name.padEnd(28)} ${record.content}`);
    continue;
  }
  // A record that asks for no proxy state is not proxied — otherwise every MX and TXT the zone
  // already holds reads as "proxied → DNS only" and gets a pointless write.
  if (found.proxied !== (record.proxied ?? false)) {
    await api(`/zones/${zone.id}/dns_records/${found.id}`, {
      method: 'PATCH',
      token,
      body: { proxied: false, ttl: 1 },
    });
    console.log(`~ ${record.type.padEnd(5)} ${record.name.padEnd(28)} proxied → DNS only`);
  }
}

const wanted = new Set(desired.map(recordKey));
const obsolete = obsoleteWebRecords(current, desired);
if (obsolete.length) console.log('\nRemoving the old web records:');
for (const record of obsolete) {
  await api(`/zones/${zone.id}/dns_records/${record.id}`, { method: 'DELETE', token });
  console.log(`- ${record.type.padEnd(5)} ${record.name.padEnd(28)} ${record.content}`);
}

const extras = current.filter(record => !wanted.has(recordKey(record)) && !obsolete.includes(record));
if (extras.length) {
  console.log('\nLeft alone — not part of this move:');
  console.log(describe(extras));
}

/* --- the alias, as a redirect --------------------------------------------- */

// Installed after the records, because the rule is only useful on a name whose record is proxied,
// and flipping that first would proxy the alias to a site that still answers with the page. If this
// fails, the zone is left exactly as it was: the records are right and the alias still serves.
const shape = redirectWrites(zone.id, []);
let ruleset = null;
try {
  ruleset = await api(shape.read, { token });
} catch (error) {
  // No entry point in that phase yet on this zone: the create call below is the other shape.
  if (!/404/.test(error.message)) throw error;
}

// Every rule already in the phase goes back with ours, because the write replaces the whole list.
const call = ruleset ? shape.update : shape.create;
const rules = withAliasRedirect(ruleset?.rules ?? [], redirect);
await api(call.path, { method: call.method, token, body: { ...call.body, rules } });

const kept = (ruleset?.rules ?? []).filter(rule => rule.description !== redirect.description).length;
console.log(`\nredirect  ${redirect.expression} → ${from.status_code} ${from.target_url.value}${kept ? ` (${kept} other rule(s) left in place)` : ''}`);

// And the records that carry the traffic. The target state is a value, not a sentence in the
// runbook: only the names `finalProxyState` marks are turned orange, and the apex and `www` stay
// grey so GitHub can issue their certificates.
const after = await api(`/zones/${zone.id}/dns_records?per_page=100`, { token });
for (const [name, proxied] of Object.entries(finalProxyState())) {
  const record = after.find(candidate => candidate.name === name);
  if (!record) {
    const consequence = name === LINK_HOST ? ', and the redirect has nothing to answer on' : '';
    console.error(`! No ${name} record in the zone, so its proxy state could not be set${consequence}.`);
    continue;
  }
  if (proxied && record.proxied !== true) {
    await api(`/zones/${zone.id}/dns_records/${record.id}`, {
      method: 'PATCH',
      token,
      body: { proxied: true, ttl: 1 },
    });
    console.log(`~ ${record.type.padEnd(5)} ${name}  DNS only → proxied, so the redirect can answer for it`);
  }
  if (!proxied && record.proxied === true) {
    await api(`/zones/${zone.id}/dns_records/${record.id}`, {
      method: 'PATCH',
      token,
      body: { proxied: false, ttl: 1 },
    });
    console.log(`~ ${record.type.padEnd(5)} ${name}  proxied → DNS only, because GitHub must answer for it`);
  }
}

/* --- and did the mail come with it -------------------------------------- */

// The zone, read back from the API and compared with the baseline taken before the first write.
// This is the check the run cannot finish without: MX, SPF, DMARC and every DKIM key the old zone
// answered have to be in the new one, spelled identically. The registrar line below is only
// printed when they are, because once the nameservers move there is no second chance to notice.
const settled = await api(`/zones/${zone.id}/dns_records?per_page=100`, { token });
const survived = compareMail(before, zoneSnapshot(HOST, settled));

console.log(`\nMail in the zone, against the baseline:\n`);
for (const check of survived.checks) {
  if (check.ok) {
    const detail = check.name === 'MX' ? ` (${check.after})` : check.name.startsWith('DKIM ')
      ? `${check.bits?.after ? ` (${check.bits.after}-bit)` : ''}`
      : '';
    console.log(`  ✓ ${check.name.padEnd(10)} unchanged${detail}`);
    continue;
  }

  console.log(`  ✗ ${check.name.padEnd(10)} ${check.why ?? 'changed'}`);
  console.log(`      before  ${check.before ?? '(none)'}`);
  console.log(`      after   ${check.after ?? '(none)'}`);
}
for (const note of survived.notes) console.log(`  · ${note}`);

if (!survived.ok) {
  console.error(`\n✗ Mail did not come across intact, so the nameservers must not move yet.`);
  console.error(`  The zone is missing or has changed ${survived.checks.filter(check => !check.ok).length} record(s) the old zone answered.`);
  console.error('  The writes are idempotent: re-run to retry the copy, and restore anything');
  console.error(`  already in the zone by hand. The baseline is kept at ${baseline.path}.\n`);
  process.exit(1);
}

console.log('  Every mail record the old zone answers is here, spelled the same.');

console.log('\nNext: point the registrar at Cloudflare. At DomainRegistry.com — the registrar the domain');
console.log('was bought with, through Northwest Registered Agent — sign in at');
console.log(`  ${REGISTRAR_LOGIN}`);
console.log('and replace the two Business Identity nameservers, under the domain, with:');
for (const server of zone.name_servers ?? []) console.log(`  ${server}`);
console.log('\nThen, once the zone shows active: npm run domain\n');