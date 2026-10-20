/**
 * The record-by-record answer, and the rules that make it worth printing.
 *
 * The point of this comparison is to say *which* record disagrees, where the check it replaced could
 * only say that one did. So the tests here are mostly about the distinctions that would otherwise
 * collapse into "does not match": a target address that is missing versus one that answers
 * something else, an address that answers and belongs to nobody's target, a CNAME a provider
 * flattened into the site's own addresses (as much a match as the CNAME itself), and the one
 * deliberate asymmetry — a mail value that answers differently is reported, while a mail record that
 * answers nothing is a failure, because that is mail with nowhere to go.
 *
 * No network: every resolver is injected, and `diffZone` is a pure function of two plain objects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAnswers, diffZone, recordKey, rowLine, targetRecords, TYPES } from '../src/zone-diff.js';
import { HOST, LINK_HOST, MAIL_OBSERVED_ON, MAIL_RECORDS, PAGES_A, PAGES_AAAA, PAGES_DOMAIN, SITE_RECORDS } from '../src/dns.js';

const ENODATA = Object.assign(new Error('no such record'), { code: 'ENODATA' });

const target = targetRecords();
const apexRows = (rows, type) => rows.filter(row => row.name === HOST && row.type === type);

/** The answers a domain that has already been moved would give. */
const moved = () => ({
  [HOST]: {
    A: [...PAGES_A],
    AAAA: [...PAGES_AAAA],
    CNAME: [],
    TXT: [MAIL_RECORDS[1].value],
    MX: [MAIL_RECORDS[0].value],
  },
  [`_dmarc.${HOST}`]: { A: [], AAAA: [], CNAME: [], TXT: [MAIL_RECORDS[2].value], MX: [] },
  [LINK_HOST]: { A: [...PAGES_A], AAAA: [], CNAME: [], TXT: [], MX: [] },
  [`www.${HOST}`]: { A: [...PAGES_A], AAAA: [], CNAME: [], TXT: [], MX: [] },
});

test('the target state is the zone file plus the mail records, with full names', () => {
  assert.equal(target.length, SITE_RECORDS().length + MAIL_RECORDS.length);

  assert.deepEqual(
    target.map(({ type, name }) => `${type} ${name}`),
    [
      'A glamcleaners.net', 'A glamcleaners.net', 'A glamcleaners.net', 'A glamcleaners.net',
      'AAAA glamcleaners.net', 'AAAA glamcleaners.net', 'AAAA glamcleaners.net', 'AAAA glamcleaners.net',
      `CNAME www.${HOST}`, `CNAME ${LINK_HOST}`,
      `MX ${HOST}`, `TXT ${HOST}`, `TXT _dmarc.${HOST}`,
    ],
  );

  assert.equal(
    target.filter(record => record.source === 'zone').length,
    SITE_RECORDS().length,
    'the site records are what the migration writes',
  );
  assert.equal(
    target.filter(record => record.source === 'observed').length,
    MAIL_RECORDS.length,
    'the mail records are carried, which is why the diff treats a changed value differently',
  );
});

test('a value is compared the way its type is written', () => {
  assert.equal(recordKey('CNAME', 'SGSCRAP.GITHUB.IO.'), recordKey('CNAME', PAGES_DOMAIN), 'one name, two spellings');
  assert.equal(recordKey('MX', '10 Mail.BusinessIdentity.LLC.'), '10 mail.businessidentity.llc');
  assert.notEqual(recordKey('TXT', 'v=spf1 a ~all'), recordKey('TXT', 'v=spf1 ~all'), 'SPF is a string, not a name');
});

test('a moved domain matches, record for record', () => {
  const rows = diffZone(target, moved());

  assert.equal(rows.filter(row => row.severity === 'fail').length, 0, 'nothing to report on a domain that is right');
  assert.deepEqual(rows.filter(row => row.severity !== 'pass'), []);
  assert.equal(
    rows.length,
    target.length,
    'one line per target record: the addresses that answer for the two CNAMEs are that record, not extras',
  );
});

test('one line per target address: the one that is there, the ones that are not, the stranger', () => {
  const answers = moved();
  answers[HOST].A = ['185.199.108.153', '66.223.49.89'];
  const rows = apexRows(diffZone(target, answers), 'A');

  assert.equal(rows.find(row => row.value === '185.199.108.153').status, 'match');

  const absent = rows.filter(row => row.status === 'different');
  assert.deepEqual(
    absent.map(row => row.value),
    ['185.199.109.153', '185.199.110.153', '185.199.111.153'],
    'each of the three that does not answer is its own line',
  );
  assert.equal(absent.every(row => row.severity === 'fail'), true);
  assert.match(
    absent[0].why,
    /the name answers 185\.199\.108\.153, 66\.223\.49\.89, and this is not one of them/,
    'and the line says what does answer, without claiming the address that is there is wrong',
  );

  const extra = rows.find(row => row.status === 'extra');
  assert.equal(extra.live, '66.223.49.89', 'what answered instead is on its own line, not in a why');
  assert.equal(extra.severity, 'note', 'the target state says what must be there, not that nothing else may be');
});

test('a name that answers nothing at all is missing, not different', () => {
  const answers = moved();
  answers[HOST].A = [];
  const rows = apexRows(diffZone(target, answers), 'A');

  assert.equal(rows.every(row => row.status === 'missing'), true);
  assert.equal(rows.every(row => row.severity === 'fail'), true);
  assert.match(rows[0].why, /nothing at this name answers with it/);
});

test('a CNAME answered by the site addresses is answered, not missing', () => {
  const flattened = diffZone(target, moved());
  const www = flattened.find(row => row.name === `www.${HOST}`);

  assert.equal(www.status, 'match', 'GitHub accepts a flattened CNAME, and so does the diff');
  assert.equal(www.severity, 'pass');
  assert.match(www.why, /answered as A records instead/, 'and the line says which way it was answered');
  assert.equal(
    flattened.filter(row => row.name === `www.${HOST}` && row.status === 'extra').length,
    0,
    'those addresses are the record, so they are not also reported as records nobody asked for',
  );
});

test('a mail record that answers differently is noted; one that answers nothing fails', () => {
  const changed = moved();
  changed[HOST].TXT = ['v=spf1 include:somewhere.else ~all'];
  const noted = diffZone(target, changed).find(row => row.type === 'TXT' && row.name === HOST);

  assert.equal(noted.status, 'different');
  assert.equal(noted.severity, 'note', 'a provider change after the recorded day is not this check‘s business');
  assert.match(noted.why, new RegExp(MAIL_OBSERVED_ON), 'and it names the day the value was recorded');

  const gone = moved();
  gone[HOST].MX = [];
  const failed = diffZone(target, gone).find(row => row.type === 'MX');

  assert.equal(failed.status, 'missing');
  assert.equal(failed.severity, 'fail', 'a mailbox with no MX is the failure this comparison must not soften');
  assert.match(failed.why, /nothing answers for mail/);

  const dmarcGone = moved();
  dmarcGone[`_dmarc.${HOST}`].TXT = [];
  assert.equal(
    diffZone(target, dmarcGone).find(row => row.type === 'TXT' && row.name === `_dmarc.${HOST}`).severity,
    'fail',
  );
});

test('a site record that answers another name fails, with both values printed', () => {
  const answers = moved();
  answers[`www.${HOST}`] = { A: [], AAAA: [], CNAME: ['forwarder.example'], TXT: [], MX: [] };
  const cname = diffZone(target, answers).find(row => row.name === `www.${HOST}` && row.type === 'CNAME');

  assert.equal(cname.status, 'different');
  assert.equal(cname.severity, 'fail');
  assert.match(cname.why, /the name answers forwarder\.example/);

  const line = rowLine(cname);
  assert.match(line, /✗/);
  assert.match(line, new RegExp(PAGES_DOMAIN), 'the target value is on the line');

  // The shape this domain is actually in: an A record where the CNAME belongs, belonging to no
  // target state — a record that is not there, and one that is there and should not be.
  const wrong = diffZone(target, {
    ...answers,
    [`www.${HOST}`]: { A: ['66.223.49.89'], AAAA: [], CNAME: [], TXT: [], MX: [] },
  }).filter(row => row.name === `www.${HOST}`);

  assert.equal(wrong.find(row => row.type === 'CNAME').status, 'missing');
  assert.equal(wrong.find(row => row.status === 'extra').live, '66.223.49.89');
});

test('every name is asked every type, so an answer nobody asked for is visible', async () => {
  const asked = [];
  const silent = type => async name => {
    asked.push(`${type} ${name}`);
    throw ENODATA;
  };
  const resolve = {
    A: async name => { asked.push(`A ${name}`); return ['185.199.108.153']; },
    AAAA: silent('AAAA'),
    CNAME: silent('CNAME'),
    TXT: async name => { asked.push(`TXT ${name}`); return [['v=spf1 ~all']]; },
    MX: silent('MX'),
  };

  const answers = await collectAnswers([HOST, HOST], { resolve });

  assert.deepEqual(Object.keys(answers), [HOST], 'a name asked twice is resolved once');
  assert.deepEqual(asked.filter(entry => entry.startsWith('A ')).length, 1);
  assert.equal(asked.length, TYPES.length, 'every type is asked, so extras are not invisible');
  assert.deepEqual(answers[HOST].AAAA, [], 'a name with no record answers with nothing');
  assert.deepEqual(answers[HOST].TXT, ['v=spf1 ~all'], 'TXT chunks are joined back into one value');

  await assert.rejects(
    collectAnswers([HOST], { resolve: { ...resolve, A: async () => { throw Object.assign(new Error('timeout'), { code: 'SERVFAIL' }); } } }),
    /A could not be read: SERVFAIL/,
    'a lookup that failed is not an empty name',
  );
});

test('a row prints the target value, and an extra prints the one that answered', () => {
  const records = [{ type: 'A', name: HOST, value: '185.199.108.153', source: 'zone' }];

  const [missing] = diffZone(records, { [HOST]: { A: [] } });
  assert.match(rowLine(missing), /✗ 185\.199\.108\.153\s+nothing at this name answers with it/);

  const rows = diffZone(records, { [HOST]: { A: ['66.223.49.89'] } });
  assert.match(
    rowLine(rows.find(row => row.status === 'different')),
    /✗ 185\.199\.108\.153\s+the name answers 66\.223\.49\.89/,
  );
  assert.match(
    rowLine(rows.find(row => row.status === 'extra')),
    /! 66\.223\.49\.89\s+answers here, and is not in the target state/,
  );

  const [match] = diffZone(records, { [HOST]: { A: ['185.199.108.153'] } });
  assert.equal(rowLine(match).endsWith('185.199.108.153'), true, 'a match has nothing to say after the value');
});
