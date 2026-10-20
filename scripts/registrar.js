/**
 * Ask the registry what it holds, without a browser.
 *
 *     npm run registrar
 *
 * It prints the registrar of record, the domain's status, when it was registered and when it
 * expires, and the nameservers actually delegated — then the same facts as this repository records
 * them, so a difference is visible rather than remembered. RDAP is the registry's own answer over
 * plain HTTPS: no token, no login, nothing written. Exit 0 when the registry still says what the
 * runbook says; 1 when it does not, or when the lookup could not be answered at all — a lookup that
 * failed is not the same answer as a domain that changed.
 *
 * A difference is usually not a fault. A renewal moves the expiry date, and that is exactly the kind
 * of thing worth being told: the runbook's "Where it is today" table and `ACCOUNTS.md` both state
 * these values, and an expiry that has been extended makes both of them wrong in the quiet
 * direction. So the drift is printed with the values to write, and updating them is a decision
 * rather than something this command does behind the operator's back.
 */
import {
  REGISTRAR_FACTS,
  compareRegistrar,
  describeRegistrarValue,
  fetchRegistrar,
  rdapUrl,
} from '../src/registrar.js';

process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing was judged and nothing was written: this only reads the registry.');
  console.error('  A lookup that failed is not the same answer as a domain that changed.\n');
  process.exitCode = 1;
});

const live = await fetchRegistrar(REGISTRAR_FACTS.host);
const result = compareRegistrar(REGISTRAR_FACTS, live);

console.log(`\n${live.host} — from the registry (${rdapUrl(live.host)})\n`);
console.log(`  registrar  ${live.registrar ?? '(none)'}${live.ianaId ? `  IANA ID ${live.ianaId}` : ''}`);
console.log(`  status     ${describeRegistrarValue(live.statuses)}`);
console.log(`  registered ${live.registered ?? '(none)'}${live.changed ? `  (last changed ${live.changed})` : ''}`);
console.log(`  expires    ${live.expires ?? '(none)'}`);
console.log(`  dnssec     ${live.signed ? 'signed' : 'not signed'}`);
console.log('  nameservers');
for (const server of live.nameservers) console.log(`    ${server}`);

console.log(`\nAgainst what this repository records, observed ${REGISTRAR_FACTS.observed}:\n`);
for (const check of result.checks) {
  if (check.ok) {
    console.log(`  ✓ ${check.name.padEnd(12)} ${describeRegistrarValue(check.live)}`);
    continue;
  }
  console.log(`  ✗ ${check.name.padEnd(12)} recorded ${describeRegistrarValue(check.recorded)}`);
  console.log(`      ${' '.repeat(12)} registry ${describeRegistrarValue(check.live)}`);
}

if (result.ok) {
  console.log('\n  ✓ The registry still says what the runbook does. Nothing to update.\n');
  process.exit(0);
}

console.error('\n✗ The registry has moved on from what the runbook records.');
console.error('  Update src/registrar.js (REGISTRAR_FACTS) with the values above, then npm run build,');
console.error('  which rewrites ACCOUNTS.md; the runbook\'s \"Where it is today\" table is prose and has to');
console.error('  be edited by hand, and npm test will fail until it agrees.\n');
process.exit(1);
