/**
 * The baseline, and the comparison that is only worth anything if it can fail.
 *
 * A mail snapshot that reports "unchanged" for two empty zones would pass a migration that dropped
 * everything, so the tests here are mostly about the negative: a missing MX, a reordered SPF, a
 * DMARC string that lost a tag, a DKIM key that disappeared. They also pin the one deliberate
 * leniency — a new selector after the baseline is a rotation and must not fail the check, because
 * a guard that cries wolf on normal provider behaviour stops being run.
 *
 * No network: every resolver is injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureMailBaseline,
  collectMail,
  compareMail,
  zoneSnapshot,
} from '../src/mail-records.js';
import { HOST } from '../src/dns.js';

/** A temporary directory per test; the baseline is a file, so these tests write one. */
const scratch = () => mkdtempSync(join(tmpdir(), 'mail-records-'));

const ENODATA = Object.assign(new Error('no such record'), { code: 'ENODATA' });

const resolvers = ({ mx = [], txt = {}, dkim = [], mxError = null } = {}) => ({
  mx: async () => {
    if (mxError) throw mxError;
    return mx;
  },
  txt: async name => {
    if (!(name in txt)) throw ENODATA;
    return txt[name];
  },
  discover: async () => ({ found: dkim, tried: [], delegated: [], misplaced: [] }),
});

const snapshot = (overrides = {}) => ({
  host: HOST,
  captured: '2026-10-17T00:00:00.000Z',
  mx: [{ priority: 10, exchange: 'mailserver.businessidentity.llc' }],
  spf: 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all',
  dmarc: 'v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; fo=1',
  dkim: [],
  ...overrides,
});

test('a snapshot holds MX, the SPF and DMARC strings, and each DKIM key', async () => {
  const taken = await collectMail(HOST, {
    ...resolvers({
      mx: [
        { priority: 20, exchange: 'backup.example.' },
        { priority: 10, exchange: 'MAILSERVER.BUSINESSIDENTITY.LLC' },
      ],
      txt: {
        [HOST]: [['google-site-verification=abc'], ['v=spf1 a mx include:spf.postal.businessidentity.llc ~all']],
        [`_dmarc.${HOST}`]: [['v=DMARC1; p=quarantine; fo=1']],
      },
      dkim: [{ selector: 'default', name: `default._domainkey.${HOST}`, key: 'v=DKIM1; k=rsa; p=AAAA', bits: 2048 }],
    }),
    now: () => '2026-10-17T12:00:00.000Z',
  });

  assert.deepEqual(taken.mx, [
    { priority: 10, exchange: 'mailserver.businessidentity.llc' },
    { priority: 20, exchange: 'backup.example' },
  ], 'MX is a sorted set, lowercased, without the trailing dot');
  assert.equal(taken.spf, 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all', 'SPF is picked out of the apex TXT set');
  assert.equal(taken.dmarc, 'v=DMARC1; p=quarantine; fo=1');
  assert.deepEqual(taken.dkim.map(key => key.selector), ['default']);
  assert.equal(taken.captured, '2026-10-17T12:00:00.000Z');
});

test('an absent record is null; a failed lookup is an error', async () => {
  const empty = await collectMail(HOST, resolvers());
  assert.deepEqual(empty.mx, []);
  assert.equal(empty.spf, null, 'no SPF is recorded as null so a later one shows as a change');
  assert.equal(empty.dmarc, null);
  assert.deepEqual(empty.dkim, []);

  await assert.rejects(
    collectMail(HOST, resolvers({ mxError: Object.assign(new Error('temporary failure'), { code: 'SERVFAIL' }) })),
    /MX for .* could not be read: SERVFAIL/,
  );
});

test('an unchanged mailbox passes', () => {
  const result = compareMail(snapshot(), snapshot());
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map(check => check.name), ['MX', 'SPF', 'DMARC']);
  assert.deepEqual(result.notes, []);
});

test('a lost or reordered MX fails, with both sides shown', () => {
  const result = compareMail(snapshot(), snapshot({ mx: [] }));
  assert.equal(result.ok, false);
  const mx = result.checks.find(check => check.name === 'MX');
  assert.equal(mx.ok, false);
  assert.match(mx.before, /mailserver\.businessidentity\.llc/);
  assert.equal(mx.after, 'none');

  const two = snapshot({ mx: [
    { priority: 10, exchange: 'a.example' },
    { priority: 20, exchange: 'b.example' },
  ] });
  const swapped = snapshot({ mx: [
    { priority: 20, exchange: 'b.example' },
    { priority: 10, exchange: 'a.example' },
  ] });
  assert.equal(compareMail(two, swapped).ok, true, 'the set is what matters, not the order the resolver returned');
});

test('SPF and DMARC are compared as exact strings', () => {
  const spfChanged = compareMail(snapshot(), snapshot({ spf: 'v=spf1 include:spf.postal.businessidentity.llc ~all' }));
  assert.equal(spfChanged.ok, false);
  assert.equal(spfChanged.checks.find(check => check.name === 'SPF').ok, false);

  const dmarcLost = compareMail(snapshot(), snapshot({ dmarc: 'v=DMARC1; p=quarantine; fo=1' }));
  assert.equal(dmarcLost.ok, false);
  assert.equal(dmarcLost.checks.find(check => check.name === 'DMARC').after, 'v=DMARC1; p=quarantine; fo=1');

  const dmarcGone = compareMail(snapshot(), snapshot({ dmarc: null }));
  assert.equal(dmarcGone.ok, false);
});

test('a DKIM key that vanished or changed fails; a new selector only notes', () => {
  const key = selector => ({ selector, name: `${selector}._domainkey.${HOST}`, key: `v=DKIM1; k=rsa; p=${selector}`, bits: 2048 });
  const before = snapshot({ dkim: [key('default'), key('mail')] });

  assert.equal(compareMail(before, snapshot({ dkim: [key('default'), key('mail')] })).ok, true);

  const missing = compareMail(before, snapshot({ dkim: [key('default')] }));
  assert.equal(missing.ok, false);
  const missingCheck = missing.checks.find(check => check.name === 'DKIM mail');
  assert.equal(missingCheck.ok, false);
  assert.equal(missingCheck.after, null);
  assert.match(missingCheck.why, /no key answers/);

  const rotated = compareMail(before, snapshot({ dkim: [key('default'), { ...key('mail'), key: 'v=DKIM1; k=rsa; p=OTHER' }] }));
  assert.equal(rotated.ok, false);
  assert.match(rotated.checks.find(check => check.name === 'DKIM mail').why, /changed/);

  const added = compareMail(before, snapshot({ dkim: [key('default'), key('mail'), key('new')] }));
  assert.equal(added.ok, true, 'a rotation is not a loss');
  assert.match(added.notes[0], /new/);
});

test('a snapshot for another domain cannot pass by accident', () => {
  const other = snapshot({ host: 'example.com' });
  const result = compareMail(other, snapshot());
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].name, 'host');
});

/** What the Cloudflare API returns for a zone that copied the mailbox faithfully. */
const zoneRecords = ({ dkim = [], mx = [{ priority: 10, content: 'mailserver.businessidentity.llc' }] } = {}) => [
  ...mx.map(({ priority, content }) => ({ type: 'MX', name: HOST, content, priority })),
  { type: 'TXT', name: HOST, content: 'google-site-verification=abc' },
  { type: 'TXT', name: HOST, content: 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all' },
  {
    type: 'TXT',
    name: `_dmarc.${HOST}`,
    content: 'v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; fo=1',
  },
  ...dkim.map(({ selector, key }) => ({ type: 'TXT', name: `${selector}._domainkey.${HOST}`, content: key })),
];

// Long enough for `dkimKey` to accept it as a key: a bare `p=AAAA` is not one.
const DKIM_KEY = `v=DKIM1; k=rsa; p=${'A'.repeat(64)}`;

test('the records the API reports read like the live zone', () => {
  const zone = zoneSnapshot(HOST, zoneRecords({
    dkim: [{ selector: 'default', key: DKIM_KEY }],
  }), { now: () => '2026-10-17T00:00:00.000Z' });

  assert.equal(zone.host, HOST);
  assert.deepEqual(zone.mx, [{ priority: 10, exchange: 'mailserver.businessidentity.llc' }]);
  assert.equal(zone.spf, 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all');
  assert.equal(zone.dmarc, 'v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; fo=1');
  assert.deepEqual(zone.dkim.map(key => key.selector), ['default']);
  assert.equal(zone.dkim[0].name, `default._domainkey.${HOST}`, 'the selector is in the name the record is published at');

  assert.equal(
    compareMail(snapshot(), zone).ok,
    true,
    'a faithful copy must pass — otherwise the check would fail every move and be ignored',
  );
});

test('a name with another case or a trailing dot is the same record', () => {
  const upper = zoneRecords().map(record => ({ ...record, name: `${record.name.toUpperCase()}.` }));
  const zone = zoneSnapshot(HOST, upper);
  assert.equal(zone.spf, 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all');
  assert.equal(zone.dmarc, 'v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; fo=1');
  assert.deepEqual(zone.mx, [{ priority: 10, exchange: 'mailserver.businessidentity.llc' }]);
});

test('a zone that dropped a mail record fails the comparison', () => {
  const key = { selector: 'default', name: `default._domainkey.${HOST}`, key: DKIM_KEY, bits: 2048 };
  const before = snapshot({ dkim: [key] });

  const missingKey = compareMail(before, zoneSnapshot(HOST, zoneRecords()));
  assert.equal(missingKey.ok, false, 'a key that did not come across is exactly the silent failure this guards');
  assert.match(missingKey.checks.find(check => check.name === 'DKIM default').why, /no key answers/);

  const noMx = compareMail(snapshot(), zoneSnapshot(HOST, zoneRecords({ mx: [] })));
  assert.equal(noMx.ok, false);
  assert.equal(noMx.checks.find(check => check.name === 'MX').after, 'none');

  const reworded = compareMail(
    snapshot(),
    zoneSnapshot(HOST, zoneRecords().map(record => (
      record.content.startsWith('v=DMARC1') ? { ...record, content: 'v=DMARC1; p=none' } : record
    ))),
  );
  assert.equal(reworded.ok, false, 'a DMARC policy slackened in transit is a change, not a copy');
});

test('the apply run captures the baseline once, and never refreshes it', async () => {
  const path = join(scratch(), 'mail-baseline.json');
  let collected = 0;
  const collect = async () => {
    collected += 1;
    return snapshot({ captured: `reading-${collected}` });
  };

  const first = await captureMailBaseline(path, { collect });
  assert.equal(first.wrote, true);
  assert.equal(first.snapshot.captured, 'reading-1');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).host, HOST, 'the file is a snapshot the later --compare can read');

  const second = await captureMailBaseline(path, {
    collect: async () => {
      throw new Error('a baseline must not be re-taken');
    },
  });
  assert.equal(second.wrote, false);
  assert.equal(second.snapshot.captured, 'reading-1', 'an existing baseline is used as it is');
  assert.equal(collected, 1);
});

test('a baseline that cannot be trusted stops the run and is left in place', async () => {
  const dir = scratch();
  const path = join(dir, 'baseline.json');
  const collect = async () => snapshot();

  writeFileSync(path, 'not json');
  await assert.rejects(captureMailBaseline(path, { collect }), /not readable JSON/);
  assert.equal(readFileSync(path, 'utf8'), 'not json', 'a file the run refused is not overwritten');

  writeFileSync(path, JSON.stringify({ host: HOST }));
  await assert.rejects(captureMailBaseline(path, { collect }), /not a mail snapshot/);

  writeFileSync(path, `${JSON.stringify(snapshot({ host: 'example.com' }))}\n`);
  await assert.rejects(
    captureMailBaseline(path, { collect }),
    /baseline for example\.com/,
    'another domain is a different migration, not a baseline to compare against',
  );
});
