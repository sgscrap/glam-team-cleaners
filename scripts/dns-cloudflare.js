/**
 * Move `glamcleaners.net` onto Cloudflare, from the same source that builds the site.
 *
 * The domain's zone is hosted by a provider whose control panel has no address any more —
 * `businessidentity.llc` and every `*` name under it answer with no A record — so the records are
 * imported here instead of typed into a page nobody can reach. What this script writes is the
 * site's records from src/dns.js, plus the mail records read out of the live zone, so the mailbox
 * survives the move.
 *
 * Cloudflare is only half the change. The nameservers are set at the registrar (DomainRegistry.com),
 * and that is a login this machine does not hold; the script prints the pair to use.
 *
 *   node scripts/dns-cloudflare.js            # dry run: what would be written, and why
 *   node scripts/dns-cloudflare.js --apply    # create the zone and its records
 *
 * Credentials come from the environment, or from a file outside the repository:
 *
 *   CF_API_TOKEN=...      Zone:Edit for the account (Zone:Read is included in it)
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
import { HOST, LINK_HOST } from '../src/dns.js';
import {
  aliasRedirectRule,
  dmarcRecords,
  mailRecords,
  obsoleteWebRecords,
  recordKey,
  redirectWrites,
  webRecords,
  withAliasRedirect,
} from '../src/cloudflare.js';

const API = 'https://api.cloudflare.com/client/v4';
const APPLY = process.argv.includes('--apply');

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
  console.error('    Zone → DNS → Edit                 (the records)');
  console.error('    Zone → Dynamic Redirect → Edit    (the redirect rule)');
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

const desired = [...webRecords(), ...mailRecords(mx, apexTxt), ...dmarcRecords(dmarcTxt)];

console.log(`\n${HOST}: ${desired.length} records for the move to Cloudflare\n`);
console.log(describe(desired));
console.log('\n  no DKIM record is published at any usual selector, so none is copied;');
console.log('  if the mailbox signs outbound mail with its own key, add that TXT here before the switch.');

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
  const found = present.get(key(record));
  if (!found) {
    await api(`/zones/${zone.id}/dns_records`, { method: 'POST', token, body: record });
    console.log(`+ ${record.type.padEnd(5)} ${record.name.padEnd(28)} ${record.content}`);
    continue;
  }
  if (found.proxied !== record.proxied) {
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

// And the record that carries the traffic. Only this one: the apex and www must stay DNS-only for
// GitHub to issue their certificates.
const after = await api(`/zones/${zone.id}/dns_records?per_page=100`, { token });
const alias = after.find(record => record.type === 'CNAME' && record.name === LINK_HOST);
if (alias && alias.proxied !== true) {
  await api(`/zones/${zone.id}/dns_records/${alias.id}`, {
    method: 'PATCH',
    token,
    body: { proxied: true, ttl: 1 },
  });
  console.log(`~ CNAME ${LINK_HOST}  DNS only → proxied, so the redirect can answer for it`);
}
if (!alias) {
  console.error(`! No CNAME for ${LINK_HOST} in the zone, so the redirect has nothing to answer on.`);
}

console.log('\nNext: point the registrar at Cloudflare. Nameservers to set at DomainRegistry.com:');
for (const server of zone.name_servers ?? []) console.log(`  ${server}`);
console.log('\nThen, once the zone shows active: npm run domain\n');
