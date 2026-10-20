/**
 * Prove the mailbox survived the move.
 *
 *   npm run mail:records                          # what the domain answers now
 *   npm run mail:records -- --save before.json    # baseline, while the old zone still answers
 *   npm run mail:records -- --compare before.json # after the switch; exit 1 on any difference
 *
 * The baseline has to be taken **before** the nameserver change: afterwards the old zone is no
 * longer authoritative, and there is nothing left to compare the new one against. `--save` refuses
 * to overwrite an existing file for the same reason — a baseline that can be refreshed into
 * agreement after the fact proves nothing, so replacing it takes `--force` and a deliberate
 * decision.
 *
 * Read-only; no token. The comparison covers MX, the SPF string, the DMARC string and every DKIM
 * key the sweep finds. An added DKIM selector is reported as a note rather than a failure, because
 * rotation is normal and a check that cries wolf gets ignored.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { HOST } from '../src/dns.js';
import { collectMail, compareMail } from '../src/mail-records.js';

const args = process.argv.slice(2);
const mode = args.includes('--save') ? 'save' : args.includes('--compare') ? 'compare' : 'show';
const force = args.includes('--force');
const path = args.find(argument => !argument.startsWith('-'));
const selectors = (process.env.DKIM_SELECTOR ?? '').split(',').map(entry => entry.trim()).filter(Boolean);

if (mode !== 'show' && !path) {
  console.error(`\n✗ --${mode} needs a file: npm run mail:records -- --${mode} before.json\n`);
  process.exit(1);
}

process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  Nothing was written. A lookup that failed is not the same answer as a');
  console.error('  record that is missing; re-run before trusting a comparison.\n');
  process.exitCode = 1;
});

const snapshot = await collectMail(HOST, { selectors });

const show = value => value ?? '(none)';

if (mode === 'show' || mode === 'save') {
  console.log(`\n${snapshot.host} — mail records\n`);
  console.log(`  MX        ${snapshot.mx.length ? snapshot.mx.map(({ priority, exchange }) => `${priority} ${exchange}`).join(', ') : '(none)'}`);
  console.log(`  SPF       ${show(snapshot.spf)}`);
  console.log(`  DMARC     ${show(snapshot.dmarc)}`);
  if (!snapshot.dkim.length) {
    console.log('  DKIM      (none) — no key at any selector the sweep asks about');
  } else {
    for (const key of snapshot.dkim) {
      console.log(`  DKIM      ${key.selector}  ${key.bits ? `${key.bits}-bit  ` : ''}${key.name}`);
    }
  }
}

if (mode === 'show') {
  console.log('\n  Save this before the nameservers change:');
  console.log('     npm run mail:records -- --save before.json\n');
  process.exit(0);
}

if (mode === 'save') {
  if (existsSync(path) && !force) {
    console.error(`\n✗ ${path} already exists.`);
    console.error('  A baseline that can be refreshed into agreement proves nothing; delete it');
    console.error('  deliberately, or pass --force if this really is a new migration.\n');
    process.exit(1);
  }
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\n  saved ${path} at ${snapshot.captured}`);
  console.log('  After the nameservers change and the zone is active:');
  console.log(`     npm run mail:records -- --compare ${path}\n`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`\n✗ Could not read ${path}: ${error.message}\n`);
  process.exit(1);
}

if (!baseline || typeof baseline.host !== 'string' || !Array.isArray(baseline.mx) || !Array.isArray(baseline.dkim)) {
  console.error(`\n✗ ${path} is not a mail snapshot: it needs host, mx and dkim.`);
  console.error('  Re-take it with --save while the old zone is still authoritative.\n');
  process.exit(1);
}

const result = compareMail(baseline, snapshot);

console.log(`\n${snapshot.host} — compared with ${path} (taken ${baseline.captured ?? 'at an unknown time'})\n`);
for (const check of result.checks) {
  if (check.ok) {
    const detail = check.name === 'MX' ? ` (${check.after})` : check.name.startsWith('DKIM ')
      ? `${check.bits?.after ? ` (${check.bits.after}-bit)` : ''}`
      : '';
    console.log(`  ✓ ${check.name.padEnd(10)} unchanged${detail}`);
    continue;
  }

  console.log(`  ✗ ${check.name.padEnd(10)} changed${check.why ? ` — ${check.why}` : ''}`);
  console.log(`      before  ${check.before ?? '(none)'}`);
  console.log(`      after   ${check.after ?? '(none)'}`);
}

for (const note of result.notes) console.log(`  · ${note}`);

if (result.ok) {
  console.log('\n  ✓ MX, SPF, DMARC and every DKIM key match the pre-cutover snapshot.\n');
  process.exit(0);
}

const failed = result.checks.filter(check => !check.ok).length;
console.log(`\n  ✗ ${failed} mail record(s) differ from the snapshot.`);
console.log('  A difference either way matters: a missing record stops delivery, an added one');
console.log('  sends mail somewhere else. Restore the "before" value in the Cloudflare zone and');
console.log('  re-run — or decide deliberately that the change is the one you want.\n');
process.exit(1);
