/**
 * Recording a renewal without transcribing it.
 *
 * The facts live in two kinds of place: one object in `src/registrar.js`, and prose in `DOMAIN.md`
 * that restates three of them. Adoption is the one command here that writes, so the properties worth
 * holding are the ones a writer can get wrong quietly:
 *
 * - it writes nothing when nothing changed, and nothing at all before `--apply` is passed;
 * - it refuses rather than writing half an answer — an incomplete registry response, a missing
 *   runbook line, or a *different registrar of record*, which is a transfer and not a renewal;
 * - what it writes is what a person would have written, so the first adoption is not a reformatting
 *   of the file it was meant to date-stamp.
 *
 * The renderer is held to the committed source literally: if it emitted a different layout, every
 * renewal would produce a diff nobody asked for, and the file would stop being hand-readable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADOPTED_FIELDS,
  REGISTRAR_FACTS,
  REGISTRAR_FACTS_PATTERN,
  adoptFacts,
  adoptRegistrar,
  adoptRunbook,
  renderRegistrarFacts,
} from '../src/registrar.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/registrar.js');
const runbook = read('DOMAIN.md');
const script = read('scripts/registrar-adopt.js');

test('the renderer writes the block a person wrote, and keeps the domain a reference', () => {
  const rendered = renderRegistrarFacts(REGISTRAR_FACTS);

  assert.ok(source.includes(rendered), 'adopting unchanged facts must not reformat the file');
  assert.match(rendered, /host: HOST,/, 'the domain is defined in src/dns.js, not baked into a string');
  assert.equal(rendered.includes(`'${REGISTRAR_FACTS.host}'`), false, 'so a moved domain is still one edit');

  const long = renderRegistrarFacts({
    ...REGISTRAR_FACTS,
    nameservers: [
      'a-very-long-nameserver-name.nameservers.example.com',
      'another-very-long-name.nameservers.example.com',
    ],
  });
  assert.match(long, /nameservers: \[\n {4}'a-very-long/, 'a list too long for one line is wrapped, not left a paragraph');
});

test('nothing changes when the registry still says what is recorded', () => {
  const plan = adoptRegistrar({ source, runbook }, REGISTRAR_FACTS, REGISTRAR_FACTS);

  assert.deepEqual(plan.changes, { facts: [], runbook: [] });
  assert.equal(plan.source, source, 'the source is returned untouched');
  assert.equal(plan.runbook, runbook, 'and so is the runbook');
});

test('a renewal moves the recorded expiry, the prose date and nothing else', () => {
  const live = { ...REGISTRAR_FACTS, expires: '2028-09-17' };
  const plan = adoptRegistrar({ source, runbook }, REGISTRAR_FACTS, live, { observed: '2028-08-01' });

  assert.deepEqual(plan.changes.facts.map(change => change.field), ['expires', 'observed'], 'one fact, and the date it was read');
  assert.match(plan.source, /expires: '2028-09-17'/);
  assert.match(plan.source, /observed: '2028-08-01'/);
  assert.match(plan.source, /host: HOST/, 'and the domain is still the reference it was');

  assert.ok(plan.runbook.includes('| Registered | 2026-09-17, expires 2028-09-17 (RDAP) |'));
  assert.ok(plan.runbook.includes('when this was read on 2028-08-01'));
  assert.equal(
    plan.runbook.includes('| Registered | 2026-09-17, expires 2027-09-17 (RDAP) |'),
    false,
    'the old expiry is not left anywhere it was stated',
  );
  assert.ok(plan.runbook.includes('That command compares, which is not the same as looking ahead'), 'the prose around it is not rewritten');

  // Adopting the same answer twice is a no-op: the second run must not date-stamp it again.
  const recorded = { ...REGISTRAR_FACTS, expires: '2028-09-17', observed: '2028-08-01' };
  const again = adoptRegistrar({ source: plan.source, runbook: plan.runbook }, recorded, live, { observed: '2028-09-02' });
  assert.deepEqual(again.changes, { facts: [], runbook: [] }, 'nothing left to adopt, so the observation date does not drift');
});

test('a nameserver move and a status change are adopted the same way', () => {
  const moved = { ...REGISTRAR_FACTS, nameservers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] };
  const plan = adoptRegistrar({ source, runbook }, REGISTRAR_FACTS, moved, { observed: '2026-11-01' });

  assert.ok(plan.runbook.includes('| Nameservers | `ADA.NS.CLOUDFLARE.COM`, `BOB.NS.CLOUDFLARE.COM` |'));
  assert.match(plan.source, /nameservers: \['ada\.ns\.cloudflare\.com', 'bob\.ns\.cloudflare\.com'\]/);
  assert.ok(plan.runbook.includes('the nameservers in'), 'the sentence points at the table rather than naming a provider');
  assert.equal(
    /\| Nameservers \|.*BUSINESSIDENTITY/.test(plan.runbook),
    false,
    'and the row no longer names the old provider\'s servers',
  );

  const held = adoptFacts(source, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, statuses: ['clientHold'] }, { observed: '2026-10-20' });
  assert.match(held.source, /statuses: \['clientHold'\]/);
  assert.deepEqual(held.changes.map(change => change.field), ['statuses', 'observed']);
});

test('an answer that cannot be recorded whole is refused, not written', () => {
  assert.throws(
    () => adoptRegistrar({ source, runbook }, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, expires: null }),
    /incomplete — no expires/,
    'an answer with no expiry has no date to write',
  );
  assert.throws(
    () => adoptFacts(source, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, nameservers: [] }),
    /no nameservers/,
    'and an empty delegation is not a delegation',
  );

  assert.throws(
    () => adoptRegistrar({ source, runbook }, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, registrar: 'Cloudflare, Inc.', ianaId: 999 }),
    /that is a transfer/,
    'a different registrar of record is a transfer, and the runbook proposes where the domain came from',
  );

  const rowless = runbook.replace(/^\| Registered \|.+\|$/m, '');
  assert.throws(
    () => adoptRunbook(rowless, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, expires: '2028-09-17' }),
    /no longer has the Registered row/,
    'a missing line is a refusal, not a silent half-update',
  );

  const literal = source.replace(REGISTRAR_FACTS_PATTERN, '');
  assert.throws(
    () => adoptFacts(literal, REGISTRAR_FACTS, { ...REGISTRAR_FACTS, expires: '2028-09-17' }),
    /no longer has a REGISTRAR_FACTS object literal/,
  );
});

test('the command writes only with --apply, and verifies what it wrote', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['registrar:adopt'], 'node scripts/registrar-adopt.js', 'the command exists under the name the docs use');

  const flag = script.indexOf('if (!APPLY)');
  assert.notEqual(flag, -1, 'the dry run has to be the default, not a mode somebody remembers to ask for');

  const writes = [...script.matchAll(/writeFileSync\(/g)].map(match => match.index);
  assert.equal(writes.length, 3, 'the facts, the runbook and the timeline, all written when the plan is applied');
  assert.ok(
    writes.every(at => at > flag),
    'nothing is written before the flag is checked — a dry run is a dry run',
  );

  assert.match(script, /adoptRegistrar/, "the plan is the module's, not a second implementation");
  assert.match(script, /\.\.\/src\/build\.js/, 'the build re-renders ACCOUNTS.md from what was written');
  assert.match(script, /\.\.\/scripts\/test\.js/, 'and the guard suite is what proves nothing was missed');
  assert.match(script, /process\.exit\(2\)/, 'a refusal has its own status, distinct from drift');
  assert.match(script, /process\.exit\(1\)/, 'and so does a failed verification');

  assert.ok(ADOPTED_FIELDS.includes('expires'), 'the expiry is among the fields a renewal adopts');
  assert.ok(runbook.includes('npm run registrar:adopt'), 'the runbook names the command');
});
