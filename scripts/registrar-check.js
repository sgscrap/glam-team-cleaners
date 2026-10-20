/**
 * The one check that has to run on a clock.
 *
 *     npm run registrar:check
 *     npm run registrar:check -- --as-of 2027-07-19   # judge it as if that day were today
 *     npm run registrar:check -- --record             # and keep this answer in the history
 *
 * Every other guard in this repository is triggered by a push: the build compares artifacts, the
 * tests compare the runbook against the registry, `npm run check` compares the committed pages with
 * `src/`. All of them can pass on the last day the domain is yours, because a date does not change
 * when a file does. This is the failure mode the runbook's one dated fact has always had.
 *
 * So: read RDAP, and fail when the domain is within `RENEWAL_WARNING_DAYS` of expiring, when it has
 * already expired, or when the registry's status is no longer what `REGISTRAR_FACTS` records. A
 * lookup that could not be answered is also a failure — the check cannot say the domain is fine
 * when it was not told anything.
 *
 * Nothing is renewed, and nothing is written unless `--record` asks for it: the exit status is the
 * whole output worth acting on. `.github/workflows/registrar.yml` runs this daily, which is what
 * turns a date into something that speaks before it arrives — and it does not record, because a
 * scheduled workflow that commits to the branch it runs on needs write access and races the deploy;
 * the timeline is extended by a person, with this flag or by `npm run registrar:adopt`.
 *
 * `--as-of` exists because the failure this check is built for happens on a day nobody chose, and a
 * check that can only be seen failing on that day proves nothing until then. It moves the day, not
 * the registry: the RDAP answer is still live, so the run says exactly what a real one would say.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  REGISTRAR_FACTS,
  describeRegistrarValue,
  fetchRegistrar,
  rdapUrl,
  renewalVerdict,
} from '../src/registrar.js';
import {
  HISTORY_FILE,
  parseHistory,
  recordObservation,
  renderHistory,
} from '../src/registrar-history.js';

const RECORD = process.argv.slice(2).includes('--record');

process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  The registry was not read, so nothing is known about the expiry either way.');
  console.error('  A failed lookup is not a domain that is fine.\n');
  process.exitCode = 1;
});

/** `YYYY-MM-DD`, and a usage error rather than a verdict when it is not. */
const asOf = (() => {
  const flag = process.argv.slice(2).indexOf('--as-of');
  if (flag === -1) return new Date().toISOString().slice(0, 10);

  const value = process.argv.slice(2)[flag + 1] ?? '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!parsed) {
    console.error('\n✗ --as-of needs a date in YYYY-MM-DD: npm run registrar:check -- --as-of 2027-07-19\n');
    process.exit(2);
  }
  return value;
})();

const live = await fetchRegistrar(REGISTRAR_FACTS.host);
const verdict = renewalVerdict(REGISTRAR_FACTS, live, { today: asOf });
const { expiry, statuses } = verdict;

const remaining = () => {
  if (expiry.days === null) return 'the registry did not say';
  if (expiry.days < 0) return `expired ${Math.abs(expiry.days)} days ago`;
  if (expiry.days === 0) return 'expires today';
  return `${expiry.days} days away`;
};

console.log(`\n${live.host} — renewal, from the registry (${rdapUrl(live.host)})\n`);
console.log(`  status     ${describeRegistrarValue(live.statuses)}`);
console.log(`  expires    ${expiry.expires ?? '(none)'}  ${remaining()}`);
console.log(`  horizon    ${expiry.warnDays} days — fails from ${expiry.warnFrom ?? '(unknown)'}`);

/**
 * The history, extended by one answer if it is a new one. Recorded to the day it was read — not to
 * `--as-of`, which moves the judgement rather than the observation — and only when the answer is
 * not already the head, so running this daily does not grow a file of identical lines.
 */
if (RECORD) {
  const path = fileURLToPath(new URL(`../${HISTORY_FILE}`, import.meta.url));
  let entries;
  try {
    entries = parseHistory(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    console.error('  Nothing was recorded: the history is the timeline, and a broken one is not extended.\n');
    process.exit(2);
  }

  const recorded = recordObservation(entries, live);
  if (recorded.added) {
    writeFileSync(path, renderHistory(recorded.entries));
    console.log(`\n  history    recorded ${recorded.added.observed} in ${HISTORY_FILE}${recorded.replaced ? ', replacing that day\'s earlier reading' : ''}`);
  } else {
    console.log(`\n  history    ${HISTORY_FILE} already ends with this answer — nothing recorded`);
  }
}

console.log(`\nJudged on ${verdict.today}:\n`);

if (statuses.ok) {
  console.log(`  ✓ status     ${describeRegistrarValue(statuses.live)}, as recorded`);
} else {
  console.log(`  ✗ status     recorded ${describeRegistrarValue(statuses.recorded)} on ${REGISTRAR_FACTS.observed}`);
  console.log(`      ${' '.repeat(12)} registry ${describeRegistrarValue(statuses.live)}`);
}

if (expiry.state === 'fine') {
  console.log(`  ✓ expires    ${expiry.expires}, outside the ${expiry.warnDays}-day window`);
} else if (expiry.state === 'near') {
  console.log(`  ✗ expires    ${expiry.expires} is ${expiry.days} days away — inside the ${expiry.warnDays}-day window`);
  console.log('      Renew it at the registrar before this becomes an outage, then update REGISTRAR_FACTS.');
} else if (expiry.state === 'expired') {
  console.log(`  ✗ expires    ${expiry.expires} — expired ${Math.abs(expiry.days)} days ago`);
} else {
  console.log('  ✗ expires    the registry answered without an expiration date, so nothing can be judged');
}

if (verdict.ok) {
  console.log(`\n  ✓ Nothing is due: ${expiry.days} days of registration left.\n`);
  process.exit(0);
}

console.error('\n✗ The domain needs attention before its date arrives.');
if (!statuses.ok) {
  console.error('  A status change is not a renewal: check the registrar portal for what happened to');
  console.error(`  the domain, and update REGISTRAR_FACTS (${REGISTRAR_FACTS.observed}) once it is understood.`);
}
if (!expiry.ok) {
  console.error(`  Renew at ${REGISTRAR_FACTS.registrar}'s portal; \`npm run registrar\` prints what the`);
  console.error('  registry says now, and `npm run build` re-renders ACCOUNTS.md from the recorded facts.');
}
console.error(`\n  This check runs daily in CI; ${expiry.warnDays} days is the window it refuses to`);
console.error('  let pass unnoticed.\n');
process.exit(1);
