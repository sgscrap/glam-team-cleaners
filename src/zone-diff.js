/**
 * The target state, record by record, against what the domain answers.
 *
 * `npm run domain` used to report only that a check passed or failed — "the four GitHub Pages
 * addresses", or "it should be a CNAME to sgscrap.github.io". That names the question rather than
 * the records: with three of the four addresses right, whoever reads it has to resolve the name by
 * hand to find the missing one, and a check that cannot say what disagrees gets re-read instead of
 * fixed.
 *
 * So the target state is read from the same modules that write the zone file and the runbook table
 * (`SITE_RECORDS` and the mail records recorded beside them), and each record is answered for
 * individually: this address answers, that one does not, a fourth answers and is not in the target
 * state at all. The site records are the target the migration is aiming at, so a missing or
 * different one is a failure; the mail values are what the domain answered on the day they were
 * recorded, carried across a move rather than prescribed by it, so one that answers differently is
 * reported and one that answers nothing is a failure — a mailbox cannot lose its MX quietly.
 *
 * Here rather than in the script for the same reason as `src/mail-records.js`: every resolver is
 * injectable, `diffZone` is a pure function of two plain objects, and the script is left with the
 * resolving and the printing.
 */
import { resolve4, resolve6, resolveCname, resolveMx, resolveTxt } from 'node:dns/promises';
import { HOST, MAIL_OBSERVED_ON, MAIL_RECORDS, PAGES_A, SITE_RECORDS } from './dns.js';

/** Resolver answers that mean "there is no such record", as opposed to "the lookup failed". */
const ABSENT = new Set(['ENODATA', 'ENOTFOUND', 'ENOTIMP']);

/**
 * Every type asked about at every name. The target state's own types, plus the ones a CNAME can be
 * flattened into — a provider that answers www with the site's addresses instead of a CNAME is
 * answering the record, not dropping it, and reading only CNAME would call that a failure.
 */
export const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

const SERVER = { A: resolve4, AAAA: resolve6, CNAME: resolveCname, TXT: resolveTxt, MX: resolveMx };

/**
 * The target state as records with the same shape, from the two places that define it: the zone's
 * site records, and the mail records the runbook shows as observed values rather than as requests.
 *
 * `source` is what the comparison turns on — `zone` is a record the migration writes, `observed` is
 * a record it carries — and it is on every row so a printed line can say which it was.
 */
export const targetRecords = () => {
  const absolute = name => (name === '@' ? HOST : `${name}.${HOST}`);
  return [
    ...SITE_RECORDS().map(({ type, name, content }) => ({
      type, name: absolute(name), value: content, source: 'zone',
    })),
    ...MAIL_RECORDS.map(({ type, name, value }) => ({
      type, name: absolute(name), value, source: 'observed',
    })),
  ];
};

/**
 * How one value is compared: TXT exactly, because SPF is a single string whose order and qualifiers
 * matter; everything else case-insensitively and without the trailing dot a resolver adds, because
 * `SGSCRAP.GITHUB.IO.` and `sgscrap.github.io` are one name.
 */
export const recordKey = (type, value) => {
  const text = String(value).trim();
  return type === 'TXT' ? text : text.toLowerCase().replace(/\.$/, '');
};

const sameSet = (left, right) => [...left].map(String).sort().join('\u0000') === [...right].map(String).sort().join('\u0000');

/** One lookup, retried once, empty only when the resolver says there is nothing there. */
const ask = async (resolve, name, type) => {
  let answers;
  try {
    answers = await resolve(name);
  } catch (first) {
    if (ABSENT.has(first.code)) return [];
    try {
      answers = await resolve(name);
    } catch (second) {
      throw new Error(`${name} ${type} could not be read: ${second.code ?? second.message}`, { cause: second });
    }
  }

  if (type === 'MX') {
    return answers
      .map(({ priority, exchange }) => `${priority} ${String(exchange).toLowerCase().replace(/\.$/, '')}`)
      .sort();
  }
  // `resolveTxt` returns one array per record and one string per 255-byte chunk: a long SPF or DMARC
  // value arrives split, and only joins back into one value once the chunks are concatenated.
  if (type === 'TXT') return answers.map(chunks => chunks.join('').trim()).sort();
  return answers.map(value => String(value).trim().toLowerCase().replace(/\.$/, '')).sort();
};

/**
 * What every name answers, by type. One pass for all of them, so the wildcard probe and the target
 * state are read the same way — and a name that does not resolve answers with an empty list rather
 * than with an error, because "no record here" is the answer a comparison needs.
 */
export const collectAnswers = async (names, { resolve = SERVER, types = TYPES } = {}) => {
  const unique = [...new Set(names)];
  const entries = await Promise.all(unique.map(async name => [
    name,
    Object.fromEntries(await Promise.all(types.map(async type => [type, await ask(resolve[type], name, type)]))),
  ]));
  return Object.fromEntries(entries);
};

/** Why a target record that nothing answers for is missing, said in the terms of its own type. */
const missingWhy = record => {
  if (record.type === 'MX') return 'nothing answers for mail at this name';
  if (record.source === 'observed') return 'the domain does not answer with this any more';
  return 'nothing at this name answers with it';
};

/**
 * One target record's verdict.
 *
 * `wanted` is the name's set of target values, and the one writer here: a CNAME answered by the
 * site's own addresses consumes those addresses, so they are not then reported a second time as
 * records that are not in the target state.
 */
const verdict = (record, byType, wanted) => {
  const live = byType[record.type] ?? [];
  const key = recordKey(record.type, record.value);
  const match = { ...record, status: 'match', severity: 'pass', live: null, why: null };

  if (live.some(value => recordKey(record.type, value) === key)) return match;

  if (record.type === 'CNAME') {
    const flattened = byType.A ?? [];
    if (!live.length && flattened.length && sameSet(flattened, PAGES_A)) {
      for (const value of flattened) wanted.add(recordKey('A', value));
      return { ...match, why: 'answered as A records instead, which GitHub accepts' };
    }
  }

  if (!live.length) {
    return { ...record, status: 'missing', severity: 'fail', live: null, why: missingWhy(record) };
  }

  // What answered in place of it, said in a way that is true whether the type holds one record or
  // four: "the name answers X" reads as a substitution for a CNAME, and would read as a lie beside a
  // missing address when three of the four answers are still the ones the target state wants.
  const why = live.length === 1
    ? `the name answers ${live[0]}`
    : `the name answers ${live.join(', ')}, and this is not one of them`;
  if (record.source === 'observed') {
    return {
      ...record,
      status: 'different',
      severity: 'note',
      live: live.join(', '),
      why: `${why} — the value recorded on ${MAIL_OBSERVED_ON}; a provider change since then is not a failure`,
    };
  }
  return { ...record, status: 'different', severity: 'fail', live: live.join(', '), why };
};

/**
 * Every target record, with what the name answered, in the order the target state lists them: the
 * records of each name and type, then whatever else that name answers.
 *
 * Extras are notes, never failures: the target state says what has to be there, not that nothing
 * else may be, and a check that failed on a TXT somebody added to verify a service would be turned
 * off rather than fixed.
 */
export const diffZone = (records, answers) => {
  const rows = [];
  const names = [...new Set(records.map(record => record.name))];
  const wanted = new Map(names.map(name => [name, new Set()]));
  for (const record of records) wanted.get(record.name).add(recordKey(record.type, record.value));

  for (const name of names) {
    const byType = answers[name] ?? {};
    for (const type of TYPES) {
      for (const record of records.filter(candidate => candidate.name === name && candidate.type === type)) {
        rows.push(verdict(record, byType, wanted.get(name)));
      }
    }
    for (const type of TYPES) {
      for (const value of byType[type] ?? []) {
        if (wanted.get(name).has(recordKey(type, value))) continue;
        rows.push({
          type,
          name,
          value: null,
          live: value,
          source: 'live',
          status: 'extra',
          severity: 'note',
          why: 'answers here, and is not in the target state',
        });
      }
    }
  }

  return rows;
};

const MARK = { pass: '✓', fail: '✗', note: '!' };

/**
 * One record, as the line printed under the check that owns it: the target value first, then what
 * the domain said instead. An extra row has no target value, so it prints the one that answered.
 */
export const rowLine = (row, { indent = '        ' } = {}) => {
  const value = String(row.value ?? row.live);
  const columns = `${indent}${MARK[row.severity]} ${value.padEnd(34)}`;
  return row.why ? `${columns}${row.why}` : columns.trimEnd();
};
