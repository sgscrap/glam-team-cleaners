/**
 * Does the mailbox sign outbound mail, and with which key?
 *
 *   npm run dkim
 *   npm run dkim -- --selector <name>
 *   npm run dkim -- --selector a,b --selector c
 *
 * DKIM is the only mail record whose *name* is not known in advance: the key lives at
 * `<selector>._domainkey.<domain>`, and the selector belongs to the mail platform. `src/dkim.js`
 * holds the sweep and the parsing; this is the answer, in one place, without a Cloudflare token —
 * which matters, because the question has to be settled before the nameservers move and the token
 * does not exist yet.
 *
 * It reads, it writes nothing, and it exits 0 whether or not a key was found: "there is none" is
 * the answer to the question rather than a failure of the check. Exit 1 means DNS could not be
 * read, which is not an answer at all — the discovery retries once and then says so, rather than
 * treating a timeout as an empty zone and dropping a key during the move.
 */
import { discoverDkim, selectorsFrom } from '../src/dkim.js';
import { HOST } from '../src/dns.js';

process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing was written — this only reads DNS. Re-run it, because a lookup that');
  console.error('  failed is not the same answer as a name that holds no key.\n');
  process.exitCode = 1;
});

const selectors = selectorsFrom(process.argv.slice(2), process.env.DKIM_SELECTOR);
const report = await discoverDkim(HOST, { selectors });

console.log(`\n${HOST}\n`);
console.log(`  tried    ${report.tried.length} names of the form <selector>._domainkey.${HOST}`);

if (report.found.length) {
  console.log(`  found    ${report.found.length} published key(s)\n`);
  for (const key of report.found) {
    console.log(`    ${key.name}`);
    console.log(`      ${key.bits ? `${key.bits}-bit ` : ''}key, ${key.key.length} characters — copied into Cloudflare by npm run dns:cloudflare`);
  }
} else {
  console.log('  found    none\n');
  console.log('  Nothing to carry into Cloudflare, and nothing that can verify a signature under');
  console.log(`  this domain: DKIM reads a key published at <selector>._domainkey.${HOST}, and`);
  console.log('  none is. So mail from this mailbox is not being signed with this domain today.');
  console.log('  That is the provider\'s doing, not this zone\'s — a key under their own domain');
  console.log('  travels with their zone, which is not moving.');
}

console.log('');
if (selectors.length) {
  const named = selectors.map(name => `${name}._domainkey`).join(', ');
  const hit = report.found.filter(key => selectors.includes(key.selector)).length;
  console.log(`  Also asked by name: ${named} — ${hit} found.`);
  console.log('  A panel can choose a name no convention would find; this is how that one is asked.');
} else {
  console.log('  A panel can choose a name no convention would find. If it shows one, ask again:');
  console.log('      npm run dkim -- --selector <name>');
}

if (report.delegated.length) {
  console.log('\n  ! DKIM is delegated by a CNAME, so every selector is answered by another zone:');
  for (const line of report.delegated) console.log(`      ${line}`);
  console.log('    That CNAME has to be recreated in Cloudflare, or every selector stops verifying.');
}

if (report.misplaced.length) {
  console.log(`\n  ! A DKIM key is published as a plain TXT at ${HOST}, where DKIM never looks —`);
  console.log('    it reads <selector>._domainkey.<domain>. That record verifies nothing, and it is');
  console.log('    not the key this mailbox signs with.');
}

console.log('\n  Run this before the nameservers change: afterwards the live zone no longer');
console.log('  answers for the domain, and a key there can only be recovered from the panel.\n');
