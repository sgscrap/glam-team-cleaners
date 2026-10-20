/**
 * The runbook against the code it describes.
 *
 * `DOMAIN.md` is the document someone follows with a token in one hand, and it repeats facts that
 * live in code: the records the zone will hold, the redirect rule, which names are proxied, and the
 * three token permissions. Drift is quiet until it is expensive: a token missing Dynamic Redirect
 * fails after the DNS records are already written, and a record table that no longer matches the
 * zone file sends someone to the registrar having written the wrong zone.
 *
 * The target-state table is generated into the document now (`npm run check` compares the whole
 * file, so a stale block is a failed check), and this holds the prose it sits beside — the proxy
 * annotations, the credentials list, and what step 2 says the move deletes — to the same code,
 * plus the block itself to the generator.
 *
 * The deletion list is the one claim prose has to get right rather than merely mention: it says
 * which records stop existing, and a runbook that names one name too many or too few either
 * deletes somebody's service record or leaves the forwarder's address answering.
 *
 * Exact, not approximate: the mail values in the table used to be abbreviated (`rua=…`) and had
 * already drifted from the zone by a whole tag. A runbook is only worth following if the values in
 * it are the values that will be written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OBSOLETE_NAMES,
  OBSOLETE_TYPES,
  REQUIRED_PERMISSIONS,
  TARGET_STATE_END,
  TARGET_STATE_START,
  aliasRedirectRule,
  finalProxyState,
  obsoleteWebRecords,
  runbookName,
  targetStateBlock,
  webRecords,
  withTargetState,
} from '../src/cloudflare.js';
import { HOST, ZONE_FILE } from '../src/dns.js';
import { MAIL_BASELINE } from '../src/mail-records.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runbook = read('DOMAIN.md');
const zone = read(ZONE_FILE);
const script = read('scripts/dns-cloudflare.js');

/** A `## heading` section, up to the next one. */
const section = heading => {
  const start = runbook.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `DOMAIN.md has no "## ${heading}" section`);
  const end = runbook.indexOf('\n## ', start + 1);
  return runbook.slice(start, end === -1 ? runbook.length : end);
};

/** The fenced block under "Target state": the records, then the rule. */
const target = section('Target state');
const block = /```\n([\s\S]*?)```/.exec(target);
assert.ok(block, 'the target state is a fenced block of records');
const lines = block[1].split('\n').map(line => line.trim()).filter(Boolean);
const ruleLine = lines.find(line => line.startsWith('when '));
const table = lines.filter(line => line !== ruleLine).map(line => {
  const [type, name] = line.split(/\s+/);
  return { type, name: name === '@' ? HOST : `${name}.${HOST}`, rest: line.slice(line.indexOf(name) + name.length).trim() };
});

const key = ({ type, name, content }) => `${type} ${name} ${content}`;

/** The zone file as records: the site's, plus the mail snapshot in its comment block. */
const zoneRecords = () => {
  const found = [];
  for (const raw of zone.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('$')) continue;

    if (line.startsWith(';')) {
      // `;   MX     10 mailserver…` and `;   TXT    _dmarc "…"` — the observed mail records.
      const comment = /^;\s+(MX|TXT)\s+(.+)$/.exec(line);
      if (!comment) continue;
      const [, type, body] = comment;
      if (type === 'MX') {
        const [, priority, host] = /^(\d+)\s+(\S+)$/.exec(body) ?? [];
        if (priority) found.push({ type, name: HOST, content: `${priority} ${host}` });
        continue;
      }
      const under = /^(\S+)\s+"([\s\S]*)"$/.exec(body);
      if (under) found.push({ type, name: `${under[1]}.${HOST}`, content: under[2] });
      else found.push({ type, name: HOST, content: body.replace(/^"|"$/g, '') });
      continue;
    }

    const [name, , type, value] = line.split(/\s+/);
    found.push({ type, name: name === '@' ? HOST : `${name}.${HOST}`, content: value.replace(/\.$/, '') });
  }
  return found;
};

test('the target state is the generated block, not a transcription', () => {
  assert.ok(runbook.includes(TARGET_STATE_START), 'the block needs its opening marker: that is what the build rewrites inside');
  assert.ok(runbook.includes(TARGET_STATE_END), 'the block needs its closing marker');
  assert.equal(block[1], targetStateBlock(), 'the document must hold exactly what the generator renders');
  assert.equal(
    withTargetState(runbook),
    runbook,
    'running the generator over the document must change nothing — otherwise `npm run check` fails',
  );
});

/* --- what step 2 says is deleted ----------------------------------------- */

const step2 = runbook.slice(runbook.indexOf('### 2. Write the zone'), runbook.indexOf('### 3.'));
assert.ok(step2.startsWith('### 2. Write the zone'), 'DOMAIN.md has a step 2');

/** The clause that lists the names, found by its verb so a moved paragraph cannot pass vacuously. */
const namesClause = /removes the old web records at ([^.]*)/.exec(step2)?.[1];
assert.ok(namesClause, 'step 2 must say which records it removes');

/** The sentence that says which types, and by implication which are left alone. */
const typesClause = /Only ([^.]+) records at those names go\./.exec(step2)?.[1];
assert.ok(typesClause, 'step 2 must say which record types the clean-up takes');

test('step 2 names exactly the records the clean-up removes', () => {
  const documented = [...namesClause.matchAll(/`([^`]+)`/g)].map(([, name]) => name).sort();
  const expected = OBSOLETE_NAMES.map(runbookName).sort();

  assert.deepEqual(
    documented,
    expected,
    'the names in step 2 must be the names obsoleteWebRecords owns, spelled the way the runbook spells them',
  );

  const types = typesClause.replace(/\s+and\s+/g, ', ').split(/,\s*/);
  assert.deepEqual(types, OBSOLETE_TYPES, 'and the types must be the types it takes');

  assert.match(step2, /Mail is never touched\./, 'the step has to say what the clean-up leaves alone');

  // The function takes its scope from those two lists rather than repeating them, which is what
  // makes this check about the code and not about a comment beside it.
  const source = read('src/cloudflare.js');
  const body = /export const obsoleteWebRecords = [\s\S]*?\n};/.exec(source)?.[0];
  assert.ok(body, 'src/cloudflare.js still defines obsoleteWebRecords');
  assert.match(body, /OBSOLETE_NAMES/, 'the clean-up must delete the names this test reads, not a second copy of them');
  assert.match(body, /OBSOLETE_TYPES/, 'and the types, likewise');
});

test('the clean-up removes those records and nothing else', () => {
  // One record of each owned type at each owned name, plus the records it must not touch: mail, a
  // service verification TXT somebody added, and a name that is not this site's.
  const imported = [
    ...OBSOLETE_NAMES.flatMap(name => OBSOLETE_TYPES.map(type => ({ id: `${type} ${name}`, type, name, content: 'old.example' }))),
    { id: 'mx', type: 'MX', name: HOST, content: 'mailserver.businessidentity.llc' },
    { id: 'spf', type: 'TXT', name: HOST, content: 'v=spf1 a mx ~all' },
    { id: 'dmarc', type: 'TXT', name: `_dmarc.${HOST}`, content: 'v=DMARC1; p=quarantine' },
    { id: 'verify', type: 'TXT', name: HOST, content: 'google-site-verification=abc' },
    { id: `blog.${HOST}`, type: 'A', name: `blog.${HOST}`, content: '203.0.113.5' },
  ];

  const removed = obsoleteWebRecords(imported, webRecords()).map(record => record.id).sort();
  const expected = OBSOLETE_NAMES.flatMap(name => OBSOLETE_TYPES.map(type => `${type} ${name}`)).sort();
  assert.deepEqual(
    removed,
    expected,
    'the names and types step 2 lists must be the whole of what goes, or the operator is told half the story',
  );

  // The other direction, which is the expensive one: a record the runbook does not mention being
  // deleted. Mail and a verification TXT are the two that would hurt.
  const kept = imported.filter(record => !removed.includes(record.id)).map(record => record.id).sort();
  assert.deepEqual(
    kept,
    ['blog.glamcleaners.net', 'dmarc', 'mx', 'spf', 'verify'].sort(),
    'mail, a service verification record and an unowned name must all survive — which is what "Mail is never touched" promises',
  );
});

test('the runbook records exactly what the zone file holds, mail included', () => {
  const documented = table.flatMap(({ type, name, rest }) => {
    if (type === 'A' || type === 'AAAA') {
      return rest.split(/\s+/).map(content => ({ type, name, content }));
    }
    if (type === 'CNAME') {
      return [{ type, name, content: rest.split(/\s+/)[0] }];
    }
    if (type === 'MX') {
      const [, priority, host] = /^(\d+)\s+(\S+)/.exec(rest) ?? [];
      return [{ type, name, content: `${priority} ${host}` }];
    }
    if (type === 'TXT') {
      // `TXT @ "v=spf1 …"` is the apex; `TXT _dmarc "v=DMARC1; …"` names its own subdomain.
      const under = /^(\S+)\s+"([\s\S]*)"$/.exec(rest);
      if (under) return [{ type, name: `${under[1]}.${HOST}`, content: under[2] }];
      const value = /^"([\s\S]*)"$/.exec(rest)?.[1];
      assert.ok(value, `the ${name} TXT row must be quoted so its value is unambiguous`);
      return [{ type, name, content: value }];
    }
    assert.fail(`the target state has a row this check does not understand: ${type}`);
  });

  const expected = zoneRecords();
  const want = expected.map(key).sort();
  const got = documented.map(key).sort();

  const missing = want.filter(entry => !got.includes(entry));
  const extra = got.filter(entry => !want.includes(entry));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    'the runbook table and the zone file must describe one zone; fix whichever is wrong, in both places',
  );
});

test('the runbook shows the proxy state the migration actually leaves behind', () => {
  const state = finalProxyState();

  for (const [name, proxied] of Object.entries(state)) {
    const label = name === HOST ? '@' : name.slice(0, name.length - HOST.length - 1);
    const row = table.find(entry => entry.name === name);
    assert.ok(row, `the target state needs a row for ${name}`);

    // Only a CNAME can be either way; the apex is four A records and four AAAA, and prose beside
    // them would be noise. Its state is still checked — it must not be proxied.
    if (row.type !== 'CNAME') {
      assert.equal(proxied, false, `${name} is a ${row.type}, and nothing but an alias is proxied`);
      continue;
    }

    const saysProxied = /\bproxied\b/.test(row.rest);
    const saysDnsOnly = /DNS only/i.test(row.rest);
    assert.equal(saysProxied, proxied, `${label} must be shown as ${proxied ? 'proxied' : 'DNS only'}`);
    assert.equal(saysDnsOnly, !proxied, `${label} must be shown as ${proxied ? 'proxied' : 'DNS only'}`);
  }

  assert.ok(
    /finalProxyState/.test(script) && /proxied: true/.test(script),
    'the script must take the proxy state from the module this test reads, not from a second copy',
  );
});

test('the runbook states the redirect rule the script installs', () => {
  assert.ok(ruleLine, 'the target state ends with the redirect rule');
  const rule = aliasRedirectRule();
  const { status_code: status, target_url: target, preserve_query_string: keep } = rule.action_parameters.from_value;

  const expected = `when ${rule.expression} then ${status} → ${target.value}${keep ? '  (query kept)' : ''}`;
  assert.equal(
    ruleLine.replace(/\s+/g, ' '),
    expected.replace(/\s+/g, ' '),
    'the rule in the runbook must be the rule `withAliasRedirect` installs',
  );
});

test('the credentials step names every permission the token needs, and no others', () => {
  const step = runbook.slice(runbook.indexOf('### 1. Credentials'), runbook.indexOf('### 2.'));
  assert.ok(step.includes('### 1. Credentials'), 'DOMAIN.md has a credentials step');

  const documented = [...step.matchAll(/^- \*\*(.+?)\*\* — (.+)$/gm)]
    .map(([, name, why]) => ({ name: name.trim(), why: why.trim() }));

  assert.deepEqual(
    documented,
    REQUIRED_PERMISSIONS,
    'a token built from this list must be a token the script can finish the move with',
  );

  assert.ok(
    /for \(const \{ name, why \} of REQUIRED_PERMISSIONS\)/.test(script),
    'the no-credentials message must print the same list, not restate it',
  );
});

/**
 * The registrar is not a name on an invoice anybody remembers: the domain was bought with the LLC
 * through Northwest Registered Agent, and the nameservers live in the client portal of its
 * affiliated registrar, DomainRegistry.com LLC. Step 3 is that one form, so the runbook and the
 * instruction the apply run prints have to send the operator to the same place — one of them
 * naming Northwest's own site, or the LLC lookup page the domain started on, would be a dead end
 * on the one irreversible step.
 */
test('the runbook and the apply run send the operator to the same registrar', () => {
  const login = 'https://www.domainregistry.com/login/';

  assert.ok(script.includes(login), 'the apply run prints where the nameservers are replaced');
  assert.ok(runbook.includes(login), 'and the runbook names the same page');

  assert.match(
    runbook,
    /Northwest Registered Agent/,
    'the runbook says where the domain came from, which is why the registrar is not the remembered name',
  );
  assert.match(script, /Northwest Registered Agent/, 'the printed instruction says which registrar, and why that one');

  const step = runbook.slice(runbook.indexOf('### 3.'), runbook.indexOf('### 4.'));
  assert.notEqual(step, '', 'the runbook has a step 3');
  assert.doesNotMatch(
    step,
    /northwestregisteredagent\.com\/llc-lookup/,
    'the cutover step must not send anyone back to the LLC lookup page: that is where the domain started, not where its nameservers are changed',
  );
});

/**
 * The mail baseline is the check that cannot be left to a second command.
 *
 * It is only worth anything if it is taken before the first write and the zone is compared against
 * it before the nameservers are handed over — a step in the runbook that nobody runs is a step that
 * did not happen, and the failure it guards shows up weeks later as refused mail. So: the capture
 * comes before anything the token writes, the comparison comes before the registrar line, and a
 * mismatch exits 1 in between.
 */
test('the apply run takes the mail baseline and proves the zone against it before handing over', () => {
  const apply = script.slice(script.indexOf('if (!APPLY) {'));
  assert.ok(apply.length, 'the script has an apply path');

  const capture = apply.indexOf('captureMailBaseline(');
  const firstWrite = apply.indexOf('/accounts/${account}/zones');
  const compare = apply.indexOf('compareMail(');
  const handover = apply.indexOf('point the registrar');

  assert.notEqual(capture, -1, 'the apply run must take the baseline itself; an operator can skip a step, a run cannot');
  assert.notEqual(firstWrite, -1, 'the apply path creates a zone, which is its first write');
  assert.ok(capture < firstWrite, 'the baseline must be taken before any write, or it is a reading of the new zone');
  assert.notEqual(compare, -1, 'the apply run must compare the zone it wrote against that baseline');
  assert.ok(compare < handover, 'and do it before it tells anyone to move the nameservers');
  assert.match(
    apply.slice(compare, handover),
    /process\.exit\(1\)/,
    'a zone that lost a mail record must end the run, not print the nameservers under a warning',
  );

  assert.ok(
    runbook.includes(MAIL_BASELINE) && script.includes('MAIL_BASELINE'),
    `the runbook must name the file the script writes (${MAIL_BASELINE}), so the later --compare can find it`,
  );
});
