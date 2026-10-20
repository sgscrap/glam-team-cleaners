/**
 * What a failing scheduled run says to a person, as text.
 *
 * The check in `scripts/registrar-check.js` fails to an exit status, and an exit status on a cron
 * schedule becomes a CI email — which is the quietest notification GitHub offers, and exactly the
 * kind of thing that is filtered, ignored, or delivered to an address nobody reads. A domain that
 * stops being yours does not send a second notice.
 *
 * So the failure also becomes an issue: one per domain, found by its title, commented on every time
 * it fails and closed by the first run that passes. The issue is a timeline rather than a snapshot,
 * because what a renewal does to an expiry date is a sequence — `2027-09-17` becoming `2028-09-17`
 * is the difference between a registration that lapsed and one that did not.
 *
 * The text lives here, away from the shell in the workflow, for the same reason every other claim in
 * this repository does: it is read at the worst possible moment, so it has to be checked by
 * something other than whoever wrote it. `scripts/registrar-issue.js` only runs `gh`; every word
 * below is rendered and tested here.
 */
import { HOST } from './dns.js';
import { REGISTRAR_FACTS, RENEWAL_WARNING_DAYS } from './registrar.js';

/**
 * The issue's identity. The workflow finds the open issue by this exact title, so it must not carry
 * a date or a verdict — either would make every run open a new issue instead of updating one.
 */
export const ISSUE_TITLE = `Scheduled registrar check failed — ${HOST}`;

/** A hidden marker, so a human scanning the source of an issue can tell where it came from. */
export const ISSUE_MARKER = '<!-- registrar-check: opened by .github/workflows/registrar.yml; do not rename this issue, its title is how the next failing run finds it -->';

/** How much of the check's output an issue comment carries. Comments are capped at 65536. */
export const VERDICT_LIMIT = 12000;

/**
 * The check's output, with npm's own banner removed.
 *
 * `npm run registrar:check` prints `> glam-team-cleaners@1.0.0 registrar:check` and the command line
 * before anything the check has to say; in an issue that is two lines of noise above the verdict.
 * Nothing else is rewritten — a verdict that is quoted is worth more than one that is summarized,
 * and the lines that matter (`✗ expires …`) are the ones a summarizer would smooth over.
 */
export const verdictExcerpt = (text = '', limit = VERDICT_LIMIT) => {
  const lines = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^>\s/.test(line.trim()));

  // Collapse the blank runs left behind by the banner, and drop the edges.
  const trimmed = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!trimmed) return '(the check printed nothing)';
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trimEnd()}\n… (truncated: the full output is in the run log)`;
};

/**
 * The issue body: how this issue works and what to do about it, and no dates.
 *
 * Deliberately date-free and verdict-free. The body is written once and never edited, so anything
 * current in it would be the first failure forever; the facts belong in the comments, which are
 * appended per run. It is also the only part of this that will still be read months later, after a
 * renewal, by someone wondering what the issue was for.
 */
export const issueBody = () => `The daily scheduled check failed: either the domain's registration needs
attention, or the registry answered something this repository does not record.

It reads \`${REGISTRAR_FACTS.host}\` from [RDAP](https://rdap.verisign.com/net/v1/domain/${REGISTRAR_FACTS.host}) —
the registry's own answer, over plain HTTPS, no login, nothing written — and fails when the expiry is
inside ${RENEWAL_WARNING_DAYS} days or has passed, when the registrar's status is no longer the one
\`src/registrar.js\` records, or when the lookup could not be answered at all. The verdict for each run
is in a comment below; every failing run adds one, so this issue is a timeline rather than a single
overwritten snapshot.

**If the date is the problem, work these in order**

- [ ] **Renew** the domain at <https://www.domainregistry.com/login/> —
  ${REGISTRAR_FACTS.registrar}, IANA ID ${REGISTRAR_FACTS.ianaId}. The registrar's confirmation email
  is not proof that the registry changed; the next box is.
- [ ] **Confirm the registry agrees** — \`npm run registrar\` prints the registry's answer beside what
  this repository records. Do this before editing anything: it is the only step that says what the
  new dates are.
- [ ] **Adopt it** — \`npm run registrar:adopt\` prints what moved; \`--apply\` writes the recorded
  facts and the three runbook lines that restate them, adds the answer to \`registrar-history.json\`,
  re-renders \`ACCOUNTS.md\` with \`npm run build\`, and runs the guard suite that proves nothing was
  left saying the old date.
- [ ] **Verify** — \`npm run registrar:check\` exits 0. The next scheduled run then closes this issue
  with the verdict that closed it.

**If the status is the problem** — a hold, a lapsed card, a transfer — renewing is not the answer.
Check the portal for what happened, let \`npm run registrar:adopt -- --apply\` record the new status
once it is understood, and let the next passing run close this issue. A changed *registrar of record*
is refused by that command on purpose: a transfer is not a renewal.

**If the lookup failed** — RDAP did not answer, twice — nothing was judged about the domain. Run
\`npm run registrar\` before concluding anything.

The boxes are for you: nothing in this workflow ticks them, so a closed issue does not mean every
box was ticked. The first passing run closes this issue, with the verdict that closed it, and a later
failure opens it again. GitHub also disables schedules after 60 days without activity on the default
branch, so the job summary is the record of the runs that did not fail — this issue cannot appear for
a workflow that never ran.

${ISSUE_MARKER}`;

const runLine = runUrl => (runUrl ? `\n\nRun: ${runUrl}` : '');

/** One failing run: the date, the verdict verbatim, and the run it came from. */
export const failureComment = ({ verdict = '', today = new Date().toISOString().slice(0, 10), runUrl = null } = {}) => `### ${today} — failed

\`\`\`text
${verdictExcerpt(verdict)}
\`\`\`${runLine(runUrl)}`;

/**
 * The passing run that closes it. It says what it is doing, not that the problem is solved: a
 * passing check means the date is not due, and could equally mean somebody renewed or that the
 * registry changed its answer. The verdict is included so the closing comment carries its evidence.
 */
export const recoveryComment = ({ verdict = '', today = new Date().toISOString().slice(0, 10), runUrl = null } = {}) => `### ${today} — recovered

The scheduled check passed, so the date is not due any more. Closing this; a later failure opens it
again.

\`\`\`text
${verdictExcerpt(verdict)}
\`\`\`${runLine(runUrl)}`;
