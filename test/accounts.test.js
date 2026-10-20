/**
 * The page that says who to log into, and the thing that keeps it true.
 *
 * An accounts page ages badly in a specific way: the URLs stay plausible, the step numbers stay
 * plausible, and nothing about opening the file reveals that the runbook renumbered its steps or
 * that the registrar's portal moved. So the parts that can be held to code are held to it here — the
 * "needed by" column is resolved against `DOMAIN.md`'s own headings, a referenced step that no
 * longer exists is an error rather than a missing link, and the one URL an operator types at the
 * cutover has to be spelled the same in the page, in the runbook, and in what the apply run prints.
 *
 * No network: these are the shapes and the spellings, and the check that the committed page matches
 * the generator's output belongs to `npm run check`, which compares it byte for byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ACCOUNTS, ACCOUNTS_FILE, ACCOUNTS_OBSERVED_ON, REGISTRAR_LOGIN, accountsPage, runbookHeadings } from '../src/accounts.js';
import { REQUIRED_PERMISSIONS } from '../src/cloudflare.js';
import { HOST } from '../src/dns.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runbook = read('DOMAIN.md');
const page = accountsPage({ runbook });

test('every account says what it is for, where to sign in, and what is needed from it', () => {
  assert.ok(ACCOUNTS.length >= 4, 'the registrar, the DNS host, the mail host and GitHub at least');

  for (const account of ACCOUNTS) {
    for (const field of ['name', 'role', 'signInNote', 'purpose', 'needed']) {
      assert.ok(account[field], `${account.name} must say its ${field}`);
    }
    assert.equal(
      account.signIn === null || account.signIn.startsWith('https://'),
      true,
      `${account.name} signs in over https, or has no address at all — never http`,
    );
    assert.ok(Array.isArray(account.steps), `${account.name} must name the steps that need it`);
    assert.ok(page.includes(`## ${account.name}`), `and it must have a section on the page`);
    assert.ok(page.includes(account.purpose), 'with a purpose that is the one written in the data');
  }

  const dead = ACCOUNTS.find(account => account.signIn === null);
  assert.ok(dead, 'the old mail and DNS panel has no working address, and the page must say so');
  assert.match(page, /_no address answers_/, 'rather than leaving a blank where a login would go');
});

test('the accounts the runbook depends on are all here, GitHub and Cloudflare included', () => {
  const named = ACCOUNTS.map(account => account.name).join(' ');
  for (const [what, pattern] of [
    ['the registrar', /DomainRegistry/],
    ['the old host, panel and all', /Business Identity/],
    ['the LLC account the domain came through', /Northwest Registered Agent/],
    ['the DNS host after the move', /Cloudflare/],
    ['the repository and Pages', /GitHub/],
  ]) {
    assert.match(named, pattern, `${what} must be on the page`);
  }

  assert.ok(page.includes(REQUIRED_PERMISSIONS[0].name), 'the token it needs is named by its permissions');
  assert.equal(
    REQUIRED_PERMISSIONS.every(({ name }) => page.includes(name)),
    true,
    'all three, because a token missing one fails halfway through the move',
  );
});

test('"needed by" is resolved against the runbook, not typed beside it', () => {
  const headings = runbookHeadings(runbook);
  assert.ok(Object.keys(headings.steps).length >= 5, 'the runbook has numbered steps');
  assert.ok(headings.sections.rollback && headings.sections.publishing, 'and the unnumbered sections accounts refer to');

  for (const account of ACCOUNTS) {
    for (const step of account.steps) {
      const title = typeof step === 'number' ? headings.steps[String(step)] : headings.sections[step];
      assert.ok(title, `${account.name} refers to ${step}, which the runbook must still have`);
      assert.ok(
        page.includes(`](DOMAIN.md#${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')})`),
        `the page links to ${title}`,
      );
    }
  }

  assert.equal(
    page.includes('Needed by:** step 1'),
    false,
    'step 1 is credentials, and no account here is what step 1 is about',
  );
});

test('a renamed step is followed, and a deleted one stops the build', () => {
  const renamed = runbook.replace('### 3. Point the registrar at Cloudflare', '### 3. Move the nameservers');
  assert.match(
    accountsPage({ runbook: renamed }),
    /step 3 — \[Move the nameservers\]\(DOMAIN\.md#move-the-nameservers\)/,
    'the page follows the runbook rather than repeating a title it remembers',
  );

  const deleted = runbook.replace(/^### 3\. .+$/m, '');
  assert.throws(
    () => accountsPage({ runbook: deleted }),
    /refers to step 3, which DOMAIN\.md no longer has/,
    'a step that is gone is a build failure, not a dead link',
  );
});

test('the registrar login is one spelling, in the three places someone is sent to it', () => {
  assert.match(REGISTRAR_LOGIN, /^https:\/\/www\.domainregistry\.com\/login\/$/);
  assert.ok(page.includes(REGISTRAR_LOGIN), 'the accounts page');
  assert.ok(runbook.includes(REGISTRAR_LOGIN), 'the runbook');
  assert.ok(read('scripts/dns-cloudflare.js').includes('REGISTRAR_LOGIN'), 'and the apply run, from the same constant');

  assert.ok(page.includes(HOST), 'the page names the domain it is about — the RDAP link is built from it');
});

test('the page is a generated artifact, not a document that drifts on its own', () => {
  assert.equal(ACCOUNTS_FILE, 'ACCOUNTS.md');
  assert.ok(read('src/build.js').includes('ACCOUNTS_FILE'), 'the build writes it, so npm run check compares it');
  assert.match(runbook, /\[ACCOUNTS\.md\]\(ACCOUNTS\.md\)/, 'and the runbook sends the operator to it');
  assert.equal(existsSync(new URL('../ACCOUNTS.md', import.meta.url)), true, 'it is committed');

  const committed = read(ACCOUNTS_FILE);
  assert.equal(committed, page, 'and the committed page is exactly what the generator emits — run npm run build');
  assert.match(committed, new RegExp(ACCOUNTS_OBSERVED_ON), 'the dated facts carry the date they were read');
});
