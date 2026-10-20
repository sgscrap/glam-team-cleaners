/**
 * The mail records, before and after the nameservers move.
 *
 * This exists because the migration's worst failure is the one with no symptom at the switch: MX,
 * SPF, DMARC or a DKIM key that did not come along. Mail keeps arriving for a while, and then a
 * provider starts refusing or quarantining it, weeks later, with nothing in the repository to say
 * what changed. A snapshot taken while the old zone is still authoritative is the only baseline
 * that can prove the new zone answers identically.
 *
 * The snapshot holds values, not opinions: the MX set, the SPF text, the DMARC text, and each DKIM
 * key verbatim under its selector. Comparison is exact, because SPF is a single string whose order
 * and qualifiers matter, and because a re-encoded DKIM key that is "probably the same" is not the
 * same key. A selector that appears after the baseline is reported and does not fail the check —
 * that is a rotation, not a loss, and treating it as failure would teach people to ignore the tool.
 *
 * The apply run does not leave the baseline to a second command: `captureMailBaseline` takes it (or
 * reuses the one already saved) before the token writes anything, and `zoneSnapshot` reads the zone
 * back from the API in the same shape, so `compareMail` can hold the new zone against a reading of
 * the old one. A step in a runbook can be skipped; a step in the run cannot.
 *
 * Kept out of `src/dkim.js` and `src/cloudflare.js` so the comparison can be tested without a
 * network: `collectMail` takes its resolvers, `compareMail` takes two plain objects, and
 * `captureMailBaseline` takes the collector it saves.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { dkimKey, discoverDkim, keyBits } from './dkim.js';
import { HOST } from './dns.js';

/** Resolver answers that mean "no such record", as opposed to "the lookup failed". */
const ABSENT = new Set(['ENODATA', 'ENOTFOUND', 'ENOTIMP']);

/** TXT at one name, retried once, and empty only when the resolver says there is nothing there. */
const readTxt = async (resolve, name) => {
  try {
    return await resolve(name);
  } catch (first) {
    if (ABSENT.has(first.code)) return [];
    try {
      return await resolve(name);
    } catch (second) {
      throw new Error(`${name} could not be read: ${second.code ?? second.message}`, { cause: second });
    }
  }
};

const firstWithTag = (records, tag) => records
  .flat()
  .map(text => text.trim())
  .find(text => new RegExp(`^${tag}\\b`, 'i').test(text)) ?? null;

/**
 * What the domain answers for mail right now: MX as a sorted set, the SPF and DMARC strings as
 * written, and every DKIM key the selector sweep can find.
 */
export const collectMail = async (host, {
  mx = resolveMx,
  txt = resolveTxt,
  discover = discoverDkim,
  selectors = [],
  now = () => new Date().toISOString(),
} = {}) => {
  const [exchanges, apex, dmarcRecords, dkim] = await Promise.all([
    (async () => {
      try {
        return await mx(host);
      } catch (first) {
        if (ABSENT.has(first.code)) return [];
        try {
          return await mx(host);
        } catch (second) {
          throw new Error(`MX for ${host} could not be read: ${second.code ?? second.message}`, { cause: second });
        }
      }
    })(),
    readTxt(txt, host),
    readTxt(txt, `_dmarc.${host}`),
    discover(host, { selectors }),
  ]);

  return {
    host,
    captured: now(),
    mx: exchanges
      .map(({ priority, exchange }) => ({ priority, exchange: exchange.toLowerCase().replace(/\.$/, '') }))
      .sort((left, right) => left.priority - right.priority || left.exchange.localeCompare(right.exchange)),
    spf: firstWithTag(apex, 'v=spf1'),
    dmarc: firstWithTag(dmarcRecords, 'v=DMARC1'),
    dkim: dkim.found.map(({ selector, name, key, bits }) => ({ selector, name, key, bits })),
  };
};

/**
 * MX as a canonical set: sorted by priority then exchange, so a resolver that returns the same
 * records in another order is not a change. Applied here as well as in `collectMail` because a
 * baseline is a file, and a file can be written by hand or by an older version.
 */
const describeMx = mx => (mx.length
  ? [...mx]
    .sort((left, right) => left.priority - right.priority || left.exchange.localeCompare(right.exchange))
    .map(({ priority, exchange }) => `${priority} ${exchange}`)
    .join(', ')
  : 'none');

/**
 * A snapshot against the live zone, check by check. `ok` is the whole answer; `checks` is why.
 *
 * Missing and changed are failures; an added selector is a note. The host check comes first,
 * because comparing two different domains would otherwise pass on "no records — no records".
 */
export const compareMail = (before, after) => {
  const checks = [];
  const notes = [];

  if (before.host !== after.host) {
    return {
      ok: false,
      checks: [{ name: 'host', ok: false, before: before.host, after: after.host, why: 'the snapshot is for a different domain' }],
      notes,
    };
  }

  checks.push({
    name: 'MX',
    ok: describeMx(before.mx) === describeMx(after.mx),
    before: describeMx(before.mx),
    after: describeMx(after.mx),
  });

  for (const [name, field] of [['SPF', 'spf'], ['DMARC', 'dmarc']]) {
    checks.push({
      name,
      ok: (before[field] ?? null) === (after[field] ?? null),
      before: before[field] ?? null,
      after: after[field] ?? null,
    });
  }

  const beforeKeys = new Map((before.dkim ?? []).map(key => [key.selector, key]));
  const afterKeys = new Map((after.dkim ?? []).map(key => [key.selector, key]));

  for (const [selector, key] of beforeKeys) {
    const now = afterKeys.get(selector);
    checks.push({
      name: `DKIM ${selector}`,
      ok: Boolean(now) && now.key === key.key,
      before: key.key,
      after: now?.key ?? null,
      why: now ? 'the key under that selector changed' : 'no key answers at that selector',
      bits: { before: key.bits ?? null, after: now?.bits ?? null },
    });
  }

  for (const selector of afterKeys.keys()) {
    if (!beforeKeys.has(selector)) {
      notes.push(`a selector appeared after the snapshot: ${selector} (a rotation, not a loss)`);
    }
  }

  return { ok: checks.every(check => check.ok), checks, notes };
};

/** A record name as the API returns it, in the spelling the comparison uses. */
const recordName = value => String(value ?? '').toLowerCase().replace(/\.$/, '');
const recordText = value => String(value ?? '').trim();

/**
 * The records the Cloudflare API reports, read the way `collectMail` reads the live zone.
 *
 * The comparison after an apply run is zone-against-baseline, not DNS-against-DNS: at that point
 * the old zone is still authoritative, so asking DNS again would only repeat the baseline. Reading
 * the API back answers the question the run actually has — did the records that were written
 * carry MX, SPF, DMARC and every DKIM key over intact, including any the zone already held.
 */
export const zoneSnapshot = (host, records, { now = () => new Date().toISOString() } = {}) => {
  const apex = recordName(host);
  const normalized = records.map(record => ({
    type: String(record.type ?? '').toUpperCase(),
    name: recordName(record.name),
    content: recordText(record.content),
    priority: record.priority === undefined || record.priority === null ? null : Number(record.priority),
  }));

  const texts = name => normalized
    .filter(record => record.type === 'TXT' && record.name === name)
    .map(record => record.content);

  const dkim = new Map();
  const suffix = `._domainkey.${apex}`;
  for (const record of normalized) {
    if (record.type !== 'TXT' || !record.name.endsWith(suffix)) continue;
    const selector = record.name.slice(0, -suffix.length);
    if (!selector || dkim.has(selector)) continue;
    const key = dkimKey([record.content]);
    if (key) dkim.set(selector, { selector, name: record.name, key, bits: keyBits(key) });
  }

  return {
    host,
    captured: now(),
    mx: normalized
      .filter(record => record.type === 'MX' && record.name === apex && record.content)
      .map(({ priority, content }) => ({
        priority: Number.isFinite(priority) ? priority : 0,
        exchange: content.toLowerCase().replace(/\.$/, ''),
      }))
      .sort((left, right) => left.priority - right.priority || left.exchange.localeCompare(right.exchange)),
    spf: firstWithTag(texts(apex), 'v=spf1'),
    dmarc: firstWithTag(texts(`_dmarc.${apex}`), 'v=DMARC1'),
    dkim: [...dkim.values()],
  };
};

/** Where the apply run keeps its baseline, when nothing else is named. */
export const MAIL_BASELINE = 'mail-baseline.json';

export const isMailSnapshot = value => Boolean(value)
  && typeof value.host === 'string'
  && Array.isArray(value.mx)
  && Array.isArray(value.dkim);

/**
 * The baseline for this migration: the one already saved, or a reading taken now.
 *
 * The apply run calls this before it writes anything, because a baseline taken afterwards is a
 * baseline taken from the new zone — it would agree with everything. An existing file is used
 * unchanged rather than refreshed, for the reason `--save` refuses to overwrite one: a check that
 * can be re-taken until it passes proves nothing. A file that cannot be read, or that belongs to
 * another domain, stops the run instead of being quietly replaced.
 */
export const captureMailBaseline = async (path, {
  host = HOST,
  selectors = [],
  collect = collectMail,
  now,
} = {}) => {
  if (existsSync(path)) {
    let saved;
    try {
      saved = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path} exists but is not readable JSON: ${error.message}`);
    }
    if (!isMailSnapshot(saved)) {
      throw new Error(`${path} exists but is not a mail snapshot — it needs host, mx and dkim`);
    }
    if (recordName(saved.host) !== recordName(host)) {
      throw new Error(`${path} is a baseline for ${saved.host}, not ${host}`);
    }
    return { snapshot: saved, path, wrote: false };
  }

  const snapshot = await collect(host, { selectors, now });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { snapshot, path, wrote: true };
};
