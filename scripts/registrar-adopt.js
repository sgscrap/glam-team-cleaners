/**
 * Record what the registry now says, in both files that state it — then prove it.
 *
 *     npm run registrar:adopt              # what would change, and nothing written
 *     npm run registrar:adopt -- --apply   # write, rebuild, run the guards
 *
 * Renewing the domain changes dates; keeping this repository honest about them used to mean copying
 * from `npm run registrar` into `src/registrar.js`, rebuilding, and editing the runbook's prose by
 * hand. That is the step most likely to be done wrong at the moment it is done, and the failure it
 * produces is quiet: a runbook that disagrees with the registry in the direction nobody checks.
 *
 * So this command adopts: it reads RDAP once, rewrites `REGISTRAR_FACTS` and the three places in
 * `DOMAIN.md` that restate them, appends the answer to `registrar-history.json` so the renewal is a
 * dated line rather than an overwrite, re-renders `ACCOUNTS.md` through the normal build, and runs
 * the guard suite — which is what proves nothing was missed, since those tests hold the runbook to
 * the recorded facts. `--apply` is required to write, the same shape as `npm run dns:cloudflare`.
 *
 * It refuses two answers rather than recording them: one that is missing facts (there is nothing
 * whole to write), and one whose *registrar of record* differs — a transfer is not a renewal, and
 * the runbook's prose about where this domain came from would then be about another company.
 *
 * Exit 0 when the registry and the files already agree, or when `--apply` wrote and verified them;
 * 1 in a dry run that found something to adopt, and when a build or a guard fails afterwards; 2 when
 * the answer cannot be adopted and a person has to act.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  REGISTRAR_FACTS,
  adoptRegistrar,
  describeRegistrarValue,
  fetchRegistrar,
  rdapUrl,
} from '../src/registrar.js';
import {
  HISTORY_FILE,
  parseHistory,
  recordObservation,
  renderHistory,
} from '../src/registrar-history.js';

const APPLY = process.argv.slice(2).includes('--apply');
const SOURCE = fileURLToPath(new URL('../src/registrar.js', import.meta.url));
const RUNBOOK = fileURLToPath(new URL('../DOMAIN.md', import.meta.url));
const HISTORY = fileURLToPath(new URL(`../${HISTORY_FILE}`, import.meta.url));
const OBSERVED = new Date().toISOString().slice(0, 10);

const read = path => readFileSync(path, 'utf8');

const live = await fetchRegistrar(REGISTRAR_FACTS.host).catch(error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  The registry was not read, so nothing was adopted and nothing was written.');
  console.error('  A lookup that failed is not a domain that changed.\n');
  process.exit(1);
});

let plan;
let recorded;
try {
  plan = adoptRegistrar({ source: read(SOURCE), runbook: read(RUNBOOK) }, REGISTRAR_FACTS, live, { observed: OBSERVED });
  recorded = recordObservation(parseHistory(read(HISTORY)), live, { today: OBSERVED });
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing was written: adoption is all or nothing, so half a runbook cannot happen.\n');
  process.exit(2);
}

const { facts, runbook } = plan.changes;
if (!facts.length && !runbook.length && !recorded.added) {
  console.log(`\n✓ ${live.host}: the registry still says what this repository records (${rdapUrl(live.host)}).`);
  console.log(`  Nothing to adopt, and ${HISTORY_FILE} already ends with this answer.\n`);
  process.exit(0);
}

const moved = facts.length > 0 || runbook.length > 0;
console.log(`\n${live.host} — ${moved
  ? 'the registry has moved on from what this repository records'
  : `the timeline does not yet end with the registry's answer`}\n`);
for (const change of facts) {
  console.log(`  ${change.field.padEnd(12)} ${describeRegistrarValue(change.from)} → ${describeRegistrarValue(change.to)}`);
}

if (recorded.added) {
  console.log(`\n${HISTORY_FILE}\n`);
  console.log(`  + ${recorded.added.observed}  ${describeRegistrarValue(recorded.added.statuses)}, expires ${recorded.added.expires}`);
  if (recorded.replaced) console.log('    (replacing that day\'s earlier reading, not adding a second entry for it)');
}

if (runbook.length) {
  console.log('\nDOMAIN.md\n');
  for (const change of runbook) {
    console.log(`  - ${change.label}`);
    console.log(`      ${change.from}`);
    console.log(`    + ${change.to}`);
  }
}

if (!APPLY) {
  console.log('\n  Nothing was written. Run it with --apply to write these files, rebuild ACCOUNTS.md,');
  console.log('  and run the guards that hold the runbook to the recorded facts.\n');
  process.exit(1);
}

// Only a file that actually changes is written: an adoption that is behind on the timeline alone
// must not touch the files whose contents already agree with the registry.
if (facts.length) {
  writeFileSync(SOURCE, plan.source);
  console.log('\n  wrote  src/registrar.js    (REGISTRAR_FACTS)');
}
if (runbook.length) {
  writeFileSync(RUNBOOK, plan.runbook);
  console.log('  wrote  DOMAIN.md           (the three places that restate them)');
}
if (recorded.added) {
  writeFileSync(HISTORY, renderHistory(recorded.entries));
  console.log(`  wrote  ${HISTORY_FILE.padEnd(21)} (the timeline gains one dated answer)`);
}
console.log('');

const run = (path, label) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(path, import.meta.url))], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed with exit ${result.status ?? 'signal'}.`);
    console.error('  The files were written; review `git diff` before doing anything else.\n');
    process.exit(1);
  }
};

// The build re-renders ACCOUNTS.md from the facts just written, and runs the build guards; the
// suite then proves the runbook and the page agree with the registry's answer.
run('../src/build.js', 'npm run build');
run('../scripts/test.js', 'npm test');

console.log('\n  ✓ Adopted and verified: the facts, the runbook and ACCOUNTS.md agree with the registry.');
console.log('    Review `git diff` and commit it — the next scheduled run will agree and stay quiet.\n');
process.exit(0);
