/**
 * The words a failing renewal check sends to a person.
 *
 * The check itself fails to an exit status, and on a nightly schedule that becomes a CI email —
 * read once, filtered soon after. So the verdict also becomes an issue, and the issue is the part
 * somebody reads months later, possibly after the thing it describes has already been fixed. That
 * makes two properties worth holding: the title is stable (it is the only thing that makes the next
 * run update this issue instead of opening a new one every morning), and the body carries no dates,
 * because a body is written once and would otherwise be the first failure forever.
 *
 * The verdict text is quoted, not summarized. The line that matters is `✗ expires … is 41 days
 * away`; a prose summary loses exactly the numbers someone would need to judge it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOST } from '../src/dns.js';
import { REGISTRAR_FACTS, RENEWAL_WARNING_DAYS } from '../src/registrar.js';
import {
  ISSUE_MARKER,
  ISSUE_TITLE,
  VERDICT_LIMIT,
  failureComment,
  issueBody,
  recoveryComment,
  verdictExcerpt,
} from '../src/registrar-issue.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/registrar.yml');
const script = read('scripts/registrar-issue.js');

/** What `npm run registrar:check` prints, banner and all. */
const output = [
  '',
  '> glam-team-cleaners@1.0.0 registrar:check',
  '> node scripts/registrar-check.js',
  '',
  '',
  `${HOST} — renewal, from the registry (https://rdap.verisign.com/net/v1/domain/${HOST})`,
  '',
  '  status     active',
  '  expires    2027-09-17  41 days away',
  '  horizon    60 days — fails from 2027-07-19',
  '',
  'Judged on 2027-08-07:',
  '',
  '  ✗ expires    2027-09-17 is 41 days away — inside the 60-day window',
  '',
  '✗ The domain needs attention before its date arrives.',
  '',
].join('\n');

test('the issue is found by a title that never carries the answer', () => {
  assert.equal(ISSUE_TITLE, `Scheduled registrar check failed — ${HOST}`);
  assert.ok(ISSUE_TITLE.includes(HOST), 'the domain is in the title, so one issue per domain');

  for (const unstable of [REGISTRAR_FACTS.expires, REGISTRAR_FACTS.observed, 'days', 'expired', 'active']) {
    assert.equal(
      ISSUE_TITLE.toLowerCase().includes(unstable.toLowerCase()),
      false,
      `a title with ${unstable} in it would open a new issue every time the answer changed`,
    );
  }

  assert.match(ISSUE_MARKER, /^<!--/, 'the marker is a comment, so it renders as nothing');
  assert.match(ISSUE_MARKER, /do not rename/, 'and says why the title must stay');
});

test('the verdict is quoted, not summarized, and npm’s banner is not part of it', () => {
  const excerpt = verdictExcerpt(output);

  assert.equal(excerpt.includes('glam-team-cleaners@1.0.0'), false, 'the npm banner is not the verdict');
  assert.equal(excerpt.includes('node scripts/registrar-check.js'), false);
  assert.match(excerpt, /✗ expires\s+2027-09-17 is 41 days away/, 'the line someone acts on is kept whole');
  assert.match(excerpt, /✗ The domain needs attention/, 'and so is the closing sentence');
  assert.equal(excerpt, excerpt.trim(), 'no leading or trailing blank lines inside the fence');
  assert.equal(/\n{3,}/.test(excerpt), false, 'and no run of blank lines where the banner was');

  assert.equal(verdictExcerpt(''), '(the check printed nothing)', 'a run with no output says so rather than showing an empty fence');
  assert.equal(verdictExcerpt('   \n\n'), '(the check printed nothing)');

  const long = verdictExcerpt('x'.repeat(VERDICT_LIMIT + 500));
  assert.ok(long.startsWith('x'.repeat(100)), 'the beginning is kept');
  assert.match(long, /truncated: the full output is in the run log/, 'and truncation is not silent');
  assert.ok(long.length < VERDICT_LIMIT + 200, 'the comment stays far below the 65536-character limit');
});

test('the body explains the issue and carries nothing that will go stale', () => {
  const body = issueBody();

  assert.ok(body.includes(`https://rdap.verisign.com/net/v1/domain/${HOST}`), 'it says where the answer comes from');
  assert.ok(body.includes('npm run registrar'), 'and how to read it again');
  assert.ok(body.includes('npm run registrar:check'), 'and how to reproduce the judgement');
  assert.ok(body.includes(`${RENEWAL_WARNING_DAYS} days`), 'the window is named from the constant, not retyped');
  assert.ok(body.includes(REGISTRAR_FACTS.registrar), 'the registrar to renew with is named');
  assert.ok(body.includes('https://www.domainregistry.com/login/'), 'and where to renew');
  assert.ok(body.includes('npm run registrar:adopt'), 'the recorded facts are adopted, not retyped');
  assert.ok(body.includes('npm run build'), 'and the build that re-renders ACCOUNTS.md from them');
  assert.ok(body.trimEnd().endsWith(ISSUE_MARKER), 'the marker closes it, out of the rendered text');

  assert.equal(body.includes(REGISTRAR_FACTS.expires), false, 'the expiry is a fact of one run, not of the issue');
  assert.equal(body.includes(REGISTRAR_FACTS.observed), false, 'and so is the day it was observed');
  assert.equal(/renewed|has lapsed|has expired/i.test(body), false, 'the body must not claim an outcome it cannot know');
});

/**
 * The body is the one place a person is told what to do, and the order is the instruction: renewing
 * before reading the registry, or rebuilding before the facts are updated, produces a runbook that
 * disagrees with the registry in the direction nobody checks. So the order is asserted as an order,
 * not as a set of mentions.
 */
test('the body is a checklist in the order the work happens', () => {
  const body = issueBody();
  const boxes = [...body.matchAll(/^- \[( |x)\] \*\*(.+?)\*\*/gm)].map(match => match[2]);

  assert.deepEqual(
    boxes,
    ['Renew', 'Confirm the registry agrees', 'Adopt it', 'Verify'],
    'each step once, in the order it has to happen',
  );
  assert.equal(/^- \[x\]/m.test(body), false, 'nothing is pre-ticked: an unticked box is what a person has to act on');

  const at = label => body.indexOf(`**${label}**`);
  for (const [before, after] of [
    ['Renew', 'Confirm the registry agrees'],
    ['Confirm the registry agrees', 'Adopt it'],
    ['Adopt it', 'Verify'],
  ]) {
    assert.ok(at(before) !== -1 && at(before) < at(after), `${before} must come before ${after}`);
  }

  const adopt = body.slice(at('Adopt it'), at('Verify'));
  assert.match(adopt, /npm run registrar:adopt/, 'the transcription step is one command now');
  assert.match(adopt, /--apply/, 'and it does not write on the dry run');
  assert.equal(/src\/registrar\.js/.test(adopt), false, 'the body no longer tells anyone to edit the facts by hand');
  assert.match(body.slice(at('Verify')), /npm run registrar:check/, 'and the last step is the command the schedule runs');
  assert.match(
    body.replace(/\s+/g, ' '),
    /nothing in this workflow ticks them/,
    'the boxes are not automated, so the body must not imply the workflow works them',
  );
});

test('each run is a dated comment, and the closing one is evidence rather than a verdict', () => {
  const failed = failureComment({ verdict: output, today: '2027-08-07', runUrl: 'https://github.com/o/r/actions/runs/1' });
  assert.match(failed, /^### 2027-08-07 — failed/);
  assert.match(failed, /✗ expires\s+2027-09-17 is 41 days away/);
  assert.match(failed, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  assert.match(failed, /```text\n/, 'the verdict is fenced, because it contains backticks');

  const offline = failureComment({ verdict: output, today: '2027-08-07' });
  assert.equal(offline.includes('Run:'), false, 'a run with no URL says nothing rather than "Run: null"');

  const recovered = recoveryComment({ verdict: output, today: '2027-09-01', runUrl: 'https://github.com/o/r/actions/runs/2' });
  assert.match(recovered, /^### 2027-09-01 — recovered/);
  assert.match(recovered.replace(/\s+/g, ' '), /Closing this; a later failure opens it again/, 'wrapped prose, one sentence');
  assert.match(recovered, /✓|✗/, 'the verdict that closed it is included');
  assert.equal(/renewed the domain/i.test(recovered), false, 'a passing check does not prove a renewal happened');
});

test('the workflow files the issue, and keeps failing while it does', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts['registrar:issue'], 'node scripts/registrar-issue.js');
  assert.match(workflow, /^\s+issues: write$/m, 'the token needs to write an issue');
  assert.match(workflow, /^\s+contents: read$/m, 'and nothing more than that for code');

  const failure = workflow.slice(workflow.indexOf('name: File or update the issue'), workflow.indexOf('name: Close the issue'));
  assert.match(failure, /if: failure\(\)/, 'it runs exactly when the check failed');
  assert.match(failure, /steps\.check\.outcome == 'failure'/, 'and not when a checkout or setup step failed, which has no verdict');
  assert.match(workflow, /id: check/, 'the step whose outcome that condition reads is the check');
  assert.match(failure, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'with a token gh can use');
  assert.match(failure, /npm run registrar:issue -- --verdict "\$VERDICT"/, 'and posts the file the check wrote');

  const recovery = workflow.slice(workflow.indexOf('name: Close the issue'), workflow.indexOf('name: Summarize'));
  assert.match(recovery, /if: success\(\)/, 'the closing run is the passing one');
  assert.match(recovery, /--recovered/, 'and it says which side of the verdict it is on');

  assert.match(workflow, /VERDICT: registrar-verdict\.txt/, 'the file is named once, in the environment');
  assert.match(workflow, /tee "\$VERDICT"/, 'and what the check printed is kept for the issue');
  assert.match(workflow, /set -o pipefail/, 'without it the exit status would be tee’s, and the check would never fail');
  assert.equal(/^\s+continue-on-error:/m.test(workflow), false, 'a scheduled check that cannot fail its job is not a check');

  assert.equal(/writeFileSync|appendFileSync|rmSync/.test(script), false, 'the script edits no files, only the issue');
  assert.match(script, /catch \{\s*return '';/, 'a missing verdict file is reported as no output, not as a crash before filing');
  assert.match(script, /throw new Error\(`gh \$\{argv\[0\]\}/, 'and a failed gh call is an error, not a silent success');
  assert.match(script, /if \(DRY_RUN\) \{\s*console\.log/, '--dry-run prints the words instead of posting them');
});
