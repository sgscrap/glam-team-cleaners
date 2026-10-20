/**
 * The registry's answer, and the claims it is used to check.
 *
 * This module exists because the registrar was the one fact here nobody could re-read: the runbook
 * said `DomainRegistry.com LLC`, on a date, and the only way to ask again was a browser. So the
 * tests are about the two things that make a re-read worth having — that a weird-looking answer is
 * normalized rather than rejected, and that a difference is *reported with both values* instead of
 * quietly passing. A comparison that cannot fail would be the same problem in a new place.
 *
 * No network: the payloads are the shape Verisign's RDAP actually returns, and the request is
 * injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RDAP_BASES,
  REGISTRAR_FACTS,
  REGISTRAR_FIELDS,
  RENEWAL_WARNING_DAYS,
  compareRegistrar,
  daysUntilExpiry,
  describeRegistrarValue,
  fetchRegistrar,
  rdapUrl,
  registrarFacts,
  renewalVerdict,
} from '../src/registrar.js';
import { ACCOUNTS, accountsPage } from '../src/accounts.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runbook = read('DOMAIN.md');
const page = accountsPage({ runbook });

const registered = '2026-09-17T15:24:54Z';
const expires = '2027-09-17T15:24:54Z';

/** Verisign's RDAP for this domain, trimmed to the parts that are read. */
const payload = ({
  registrarName = 'DomainRegistry.com LLC',
  ianaId = '128',
  status = ['active'],
  events = [
    { eventAction: 'registration', eventDate: registered },
    { eventAction: 'expiration', eventDate: expires },
    { eventAction: 'last changed', eventDate: '2026-09-17T15:24:55Z' },
    { eventAction: 'last update of RDAP database', eventDate: '2026-10-18T01:48:26Z' },
  ],
  nameservers = [
    { ldhName: 'NS2.HOSTING.BUSINESSIDENTITY.LLC' },
    { ldhName: 'NS1.HOSTING.BUSINESSIDENTITY.LLC.' },
    { ldhName: 'NS1.HOSTING.BUSINESSIDENTITY.LLC' },
  ],
  signed = false,
} = {}) => ({
  ldhName: 'GLAMCLEANERS.NET',
  status,
  entities: [
    {
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: ianaId }],
      vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', registrarName]]],
    },
    { roles: ['abuse'], vcardArray: ['vcard', [['fn', {}, 'text', 'abuse']]] },
  ],
  events,
  secureDNS: { delegationSigned: signed },
  nameservers,
});

const response = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Server Error',
  json: async () => body,
});

test('the registry answer is reduced to the facts a runbook can hold', () => {
  const facts = registrarFacts('glamcleaners.net', payload());

  assert.equal(facts.registrar, 'DomainRegistry.com LLC', 'the registrar entity, not the abuse contact');
  assert.equal(facts.ianaId, 128);
  assert.deepEqual(facts.statuses, ['active']);
  assert.equal(facts.registered, '2026-09-17', 'a registrar date is a day, not a timestamp');
  assert.equal(facts.expires, '2027-09-17');
  assert.equal(facts.changed, '2026-09-17');
  assert.deepEqual(
    facts.nameservers,
    ['ns1.hosting.businessidentity.llc', 'ns2.hosting.businessidentity.llc'],
    'lowercased, no trailing dot, sorted, and a name answered twice is one name',
  );
  assert.equal(facts.signed, false, 'delegationSigned false is not the same as an absent block — see below');

  const empty = registrarFacts('glamcleaners.net', { ldhName: 'X.NET' });
  assert.equal(empty.registrar, null, 'a payload with no registrar says so rather than inventing one');
  assert.equal(empty.ianaId, null);
  assert.deepEqual(empty.statuses, []);
  assert.deepEqual(empty.nameservers, []);
  assert.equal(empty.signed, false);
});

test('a domain is looked up at its own registry, and an unknown TLD fails loudly', () => {
  assert.equal(rdapUrl('glamcleaners.net'), `${RDAP_BASES.net}glamcleaners.net`);
  assert.equal(rdapUrl('example.com'), `${RDAP_BASES.com}example.com`);
  assert.throws(
    () => rdapUrl('example.org'),
    /No RDAP base for \.org/,
    'asking the wrong registry and reading its silence as an answer is the failure this prevents',
  );
});

test('a request that failed is retried once, and is never read as an answer', async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return response(payload());
  };
  assert.equal((await fetchRegistrar('glamcleaners.net', { request: flaky })).registrar, 'DomainRegistry.com LLC');
  assert.equal(calls, 2, 'one retry, because a lookup that failed is not a domain that changed');

  await assert.rejects(
    fetchRegistrar('glamcleaners.net', { request: async () => response({}, { status: 500 }) }),
    /RDAP could not be read for glamcleaners\.net: .*500/,
  );

  let notFound = 0;
  await assert.rejects(
    fetchRegistrar('glamcleaners.net', {
      request: async () => {
        notFound += 1;
        return response({}, { status: 404 });
      },
    }),
    /the registry does not hold glamcleaners\.net/,
  );
  assert.equal(notFound, 1, 'a 404 is an answer — the domain is not registered — so it is not retried');

  await assert.rejects(
    fetchRegistrar('glamcleaners.net', {
      request: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
    }),
    /answered with something that is not RDAP JSON/,
  );
});

test('every compared field is compared: a renewal, a move, a name, a signature', () => {
  const recorded = REGISTRAR_FACTS;
  const live = registrarFacts('glamcleaners.net', payload());

  const agree = compareRegistrar(recorded, live);
  assert.equal(agree.ok, true);
  assert.deepEqual(agree.checks.map(check => check.name), REGISTRAR_FIELDS);
  assert.match(describeRegistrarValue(agree.checks.find(check => check.name === 'signed').live), /^no$/);

  const eventsOn = ({ registration = registered, expiration = expires } = {}) => [
    { eventAction: 'registration', eventDate: registration },
    { eventAction: 'expiration', eventDate: expiration },
  ];

  const drifted = [
    ['registrar', { registrarName: 'Another Registrar LLC' }],
    ['ianaId', { ianaId: '999' }],
    ['statuses', { status: ['clientHold'] }],
    ['registered', { events: eventsOn({ registration: '2026-09-18T00:00:00Z' }) }],
    ['expires', { events: eventsOn({ expiration: '2028-09-17T00:00:00Z' }) }],
    ['nameservers', { nameservers: [{ ldhName: 'ADA.NS.CLOUDFLARE.COM' }, { ldhName: 'BOB.NS.CLOUDFLARE.COM' }] }],
    ['signed', { signed: true }],
  ];

  for (const [name, override] of drifted) {
    const other = compareRegistrar(recorded, registrarFacts('glamcleaners.net', payload(override)));
    assert.equal(other.ok, false, `${name} drift must fail the comparison`);

    const check = other.checks.find(candidate => candidate.name === name);
    assert.equal(check.ok, false, `${name} must be the check that fails`);
    assert.equal(check.recorded, recorded[name], 'both sides are kept, so the line can print both');
    assert.notDeepEqual(check.live, check.recorded);
    assert.equal(
      other.checks.filter(candidate => !candidate.ok).length,
      1,
      `${name} is the only field that moved, so the report must not blame another one`,
    );
  }

  // A renewal that moves the expiry is the drift most likely to happen and least likely to be
  // noticed, so it gets its own assertion about what the failure says.
  const renewed = compareRegistrar(recorded, registrarFacts('glamcleaners.net', payload({
    events: eventsOn({ expiration: '2028-09-17T15:24:54Z' }),
  })));
  assert.equal(renewed.ok, false);
  assert.equal(renewed.checks.find(check => check.name === 'expires').live, '2028-09-17');
});

test('the runbook, the accounts page and the command state one set of facts', () => {
  assert.match(RUNBOOK_REGISTRAR_ROW(), /DomainRegistry\.com LLC/, 'the runbook names the registrar');
  assert.ok(runbook.includes(REGISTRAR_FACTS.registered), 'and the day it was registered');
  assert.ok(runbook.includes(REGISTRAR_FACTS.expires), 'and the day it expires');

  for (const server of REGISTRAR_FACTS.nameservers) {
    assert.ok(
      runbook.toLowerCase().includes(server),
      `the runbook names every delegated nameserver: ${server} is missing`,
    );
  }

  assert.ok(page.includes(REGISTRAR_FACTS.registrar), 'the accounts page is rendered from the same facts');
  assert.ok(page.includes(REGISTRAR_FACTS.expires), 'including the expiry it warns about');
  assert.ok(page.includes(`\`${REGISTRAR_FACTS.statuses.join(', ')}\``), 'and the registry status');
  assert.match(page, /npm run registrar/, 'and it names the command that re-reads them');

  const script = read('scripts/registrar.js');
  assert.match(script, /REGISTRAR_FACTS/, 'the command compares against the recorded facts, not a copy of them');
  assert.equal(/writeFileSync|mkdirSync|appendFileSync/.test(script), false, 'and it writes nothing');
  assert.equal(/method: 'POST'/.test(script), false, 'nor does it ask the registry for anything but a read');
});

/** The runbook's registrar row, whatever else it grows to say. */
function RUNBOOK_REGISTRAR_ROW() {
  return runbook.split('\n').find(line => line.startsWith('| Registrar |')) ?? '';
}

test('the accounts page lists the command as the one readable account', () => {
  const registryRow = ACCOUNTS.find(account => account.name === 'DomainRegistry.com LLC');
  assert.match(registryRow.needed, /npm run registrar/, 'the row says how to re-read itself');

  assert.equal(
    /no command can reach/.test(page),
    false,
    'that sentence is no longer true now that the registry is readable',
  );
});

/* --- the part that is about time rather than drift ------------------------ */

/**
 * The comparison can say the runbook is right and still be useless: a recorded expiry that matches
 * the registry exactly arrives on the same day. So the horizon is tested on the days around it —
 * the 60th day itself included, because "within 60 days" that excludes day 60 is a window that
 * opens a day late, and an expiry day is not a thing to be a day late about.
 */
test('the expiry is judged against a horizon, not against what is recorded', () => {
  const live = registrarFacts('glamcleaners.net', payload());

  assert.equal(daysUntilExpiry('2027-09-17', '2027-07-19'), RENEWAL_WARNING_DAYS, 'counted in whole UTC days');
  assert.equal(daysUntilExpiry('2027-09-17', '2027-07-18'), 61);
  assert.equal(daysUntilExpiry('2027-09-17', '2027-09-17'), 0);
  assert.equal(daysUntilExpiry('2027-09-17', '2027-09-18'), -1, 'the day after is a negative, not a wrap');
  assert.equal(daysUntilExpiry('2027-09-17T15:24:54Z', '2027-07-19'), 60, 'a timestamp is still a day');
  assert.equal(daysUntilExpiry(null, '2027-09-17'), null, 'a missing date is not a number to guess at');

  const at = today => renewalVerdict(REGISTRAR_FACTS, live, { today });

  const far = at('2027-07-18');
  assert.equal(far.ok, true);
  assert.equal(far.expiry.state, 'fine');
  assert.equal(far.expiry.warnFrom, '2027-07-19', 'the day the window opens, printed so nobody has to work it out');

  const edge = at('2027-07-19');
  assert.equal(edge.ok, false, 'the 60th day is inside the window, not outside it');
  assert.equal(edge.expiry.state, 'near');
  assert.equal(edge.expiry.days, RENEWAL_WARNING_DAYS);
  assert.equal(edge.statuses.ok, true, 'and the failure is about the expiry, not the status');

  const past = at('2027-09-18');
  assert.equal(past.ok, false);
  assert.equal(past.expiry.state, 'expired');
  assert.equal(past.expiry.days, -1, 'how long ago, so the run says something actionable');

  const undated = renewalVerdict(REGISTRAR_FACTS, { ...live, expires: null }, { today: '2027-07-18' });
  assert.equal(undated.ok, false, 'an answer with no date cannot be read as time remaining');
  assert.equal(undated.expiry.state, 'unknown');
  assert.equal(undated.expiry.warnFrom, null);

  // The window is a constant, not a number in three places: shortening it to a week must move the
  // boundary rather than leave a script saying 60 while the module judges 7.
  const week = renewalVerdict(REGISTRAR_FACTS, live, { today: '2027-09-01', warnDays: 7 });
  assert.equal(week.expiry.state, 'fine', 'a week-long horizon does not flag 16 days out');
  assert.equal(week.expiry.warnFrom, '2027-09-10');
});

test('a status change fails the same check, and is never reported as an expiry', () => {
  const held = registrarFacts('glamcleaners.net', payload({ status: ['clientHold'] }));
  const verdict = renewalVerdict(REGISTRAR_FACTS, held, { today: '2027-01-01' });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.statuses.ok, false);
  assert.deepEqual(verdict.statuses.recorded, ['active']);
  assert.deepEqual(verdict.statuses.live, ['clientHold'], 'both sides are kept, so the line can print both');
  assert.equal(verdict.expiry.ok, true, 'the expiry is untouched, so renewing is not what this asks for');

  const reordered = renewalVerdict(
    { ...REGISTRAR_FACTS, statuses: ['serverTransferProhibited', 'active'] },
    registrarFacts('glamcleaners.net', payload({ status: ['active', 'serverTransferProhibited', 'active'] })),
    { today: '2027-01-01' },
  );
  assert.equal(reordered.statuses.ok, true, 'the same set of statuses in a different order is not a change');

  const silent = renewalVerdict(
    REGISTRAR_FACTS,
    registrarFacts('glamcleaners.net', payload({ status: [] })),
    { today: '2027-01-01' },
  );
  assert.equal(silent.statuses.ok, false, 'a registry that stops reporting a status is a change too');
});

/**
 * A check nothing runs is a check that does not exist, and this one has to run without a push —
 * that is the entire reason it is separate. So the wiring is asserted: the schedule, the command it
 * calls, and that reading the registry needs no credential of its own. The workflow does now carry
 * one secret, the token `gh` needs to file the issue a failure opens; that is someone else's
 * business, and the check step must not depend on it.
 */
test('the scheduled run is wired to the check, and the check only reads', () => {
  const workflow = read('.github/workflows/registrar.yml');
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts['registrar:check'], 'node scripts/registrar-check.js', 'the workflow calls a script that exists');
  assert.match(workflow, /^\s*schedule:/m, 'it runs on a clock rather than on a push');
  assert.match(workflow, /cron: '[0-9 ]+ \* \* \*'/, 'daily, so the window is the window it says');
  assert.match(workflow, /workflow_dispatch:/, 'and can be run by hand when the schedule is suspect');
  assert.match(workflow, /npm run registrar:check/, 'and what it runs is the check');

  const checkStep = workflow.slice(
    workflow.indexOf('name: Read the registrar from RDAP'),
    workflow.indexOf('name: File or update the issue'),
  );
  assert.ok(checkStep.includes('npm run registrar:check'), 'the step was found by its name');
  assert.equal(/\$\{\{\s*secrets\./.test(checkStep), false, 'RDAP answers anyone, so the check step reads no secret');

  const secrets = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map(match => match[1]);
  assert.deepEqual(
    [...new Set(secrets)],
    ['GITHUB_TOKEN'],
    'the only credential in the workflow is the one gh needs to file the issue',
  );

  const script = read('scripts/registrar-check.js');
  assert.match(script, /renewalVerdict/, "the verdict is the module's, not a second opinion");
  assert.match(script, /fetchRegistrar/, 'and it reads the registry the way the other command does');
  const record = script.indexOf('if (RECORD)');
  assert.notEqual(record, -1, 'keeping the answer is a flag, not the default');
  assert.equal(/writeFileSync\(/.test(script.slice(0, record)), false, 'a plain run of the check writes nothing');
  assert.equal(/appendFileSync|mkdirSync|rmSync/.test(script), false, 'and it creates and removes nothing at all');
  assert.match(script, /process\.exit\(1\)/, 'a failure is an exit status, which is what a scheduled run can report');

  assert.match(runbook, /npm run registrar:check/, 'the runbook names the scheduled check');
  assert.match(page, /npm run registrar:check/, 'and so does the accounts page, rendered from the same facts');
});
