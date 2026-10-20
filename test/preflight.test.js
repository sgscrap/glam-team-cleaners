/**
 * The preflight: the plan, the summary and the one line that matters.
 *
 * A go/no-go verdict is only worth as much as its worst case, so most of this file is about the
 * ways a run can look finished without being one: a check that failed being counted as a pass, a
 * mail report with nothing to compare against being counted as a pass, a missing script being run
 * anyway, and the DKIM answer — the one check that legitimately passes with bad news — reading as
 * "signed" when the domain publishes no key at all.
 *
 * No spawning here: `src/preflight.js` decides what an exit status means, so the statuses are
 * supplied as data and the script that runs them stays a pipe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CHECKS, dkimDetail, preflightPlan, preflightVerdict, summaryLines } from '../src/preflight.js';
import { MAIL_BASELINE } from '../src/mail-records.js';

test('the three checks are the read-only ones, in the order the runbook lists them', () => {
  const plan = preflightPlan();
  assert.deepEqual(plan.map(check => check.id), ['dkim', 'domain', 'mail']);

  for (const check of plan) {
    assert.ok(
      existsSync(new URL(`../${check.script}`, import.meta.url)),
      `preflight runs ${check.script}, which must exist`,
    );
    assert.ok(check.asks && check.fix, `${check.id} must say what it asks and what to do when it fails`);
  }

  assert.equal(
    plan.every(check => !check.script.includes('dns-cloudflare')),
    true,
    'the preflight is read-only: it must not run the one script that writes',
  );
});

test('the mail check compares only when there is a baseline, and is not a pass without one', () => {
  const before = preflightPlan({ exists: () => false });
  const mail = before.find(check => check.id === 'mail');
  assert.deepEqual(mail.args, [], 'no baseline: the check reports, it cannot compare');
  assert.equal(mail.required, false, 'a report with nothing to judge must not be counted as a pass');
  assert.match(mail.report, /no baseline/);

  const missing = preflightPlan({ baseline: 'custom.json', exists: () => false });
  assert.equal(missing.find(check => check.id === 'mail').baseline, 'custom.json', 'the path named is the path reported');
  assert.equal(missing.filter(check => check.required).length, 2, 'and the other two are still required');

  const after = preflightPlan({ exists: () => true });
  const comparing = after.find(check => check.id === 'mail');
  assert.deepEqual(comparing.args, ['--compare', MAIL_BASELINE]);
  assert.equal(comparing.comparing, true);
  assert.equal(comparing.required, true, 'once there is a baseline, a difference has to fail the run');
});

test('the DKIM answer is read out of the output, not assumed from the exit status', () => {
  assert.match(dkimDetail('  tried    153 names\n  found    none\n\n'), /no key is published/);
  assert.match(dkimDetail('  found    2 published key(s)\n'), /2 selectors/);
  assert.match(dkimDetail('  found    1 published key(s)\n'), /1 selector\b/);
  assert.equal(
    dkimDetail('something else entirely'),
    'the zone answered',
    'a reworded script must not be read as either answer',
  );
});

test('a row per check, marked, with what it means', () => {
  const rows = [
    { id: 'dkim', title: 'DKIM', status: 'pass', detail: 'no key is published, so the move carries none and nothing signs with this domain' },
    { id: 'domain', title: 'Domain', status: 'fail', detail: 'exit 1 — that is step 3 and step 4 in DOMAIN.md' },
    { id: 'mail', title: 'Mail records', status: 'report', detail: 'no baseline yet, so there is nothing to compare' },
  ];

  assert.deepEqual(summaryLines(rows), [
    '  ✓ DKIM         no key is published, so the move carries none and nothing signs with this domain',
    '  ✗ Domain       exit 1 — that is step 3 and step 4 in DOMAIN.md',
    '  – Mail records no baseline yet, so there is nothing to compare',
  ]);
});

test('the verdict is GO only when nothing failed', () => {
  const pass = preflightVerdict([
    { id: 'dkim', title: 'DKIM', status: 'pass', detail: 'a key is published under 1 selector' },
    { id: 'domain', title: 'Domain', status: 'pass', detail: 'the canonical host serves this build' },
    { id: 'mail', title: 'Mail records', status: 'pass', detail: 'every mail record matches the baseline' },
  ]);
  assert.equal(pass.ok, true);
  assert.equal(pass.line, 'GO — 3 of 3 checks pass.');
  assert.equal(pass.hint, null);

  const failed = preflightVerdict([
    { id: 'dkim', title: 'DKIM', status: 'pass', detail: '' },
    { id: 'domain', title: 'Domain', status: 'fail', detail: 'exit 1' },
    { id: 'mail', title: 'Mail records', status: 'fail', detail: 'exit 1' },
  ]);
  assert.equal(failed.ok, false);
  assert.match(failed.line, /^NO-GO — 2 of 3 checks did not pass: Domain, Mail records\.$/);
  assert.ok(failed.hint, 'a no-go has to say what to do next');
});

test('a check that could not be compared is named, not counted as a pass', () => {
  const verdict = preflightVerdict([
    { id: 'dkim', title: 'DKIM', status: 'pass', detail: '' },
    { id: 'domain', title: 'Domain', status: 'pass', detail: '' },
    { id: 'mail', title: 'Mail records', status: 'report', detail: 'no baseline yet, so there is nothing to compare' },
  ]);

  assert.equal(verdict.ok, true, 'a report that cannot fail cannot stop the move');
  assert.equal(verdict.line, 'GO — 2 of 3 checks pass, 1 could not be compared yet.');
  assert.match(verdict.hint, /apply run saves one/, 'and it says where the baseline comes from');
  assert.equal(
    verdict.line.includes('3 of 3'),
    false,
    'the count must not claim a check that never ran a comparison',
  );
});

test('the default baseline is the file the apply run writes', () => {
  assert.equal(MAIL_BASELINE, 'mail-baseline.json');
  assert.equal(
    preflightPlan().find(check => check.id === 'mail').baseline,
    MAIL_BASELINE,
    'the preflight and the apply run have to agree on the path',
  );
});

test('the runbook names the preflight and the checks agree with it', () => {
  const runbook = readFileSync(new URL('../DOMAIN.md', import.meta.url), 'utf8');
  assert.match(runbook, /npm run preflight/, 'DOMAIN.md tells the operator the command exists');

  for (const check of CHECKS) {
    assert.match(
      runbook,
      new RegExp(`npm run ${check.id === 'domain' ? 'domain' : check.id === 'mail' ? 'mail:records' : 'dkim'}`),
      `the runbook lists the ${check.id} check the preflight runs`,
    );
  }
});
