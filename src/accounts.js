/**
 * Every account this domain depends on, as one page.
 *
 * The runbook is written for the person doing the move, and it assumes they already know who holds
 * the domain, where the zone is edited, and which login GitHub wants. Nobody does: those are five
 * different companies, one of them has no working address at all any more, and the one that *looks*
 * like the answer (the LLC lookup page the domain came through) is not where anything is changed.
 *
 * So the accounts are data, rendered here into `ACCOUNTS.md` — and the "needed by" column is
 * resolved against the runbook's own step headings at build time, which is what keeps the page from
 * sending someone to step 3 for a change that step 5 needs. A step that no longer exists is a build
 * failure rather than a stale sentence.
 *
 * The registrar's login is exported because two places send someone to it: this page, and the
 * instruction the apply run prints at the moment the nameservers have to move. `test/runbook.test.js`
 * and `test/accounts.test.js` hold the three spellings of it together.
 */
import { HOST } from './dns.js';
import { REQUIRED_PERMISSIONS } from './cloudflare.js';
import { REGISTRAR_FACTS, RENEWAL_WARNING_DAYS } from './registrar.js';

export const ACCOUNTS_FILE = 'ACCOUNTS.md';

/** The registrar's client portal. The domain is in the account Northwest set up with the LLC. */
export const REGISTRAR_LOGIN = 'https://www.domainregistry.com/login/';

/** The date the facts below were read. Not a guess: RDAP, DNS, the GitHub API and two public pages. */
export const ACCOUNTS_OBSERVED_ON = '2026-10-17';

/**
 * One entry per company the migration needs something from.
 *
 * `steps` holds the numbers of the runbook's steps that send someone here, or the word `rollback`
 * for the undo note. `needed` is what has to be true of the account before that step can be done —
 * a token with the right permissions, admin on the repository, or nothing at all.
 */
export const ACCOUNTS = [
  {
    name: 'DomainRegistry.com LLC',
    role: 'Registrar of record (IANA ID 128)',
    signIn: REGISTRAR_LOGIN,
    signInNote: 'the client portal — the domain is in the account Northwest Registered Agent set up with the LLC',
    purpose: `Holds the domain's nameservers, which makes step 3 the one form in this migration that is`
      + ' not a script: replace the two Business Identity nameservers with Cloudflare\'s pair and the'
      + ' zone changes hands.',
    needed: 'No token and no key — the login is the whole requirement. The registry says status '
      + `\`${REGISTRAR_FACTS.statuses.join(', ')}\`, DNSSEC ${REGISTRAR_FACTS.signed ? 'signed' : 'not signed'},`
      + ` registered ${REGISTRAR_FACTS.registered}, expiring ${REGISTRAR_FACTS.expires}: \`npm run registrar\``
      + ' reads all of that back from the registry and fails when it has moved on from what this page'
      + ' records. The expiry is not only compared but watched: `npm run registrar:check` runs daily in'
      + ` CI and fails ${RENEWAL_WARNING_DAYS} days before it, opening an issue on this repository — so`
      + ' the login is needed long before the date is, not on it. When it is renewed,'
      + ' `npm run registrar:adopt -- --apply` records the registry\'s answer into those same facts.',
    steps: [3, 'rollback'],
  },
  {
    name: 'Northwest Registered Agent',
    role: 'Where the LLC was formed, and where the domain came with it',
    signIn: 'https://www.northwestregisteredagent.com/',
    signInNote: 'the account the LLC lives in',
    purpose: 'The domain arrived through this account: it is the "free matching domain" on their'
      + ' [LLC lookup](https://www.northwestregisteredagent.com/llc-lookup) offer, which is why the'
      + ' registrar of record is DomainRegistry.com LLC rather than Northwest.',
    needed: 'Nothing this migration needs. It is listed because it is the account someone will look in'
      + ' first — the LLC lookup page is where the domain started, not where its nameservers are changed,'
      + ' and Northwest\'s own login is not the registrar\'s portal.',
    steps: [],
  },
  {
    name: 'Cloudflare',
    role: 'The DNS host, once the zone has moved',
    signIn: 'https://dash.cloudflare.com/',
    signInNote: 'the zone, its records and the redirect rule',
    purpose: 'Owns the zone after step 2: the site and mail records, the 301 rule that turns'
      + ' `links.` into one address for the link page, and the proxy state that lets that rule see'
      + ' traffic at all.',
    needed: 'An API token, not a password: `CF_API_TOKEN` and `CF_ACCOUNT_ID`, kept outside the'
      + ` repository in \`~/.cloudflare-zone.env\`. The token must carry, and only need: ${
        REQUIRED_PERMISSIONS.map(({ name, why }) => `${name} (${why})`).join(', ')}.`,
    steps: [2],
  },
  {
    name: 'Business Identity',
    role: 'The zone that answers today, and the mailbox behind it',
    signIn: null,
    signInNote: 'no address answers: `businessidentity.llc`, `hosting.businessidentity.llc` and every'
      + ' `*` name under them resolve to nothing',
    purpose: 'The old DNS host and the mail platform in one: `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC`'
      + ' answer for the zone, and `MX 10 mailserver.businessidentity.llc` is where the mailbox is.',
    needed: 'Nothing can be fetched from it, which is why the mail records were read out of DNS rather'
      + ' than from a panel: the MX, SPF and DMARC steps 2 and 3 carry, and the baseline the apply run'
      + ' takes while this zone is still authoritative. A DKIM key would have to come from here too —'
      + ' none is published, so there is nothing to lose, and nothing that can verify a signature under'
      + ' this domain.',
    steps: [2, 3],
  },
  {
    name: 'GitHub — sgscrap',
    role: 'The repository, the publish workflow, and Pages',
    signIn: 'https://github.com/sgscrap',
    signInNote: 'admin on `sgscrap/glam-team-cleaners`',
    purpose: 'Actions builds and publishes the site; Pages serves it, and once the custom domain is'
      + ' attached it is also where the certificate is issued and HTTPS is enforced.',
    needed: 'Repository admin and nothing else: attaching the domain is one API call'
      + ' (`gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=...`) and the setting after it'
      + ' is a checkbox in Settings → Pages. No repository secret is involved — the deploy authenticates'
      + ' with OIDC (`id-token: write`) and publishes with the `pages` permission, so there is nothing'
      + ' here to rotate.',
    steps: [4, 5, 'publishing'],
  },
];

/**
 * The runbook's headings, read from the runbook itself.
 *
 * Read rather than repeated: a step renamed in `DOMAIN.md` must not leave this page pointing at an
 * old title, and a step deleted must fail the build rather than be quietly referred to by a number.
 * Numbered steps are referred to by number, the unnumbered sections by a word — `rollback`,
 * `publishing` — because those are the two an account is needed for without being a step.
 */
export const runbookHeadings = runbook => ({
  steps: Object.fromEntries([...runbook.matchAll(/^### (\d+)\. (.+)$/gm)].map(([, number, title]) => [number, title.trim()])),
  sections: Object.fromEntries([...runbook.matchAll(/^## (.+)$/gm)].map(([, title]) => [title.trim().toLowerCase(), title.trim()])),
});

/** GitHub's anchor for a heading, which is what `DOMAIN.md`'s own links use. */
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const stepsPhrase = (steps, headings) => {
  if (!steps.length) return '_nothing in the runbook_ (it is not a place this move touches)';
  return steps.map(step => {
    const title = typeof step === 'number' ? headings.steps[String(step)] : headings.sections[step];
    if (!title) {
      throw new Error(`ACCOUNTS.md refers to ${typeof step === 'number' ? `step ${step}` : `the "${step}" section`}, which DOMAIN.md no longer has`);
    }
    return `${typeof step === 'number' ? `step ${step} — ` : ''}[${title}](DOMAIN.md#${slug(title)})`;
  }).join(', ');
};

/** The page: a table to answer "where do I sign in", then what each account is for. */
export const accountsPage = ({ runbook }) => {
  const headings = runbookHeadings(runbook);

  const table = [
    '| Account | Sign in | Needed by |',
    '| --- | --- | --- |',
    ...ACCOUNTS.map(({ name, signIn, steps }) => `| ${name} | ${signIn ? `<${signIn}>` : '_none — the panel has no address_'} | ${stepsPhrase(steps, headings)} |`),
  ].join('\n');

  const sections = ACCOUNTS.map(({ name, role, signIn, signInNote, purpose, needed, steps }) => [
    `## ${name}`,
    '',
    `**${role}.**`,
    '',
    `- **Sign in:** ${signIn ? `<${signIn}>` : '_no address answers_'} — ${signInNote}`,
    `- **Needed by:** ${stepsPhrase(steps, headings)}`,
    `- **What it is for:** ${purpose}`,
    `- **What is needed from it:** ${needed}`,
  ].join('\n')).join('\n\n');

  return `# Accounts this domain depends on

<!-- generated from src/accounts.js — do not edit; npm run build rewrites this file -->

Several companies stand between this domain and a working site, and the runbook assumes the operator
already knows which login belongs to which step. This is that map: ${ACCOUNTS.length} accounts, what
each one is for, where to sign in, and which step of [DOMAIN.md](DOMAIN.md) needs it.

Facts here were read on ${ACCOUNTS_OBSERVED_ON} — the zone from DNS, the Pages settings from the
GitHub API, and the rest from the two providers' own pages. The registrar's row is the exception: it
comes from [RDAP](https://rdap.verisign.com/net/v1/domain/${HOST}), read on ${REGISTRAR_FACTS.observed},
where \`npm run registrar\` re-reads it and fails when it has changed, and
\`npm run registrar:adopt\` records a renewal into the facts both documents render from.

${table}

Two of these are traps worth reading twice. **${ACCOUNTS[1].name}** is where the domain *started*:
the LLC came first, the domain came with it, and its lookup page is not a place anything about the
domain is changed. **${ACCOUNTS[3].name}** has no working address at all any more, so the mail
records could only be read from DNS — which is exactly why the apply run takes its mail baseline
itself, and compares the zone against it before it prints anything about moving the nameservers.

None of these can be signed into by anything here, but one can be read: the registry answers
without a login, which is what \`npm run registrar\` uses to check the registrar, the status, the
dates and the delegated nameservers against what this page records. Everything else needs the login
above — and the commands that come closest are in
[Reading the current state](DOMAIN.md#reading-the-current-state).

${sections}
`;
};
