/**
 * Put the verdict where someone will see it.
 *
 *     node scripts/registrar-issue.js --verdict registrar-verdict.txt
 *     node scripts/registrar-issue.js --recovered --verdict registrar-verdict.txt
 *     node scripts/registrar-issue.js --verdict registrar-verdict.txt --dry-run
 *
 * The scheduled check exits 1, and an exit 1 on a cron schedule reaches people as a CI email — the
 * notification most likely to be filtered, and the one with no reason to be read twice. So the
 * failing run also opens an issue, titled for the domain so the next run finds the same one, and
 * comments the verdict on it. The first passing run closes it with the verdict that closed it.
 *
 * `gh` does the writing; `src/registrar-issue.js` decides what the words are. `--dry-run` prints
 * those words and calls nothing, which is how the text can be read — and this script tested —
 * without a repository to post to.
 *
 * Exit 0 when the issue state now matches the verdict (created, commented, closed, or nothing to do
 * because there was no open issue to close), 1 when `gh` failed. A failure here is reported as a
 * failure: an issue that could not be filed must not look like one that was.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  ISSUE_TITLE,
  failureComment,
  issueBody,
  recoveryComment,
} from '../src/registrar-issue.js';

process.on('uncaughtException', error => {
  console.error(`\n✗ ${error.message}`);
  console.error('  The verdict was not posted. The run log still holds it, but nothing was opened or');
  console.error('  updated, and no email is a substitute for an issue someone can be assigned.\n');
  process.exitCode = 1;
});

const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};

const RECOVERED = args.includes('--recovered');
const DRY_RUN = args.includes('--dry-run');
const VERDICT_FILE = option('--verdict') ?? 'registrar-verdict.txt';
const RUN_URL = option('--run-url') ?? (process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null);
const TODAY = new Date().toISOString().slice(0, 10);

const verdict = (() => {
  try {
    return readFileSync(VERDICT_FILE, 'utf8');
  } catch {
    return '';
  }
})();

/** One `gh` call, with its output or its failure — never an empty string on error. */
const gh = (...argv) => {
  const shown = argv.map(argument => (argument.includes('\n') ? '<body>' : argument)).join(' ');
  if (DRY_RUN) {
    console.log(`  would run: gh ${shown}`);
    return '';
  }

  const run = spawnSync('gh', argv, { encoding: 'utf8' });
  if (run.error) throw new Error(`gh could not be run: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`gh ${argv[0]} ${argv[1] ?? ''} failed: ${(run.stderr ?? '').trim()}`.trim());
  return (run.stdout ?? '').trim();
};

/** The open issue with this title, or null. The title is the identity; nothing else is trusted. */
const findOpen = () => {
  const listed = gh('issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title');
  if (!listed) return null;
  const issues = JSON.parse(listed);
  return issues.find(issue => issue.title === ISSUE_TITLE)?.number ?? null;
};

if (RECOVERED) {
  const comment = recoveryComment({ verdict, today: TODAY, runUrl: RUN_URL });
  const number = findOpen();

  if (number === null) {
    console.log('  ✓ Nothing to close: no open registrar issue.');
    if (DRY_RUN) console.log(`\n${comment}\n`);
    process.exit(0);
  }

  gh('issue', 'comment', String(number), '--body', comment);
  gh('issue', 'close', String(number), '--reason', 'completed');
  console.log(`  ✓ Closed #${number}: the check passes again, so the date is not due.`);
  process.exit(0);
}

const comment = failureComment({ verdict, today: TODAY, runUrl: RUN_URL });
const open = findOpen();

if (open !== null) {
  gh('issue', 'comment', String(open), '--body', comment);
  console.log(`  ✓ Commented the verdict on #${open}: the issue already tracks this domain.`);
  process.exit(0);
}

const created = gh('issue', 'create', '--title', ISSUE_TITLE, '--body', issueBody());

// `gh issue create` prints the new issue's URL; its last path segment is the number the comment
// needs. If that changes, ask for it by title rather than guessing — commenting is the point.
const number = DRY_RUN ? null : Number(/(\d+)\s*$/.exec(created)?.[1] ?? NaN) || findOpen();
if (DRY_RUN) {
  console.log(`\n${issueBody()}\n\n${comment}\n`);
} else if (number) {
  gh('issue', 'comment', String(number), '--body', comment);
  console.log(`  ✓ Opened #${number} (${ISSUE_TITLE}) with the verdict on it.`);
} else {
  throw new Error('the issue was created but its number could not be read, so the verdict was not attached');
}

process.exit(0);
