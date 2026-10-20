/**
 * The three questions this migration has to answer, as one command with one verdict.
 *
 * Each of them already exists as a script, and each is read-only: `npm run dkim` asks whether
 * anything is published at `<selector>._domainkey`, `npm run domain` asks whether the canonical
 * host really serves this build, and `npm run mail:records` reports what the domain answers for
 * MX, SPF, DMARC and every DKIM key — or compares that against the baseline once one exists.
 *
 * Running them one at a time is how a domain gets moved having answered two of the three: the
 * answer to the first is read, the second is skipped because it was known to be red before the
 * nameservers moved, and the third is forgotten. So the three are run in order, each one's output
 * is passed through untouched, and the last line says whether the move has everything it needs.
 *
 * What the verdict means, exactly: a check passes when the command that owns it exits 0, because
 * that is what each of those commands promises — `npm run dkim` exits 0 for "no key is published"
 * (that is the answer, not a failure) and 1 only when DNS could not be read at all. DKIM's answer
 * is read out of its output for the same reason, so a domain that signs with nothing says so
 * instead of passing as though it signed.
 *
 * The mail check is the one that changes shape. With no baseline on disk there is nothing to
 * compare against — the apply run saves it before it writes — so the command is a report, it
 * cannot fail, and it is named in the verdict as not compared rather than counted as a pass.
 * That is the pre-cutover state, and the verdict has to be honest about which of the two it is in.
 *
 * Here rather than in the script so the plan and the verdict can be tested without spawning
 * anything: the script supplies the exit statuses, this decides what they mean.
 */
import { existsSync } from 'node:fs';
import { HOST } from './dns.js';
import { MAIL_BASELINE } from './mail-records.js';

/**
 * What `npm run dkim` found, in one phrase, for a verdict line.
 *
 * Its output is the only place the difference between "a key is published" and "this domain signs
 * with nothing" is written down, and a fallback phrase keeps a reworded script from being read as
 * either one.
 */
export const dkimDetail = output => {
  if (/^\s*found\s+none\s*$/m.test(output)) {
    return 'no key is published, so the move carries none and nothing signs with this domain';
  }
  const count = /^\s*found\s+(\d+) published key/m.exec(output);
  if (!count) return 'the zone answered';
  return `a key is published under ${count[1]} selector${count[1] === '1' ? '' : 's'}`;
};

/**
 * The checks, in the order they are run: the key that has to be carried, the host that has to
 * serve, and the mailbox that has to arrive intact. `--compare` on the last one is only meaningful
 * once a baseline exists, which is what `preflightPlan` decides.
 */
export const CHECKS = [
  {
    id: 'dkim',
    title: 'DKIM',
    script: 'scripts/dkim.js',
    asks: `whether anything is published at <selector>._domainkey.${HOST}`,
    // Read from the output, because "no key is published" is an answer, not a signature.
    read: dkimDetail,
    fix: 'a lookup that failed is not the same answer as a name that holds no key — run it again',
  },
  {
    id: 'domain',
    title: 'Domain',
    script: 'scripts/verify-domain.js',
    asks: 'whether the canonical host serves the pages this build emits',
    pass: 'the canonical host serves this build',
    fix: 'the registrar and the Pages settings are steps 3 and 4 in DOMAIN.md',
  },
  {
    id: 'mail',
    title: 'Mail records',
    script: 'scripts/mail-records.js',
    asks: 'whether MX, SPF, DMARC and every DKIM key answer as they did before the move',
    pass: 'every mail record matches the baseline',
    report: 'no baseline yet, so there is nothing to compare',
    fix: 'a difference in MX, SPF, DMARC or a key stops delivery or sends mail elsewhere',
  },
];

/**
 * The commands to run, with the mail check turned into a comparison when the baseline is there.
 *
 * `exists` is injectable so a test can ask without a file. `required` is what the verdict counts: a
 * report that cannot fail must not be counted as a pass.
 */
export const preflightPlan = ({ baseline = MAIL_BASELINE, exists = existsSync } = {}) => {
  const comparing = exists(baseline);
  return CHECKS.map(check => (check.id !== 'mail'
    ? { ...check, args: [], baseline: null, required: true }
    : {
      ...check,
      args: comparing ? ['--compare', baseline] : [],
      baseline,
      comparing,
      required: comparing,
    }));
};

/** `✓` passed, `✗` did not, `–` ran but had nothing to judge — the three rows a run can produce. */
const MARK = { pass: '✓', fail: '✗', report: '–' };

const detail = row => row.detail
  || (row.status === 'pass' ? 'passed' : row.status === 'report' ? 'not compared' : 'did not pass');

export const summaryLines = rows => rows.map(row => `  ${MARK[row.status]} ${row.title.padEnd(12)} ${detail(row)}`);

/**
 * One line the operator can act on: go, or no-go and which checks stopped it.
 *
 * `ok` is only true when nothing failed. Checks that could not be compared yet are named in the
 * line rather than hidden behind the count, because "2 of 3" on its own reads like a failure.
 */
export const preflightVerdict = rows => {
  const passed = rows.filter(row => row.status === 'pass').length;
  const failed = rows.filter(row => row.status === 'fail');
  const skipped = rows.filter(row => row.status === 'report').length;
  const total = rows.length;

  if (failed.length) {
    return {
      ok: false,
      line: `NO-GO — ${failed.length} of ${total} checks did not pass: ${failed.map(row => row.title).join(', ')}.`,
      hint: 'The output above each row is the detail. Run `npm run preflight` again once those answer.',
    };
  }

  return {
    ok: true,
    line: `GO — ${passed} of ${total} checks pass${skipped ? `, ${skipped} could not be compared yet` : ''}.`,
    hint: skipped
      ? 'Nothing is wrong: there is simply no baseline to compare the mail records with. The apply run saves one before it writes.'
      : null,
  };
};
