/**
 * One command, one verdict: is this domain ready for the move, or already through it?
 *
 *     npm run preflight                              # the three checks, in order
 *     npm run preflight -- --baseline before.json    # compare against a named baseline
 *
 * It runs the three read-only checks this migration has — DKIM, the domain and the mail records —
 * in that order, passes each one's output through untouched, and ends with a single line: GO when
 * nothing failed, NO-GO naming the checks that did. Each check's own exit status is the answer,
 * and what that means is decided in `src/preflight.js` rather than here.
 *
 * Read-only, like the three it runs: no token, and nothing written but the output. `npm run
 * dns:cloudflare -- --apply` takes the mail baseline itself; this compares against it once it
 * exists, and says so when it does not.
 *
 * `PREFLIGHT_TIMEOUT` (seconds, default 180) bounds each check: a DNS lookup that hangs is not an
 * answer, and a preflight that never returns cannot be part of a decision.
 */
import { spawnSync } from 'node:child_process';
import { preflightPlan, preflightVerdict, summaryLines } from '../src/preflight.js';

const TIMEOUT = Math.max(1, Number(process.env.PREFLIGHT_TIMEOUT ?? 180)) * 1000;

/** The same `--baseline <file>` / `--baseline=<file>` the apply run takes. */
const baseline = (() => {
  const args = process.argv.slice(2);
  const index = args.indexOf('--baseline');
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) return args[index + 1];
  const inline = args.find(argument => argument.startsWith('--baseline='));
  return inline ? inline.slice('--baseline='.length) : undefined;
})();

const plan = preflightPlan(baseline === undefined ? {} : { baseline });

console.log(`\nPreflight — ${plan.length} checks, in order\n`);

const rows = [];

for (const [index, check] of plan.entries()) {
  const command = `node ${check.script}${check.args.length ? ` ${check.args.join(' ')}` : ''}`;
  console.log(`── ${index + 1}/${plan.length}  ${check.title} — ${check.asks}`);
  console.log(`   $ ${command}\n`);

  const started = Date.now();
  const run = spawnSync(process.execPath, [check.script, ...check.args], {
    encoding: 'utf8',
    timeout: TIMEOUT,
    env: process.env,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (output && !output.endsWith('\n')) process.stdout.write(`${output}\n`);
  else process.stdout.write(output);

  const timedOut = run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM';
  const status = timedOut ? 'fail' : run.status === 0 ? (check.required ? 'pass' : 'report') : 'fail';
  const detail = timedOut
    ? `did not finish within ${TIMEOUT / 1000}s`
    : status === 'fail'
      ? `exit ${run.status ?? 'unknown'}${run.signal ? ` (${run.signal})` : ''} — ${check.fix}`
      : status === 'report'
        ? check.report
        : check.read
          ? check.read(output)
          : check.pass;

  console.log(`   (${seconds}s)\n`);
  rows.push({ id: check.id, title: check.title, status, detail });
}

const verdict = preflightVerdict(rows);

console.log('Preflight\n');
console.log(summaryLines(rows).join('\n'));
console.log(`\n${verdict.line}\n`);
if (verdict.hint) console.log(`${verdict.hint}\n`);

// The baseline this compared against, so the run says which reading it judged — the counts above
// mean nothing without it.
const compared = plan.find(check => check.id === 'mail');
console.log(
  compared.comparing
    ? `Mail was compared with ${compared.baseline}.\n`
    : `Mail records were reported, not compared: ${compared.baseline} is not there.\n`,
);

process.exit(verdict.ok ? 0 : 1);
