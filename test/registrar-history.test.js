/**
 * The timeline, and the rules that keep it readable.
 *
 * `REGISTRAR_FACTS` answers "what does the registry say now". That question has a short memory: a
 * renewal replaces the expiry, a hold replaces the status, and the sequence — which is the part a
 * person actually needs after the fact — exists only in commit diffs. `registrar-history.json` is
 * that sequence, dated.
 *
 * Three properties are worth holding, because each fails quietly:
 *
 * - the committed file is exactly what the renderer emits, so recording does not reformat it;
 * - dates strictly increase, so "the timeline" is never a file that has to be sorted to be read;
 * - the head is the facts the runbook states, so the timeline cannot end somewhere the documents
 *   do not — that is the check that makes it trustworthy rather than merely present.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRAR_FACTS } from '../src/registrar.js';
import {
  HISTORY_FILE,
  historyDrift,
  historyEntry,
  parseHistory,
  recordObservation,
  renderHistory,
} from '../src/registrar-history.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const committed = read(HISTORY_FILE);
const entries = parseHistory(committed);

const entryFrom = (facts, observed) => historyEntry(facts, observed);

test('the committed timeline is canonical, ordered and ends at the recorded facts', () => {
  assert.equal(renderHistory(entries), committed, 'the file is exactly what the renderer emits');

  const dates = entries.map(entry => entry.observed);
  assert.deepEqual(dates, [...dates].sort(), 'oldest first');
  assert.equal(new Set(dates).size, dates.length, 'one entry per day');

  const drift = historyDrift(entries, REGISTRAR_FACTS);
  assert.ok(drift, 'the file has a head to compare');
  assert.deepEqual(
    drift.map(check => check.name),
    [],
    `the timeline must end where REGISTRAR_FACTS does — it ends at ${entries.at(-1).observed}`,
  );
  // The dates are deliberately not compared: `observed` on an entry is when that answer was first
  // recorded, and `REGISTRAR_FACTS.observed` is when the runbook's copy was last re-read. A recorded
  // answer adopted later is the same answer, and neither date is wrong for being earlier.
});

test('a repeated reading is not a new entry', () => {
  const again = recordObservation(entries, REGISTRAR_FACTS, { today: '2026-12-01' });

  assert.equal(again.added, null, 'eighty identical nights are not a history');
  assert.equal(again.entries, entries, 'and nothing is rewritten');
});

test('a renewal and a status change each become a dated line', () => {
  const renewed = recordObservation(entries, { ...REGISTRAR_FACTS, expires: '2028-09-17' }, { today: '2027-08-02' });

  assert.equal(renewed.entries.length, entries.length + 1);
  assert.equal(renewed.added.observed, '2027-08-02', 'dated to the day it was read');
  assert.equal(renewed.added.expires, '2028-09-17');
  assert.equal(renewed.entries.at(-2).expires, entries.at(-1).expires, 'the old answer is kept, not overwritten');

  const held = recordObservation(
    renewed.entries,
    { ...REGISTRAR_FACTS, expires: '2028-09-17', statuses: ['clientHold'] },
    { today: '2027-09-01' },
  );
  assert.deepEqual(held.added.statuses, ['clientHold'], 'the sequence is the point: active, then held');
  assert.deepEqual(held.entries.at(-2).statuses, ['active'], 'and what it was before survives');
});

test('a second change on one day replaces that day, because a timeline is dated to the day', () => {
  const sameDay = recordObservation(entries, { ...REGISTRAR_FACTS, statuses: ['clientHold'] }, { today: entries.at(-1).observed });

  assert.equal(sameDay.replaced, true);
  assert.equal(sameDay.entries.length, entries.length, 'two entries dated the same day would make the order a guess');
  assert.equal(sameDay.entries.at(-1).statuses[0], 'clientHold');
});

test('a hand edit that breaks the timeline is named, not sorted away', () => {
  const entry = entryFrom(REGISTRAR_FACTS, '2026-10-17');
  const cases = [
    ['not an array', '{}', /must be a JSON array/],
    ['empty', '[]', /holds no answers/],
    ['invalid JSON', '[', /not valid JSON/],
    ['out of order', JSON.stringify([entryFrom(REGISTRAR_FACTS, '2026-11-01'), entry]), /does not follow/],
    ['two for one day', JSON.stringify([entry, entry]), /does not follow/],
    ['missing a field', JSON.stringify([{ ...entry, expires: undefined }]), /missing expires/],
    ['an unread field', JSON.stringify([{ ...entry, host: 'glamcleaners.net' }]), /fields nothing reads: host/],
    ['a date that is not a date', JSON.stringify([{ ...entry, observed: '17-10-2026' }]), /no YYYY-MM-DD observed date/],
    ['a malformed delegation', JSON.stringify([{ ...entry, nameservers: 'ns1.example.com' }]), /malformed nameservers/],
  ];

  for (const [label, text, expected] of cases) {
    assert.throws(() => parseHistory(text), expected, label);
  }
});

test('the two commands that own the file are the only writers, and the check is opt-in', () => {
  const check = read('scripts/registrar-check.js');
  const adopt = read('scripts/registrar-adopt.js');

  assert.match(check, /--record/, 'the check can record, when asked');
  assert.match(check, /recordObservation/, 'through the same rule as adoption');
  assert.equal(
    /writeFileSync\(path, renderHistory/.test(check.slice(check.indexOf('if (RECORD)'))),
    true,
    'the write lives inside the flag',
  );
  assert.equal(
    /writeFileSync\(/.test(check.slice(0, check.indexOf('if (RECORD)'))),
    false,
    'and a plain check still writes nothing',
  );

  assert.match(adopt, /recordObservation/, 'adoption records what it adopts');
  assert.match(adopt, new RegExp(`writeFileSync\\(HISTORY`), 'and writes the timeline with the facts');

  assert.match(read('DOMAIN.md'), new RegExp(HISTORY_FILE.replace('.', '\\.')), 'the runbook names the file');
});
