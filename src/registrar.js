/**
 * What the registry says about this domain, and what the repository claims it says.
 *
 * The registrar is the one part of this migration no command could reach: DNS answers, the GitHub
 * API answers, and the layer above both — who holds the domain, when it expires, which nameservers
 * are delegated — lived in a browser. That is where the runbook's weakest sentence came from:
 * "registrar: DomainRegistry.com LLC", observed once, with nothing to re-read it by.
 *
 * RDAP is the registry's own answer, in JSON, over plain HTTPS with no credentials. It is read-only
 * and it is not rate-limited the way WHOIS is, so the facts can be re-read as often as anyone
 * likes — which is what makes it worth writing the recorded values down: `REGISTRAR_FACTS` is what
 * the runbook and the accounts page say, and `compareRegistrar` is what tells them apart from the
 * registry when it changes. An expiry that moves is not an error in the domain; it is the runbook
 * going stale, and it should say so the day it happens rather than the day it matters.
 *
 * Not every TLD publishes at the same address: the base has to be the registry's own, so the
 * handful this repository could plausibly hold are listed and anything else fails loudly instead of
 * querying the wrong registry and reporting its silence.
 */
import { HOST } from './dns.js';

/**
 * The registries that publish RDAP for the TLDs this repository might hold. Verisign answers for
 * `.net` and `.com`; anything else has to be added deliberately, with its own base.
 */
export const RDAP_BASES = {
  net: 'https://rdap.verisign.com/net/v1/domain/',
  com: 'https://rdap.verisign.com/com/v1/domain/',
};

/** Where the domain is looked up, by its TLD. */
export const rdapUrl = host => {
  const tld = host.split('.').pop().toLowerCase();
  const base = RDAP_BASES[tld];
  if (!base) {
    throw new Error(`No RDAP base for .${tld}. Add its registry to RDAP_BASES before trusting an answer.`);
  }
  return `${base}${host.toLowerCase()}`;
};

/** `2026-09-17T15:24:54Z` → `2026-09-17`: a registrar date is a day, not a timestamp. */
const day = value => (value ? String(value).slice(0, 10) : null);

/** The registrar entity's display name, which RDAP carries as a vCard `fn` field. */
const vcardName = entity => {
  const [, fields = []] = entity.vcardArray ?? [];
  const fn = fields.find(field => field[0] === 'fn');
  return fn?.[3] ? String(fn[3]) : null;
};

/**
 * The registry's JSON, reduced to the facts someone writes into a runbook: who the registrar is,
 * what state the domain is in, when it was registered and when it expires, and which nameservers
 * are delegated. Values are normalized the way every other comparison here is — names lowercased
 * and without the trailing dot, lists sorted — so a differently punctuated answer is the same
 * answer.
 */
export const registrarFacts = (host, payload) => {
  const registrar = (payload.entities ?? []).find(entity => (entity.roles ?? []).includes('registrar'));
  const dateOf = action => day((payload.events ?? []).find(event => event.eventAction === action)?.eventDate);
  const ianaId = registrar?.publicIds?.find(id => /IANA Registrar ID/i.test(id.type ?? ''))?.identifier;

  return {
    host,
    registrar: registrar ? vcardName(registrar) : null,
    ianaId: ianaId === undefined ? null : Number(ianaId),
    statuses: [...(payload.status ?? [])].map(status => String(status)).sort(),
    registered: dateOf('registration'),
    expires: dateOf('expiration'),
    changed: dateOf('last changed'),
    nameservers: [...new Set((payload.nameservers ?? [])
      .map(server => String(server.ldhName ?? '').toLowerCase().replace(/\.$/, ''))
      .filter(Boolean))].sort(),
    signed: payload.secureDNS?.delegationSigned === true,
  };
};

/**
 * One RDAP request, retried once, with anything that is not an answer raised as an error.
 *
 * A 404 is a real answer — the registry does not hold that domain — and is reported as such rather
 * than retried: the difference between "not registered" and "the lookup failed" is the whole point
 * of asking a registry.
 */
export const fetchRegistrar = async (host, { request = fetch, url = rdapUrl(host) } = {}) => {
  const ask = async () => {
    const response = await request(url, { headers: { accept: 'application/rdap+json' } });
    if (response.status === 404) throw new Error(`the registry does not hold ${host} — it is not registered`);
    if (!response.ok) throw new Error(`${url} → ${response.status} ${response.statusText ?? ''}`.trim());
    return response;
  };

  let response;
  try {
    response = await ask();
  } catch (first) {
    if (/does not hold/.test(first.message)) throw first;
    try {
      response = await ask();
    } catch (second) {
      throw new Error(`RDAP could not be read for ${host}: ${second.message}`, { cause: second });
    }
  }

  const payload = await response.json().catch(() => {
    throw new Error(`${url} answered with something that is not RDAP JSON`);
  });
  return registrarFacts(host, payload);
};

/**
 * What this repository records the registry as saying, read on `observed`. Every consumer of these
 * facts — the runbook's table, the accounts page, this command — reads them from here, so a change
 * is one edit and not three.
 */
// --- registrar facts: rewritten by `npm run registrar:adopt` — do not edit this block by hand ---
export const REGISTRAR_FACTS = {
  observed: '2026-10-17',
  host: HOST,
  registrar: 'DomainRegistry.com LLC',
  ianaId: 128,
  statuses: ['active'],
  registered: '2026-09-17',
  expires: '2027-09-17',
  nameservers: ['ns1.hosting.businessidentity.llc', 'ns2.hosting.businessidentity.llc'],
  signed: false,
};
// --- end registrar facts ---

/**
 * The comparison above answers "has the runbook gone stale". It cannot answer "is there time left",
 * because a recorded expiry that agrees with the registry perfectly still arrives one day. That is
 * the one fact in this repository nothing else can notice: every other guard is triggered by a
 * push, and a date passes whether or not anyone pushes.
 *
 * So the expiry gets a horizon rather than an equality: 60 days, enough to renew and to move the
 * nameservers if the renewal is the moment someone also decides to change registrars, and short
 * enough that it cannot arrive during a holiday. Inside the window is a failure, not a reminder —
 * the point of a scheduled check is that it is the thing that speaks.
 */
export const RENEWAL_WARNING_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A UTC midnight from a date or the timestamp RDAP returns, or null if there is no date there. */
const utcMidnight = value => {
  const text = day(value);
  if (!text) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Days from `today` to `expires`, counted in whole UTC days so the answer does not depend on the
 * hour the check happens to run at. Negative means it has already expired; null means the registry
 * did not say, which is not a number to guess at.
 */
export const daysUntilExpiry = (expires, today = new Date().toISOString().slice(0, 10)) => {
  const from = utcMidnight(today);
  const to = utcMidnight(expires);
  if (from === null || to === null) return null;
  return Math.round((to - from) / MS_PER_DAY);
};

/**
 * The verdict a scheduled run acts on: the expiry against the horizon, and the status against what
 * this repository records. Both are failures, and they are kept apart so the failure says which of
 * the two happened — "renew it" and "something at the registrar changed" call for different
 * actions, and the one that is not the expiry must not be reported as one.
 *
 * `today` is a parameter because a check whose behaviour depends on the wall clock can only be
 * tested on the days it happens to be wrong.
 */
export const renewalVerdict = (recorded, live, {
  today = new Date().toISOString().slice(0, 10),
  warnDays = RENEWAL_WARNING_DAYS,
} = {}) => {
  const ordered = values => [...new Set(values ?? [])].map(String).sort();
  const recordedStatuses = ordered(recorded.statuses);
  const liveStatuses = ordered(live.statuses);

  const days = daysUntilExpiry(live.expires, today);
  const state = days === null ? 'unknown' : days < 0 ? 'expired' : days <= warnDays ? 'near' : 'fine';
  const expiryAt = utcMidnight(live.expires);

  return {
    ok: state === 'fine' && describe(recordedStatuses) === describe(liveStatuses),
    today,
    expiry: {
      ok: state === 'fine',
      state,
      expires: live.expires ?? null,
      days,
      warnDays,
      warnFrom: expiryAt === null ? null : day(new Date(expiryAt - warnDays * MS_PER_DAY).toISOString()),
    },
    statuses: {
      ok: describe(recordedStatuses) === describe(liveStatuses),
      recorded: recordedStatuses,
      live: liveStatuses,
    },
  };
};

/** The fields compared, in the order they are printed. `changed` is read but not compared. */
export const REGISTRAR_FIELDS = ['registrar', 'ianaId', 'statuses', 'registered', 'expires', 'nameservers', 'signed'];

const describe = value => {
  if (value === null || value === undefined) return '(none)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

/**
 * The recorded facts against the registry's, field by field — `ok` is the whole answer, `checks` is
 * why. The same shape as `compareMail`, deliberately: two comparisons in one repository should not
 * disagree about what a row looks like.
 */
export const compareRegistrar = (recorded, live) => {
  const checks = REGISTRAR_FIELDS.map(field => {
    const before = recorded[field];
    const after = live[field];
    const same = Array.isArray(before) || Array.isArray(after)
      ? describe([...new Set([...(before ?? [])])]) === describe([...new Set([...(after ?? [])])])
      : before === after;
    return { name: field, ok: same, recorded: before, live: after };
  });

  return { ok: checks.every(check => check.ok), checks, text: check => `${check.name} ${describe(check.live)}` };
};

/* --- adopting what the registry says into the files that state it ------- */

/**
 * Renewing is not the hard part; transcribing is.
 *
 * The facts are recorded in one object and restated in the runbook's prose, and the renewal
 * checklist asked a person to copy dates from `npm run registrar` into `src/registrar.js`, rebuild,
 * and hope they had not mistyped a day. That is the step most likely to be done wrong at the moment
 * it is done — early in the morning, after a warning, in a hurry.
 *
 * So adoption is mechanical: read the registry, refuse an answer that is incomplete, refuse a
 * *different registrar* (that is a transfer, and the runbook's story about where this domain came
 * from has to be rewritten by a person), and otherwise rewrite both places the facts live. The
 * observation date moves only when something actually changed, so running this when nothing has is
 * a no-op rather than a file churn.
 *
 * `scripts/registrar-adopt.js` is the part that writes, rebuilds and runs the guards. Everything
 * here returns new text and never touches the disk.
 */

/**
 * The block this repository records the registry as saying, between its markers. Matched whole and
 * replaced whole: the markers exist so that the rewrite cannot find the same shape inside the
 * renderer below and edit the code that writes it.
 */
export const FACTS_MARKER_START = '// --- registrar facts: rewritten by `npm run registrar:adopt` — do not edit this block by hand ---';
export const FACTS_MARKER_END = '// --- end registrar facts ---';
export const REGISTRAR_FACTS_PATTERN = /\/\/ --- registrar facts:[^\n]*\n[\s\S]*?\n\/\/ --- end registrar facts ---/;

const quoted = value => (typeof value === 'number' || typeof value === 'boolean'
  ? String(value)
  : `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

const listed = (values, indent) => {
  const inline = `[${values.map(quoted).join(', ')}]`;
  if (values.length <= 2 && inline.length <= 72) return inline;
  return `[\n${values.map(value => `${' '.repeat(indent + 2)}${quoted(value)},`).join('\n')}\n${' '.repeat(indent)}]`;
};

/**
 * The recorded facts, as the source that holds them. `host: HOST` is written out as a reference and
 * never as a string: the domain is defined once, in `src/dns.js`, and a renderer that baked it in
 * would make this file a second place to change it.
 */
export const renderRegistrarFacts = facts => `${FACTS_MARKER_START}
export const REGISTRAR_FACTS = {
  observed: ${quoted(facts.observed)},
  host: HOST,
  registrar: ${quoted(facts.registrar)},
  ianaId: ${quoted(facts.ianaId)},
  statuses: ${listed(facts.statuses, 2)},
  registered: ${quoted(facts.registered)},
  expires: ${quoted(facts.expires)},
  nameservers: ${listed(facts.nameservers, 2)},
  signed: ${quoted(facts.signed)},
};
${FACTS_MARKER_END}`;

/** The fields a renewal or a status change can move, in the order they are reported. */
export const ADOPTED_FIELDS = ['statuses', 'registered', 'expires', 'nameservers', 'signed'];

const today = () => new Date().toISOString().slice(0, 10);

/** What the registry moved, as comparison rows — the same rows `npm run registrar` prints. */
const driftOf = (recorded, live) => compareRegistrar(recorded, live).checks.filter(check => !check.ok);

/**
 * An answer that is missing the facts cannot be adopted into them: half a registrar, or no expiry,
 * would be written into the runbook as though the registry had said it. Everything that gets written
 * has to be present first.
 */
const requireComplete = live => {
  const missing = [
    ['registrar', () => !live.registrar],
    ['ianaId', () => !live.ianaId],
    ['registered', () => !live.registered],
    ['expires', () => !live.expires],
    ['nameservers', () => !(live.nameservers ?? []).length],
  ].filter(([, absent]) => absent()).map(([field]) => field);

  if (missing.length) {
    throw new Error(`the registry's answer is incomplete — no ${missing.join(', no ')} — so there is nothing whole to record`);
  }
};

/**
 * A different registrar of record is a transfer, not a renewal. Adopting it would rewrite dates into
 * a document that still says the domain came with the LLC through Northwest — true prose with a
 * false name in it. So it stops, and says why.
 */
const requireSameRegistrar = (recorded, live) => {
  if (live.registrar !== recorded.registrar || Number(live.ianaId) !== Number(recorded.ianaId)) {
    throw new Error(
      `the registrar of record changed (${recorded.registrar}, IANA ${recorded.ianaId} → `
      + `${live.registrar}, IANA ${live.ianaId}); that is a transfer, and the runbook's prose about where`
      + ' this domain came from has to be rewritten by a person before the dates are adopted',
    );
  }
};

/**
 * `src/registrar.js` with the registry's answer adopted into it, and the fields that moved.
 * Nothing is returned unless the whole answer can be written: refusals throw before any text is
 * produced, so a caller cannot half-apply one.
 */
export const adoptFacts = (source, recorded, live, { observed = today() } = {}) => {
  requireComplete(live);
  requireSameRegistrar(recorded, live);

  const drift = driftOf(recorded, live);
  if (!drift.length) return { source, changes: [] };

  if (!REGISTRAR_FACTS_PATTERN.test(source)) {
    throw new Error('src/registrar.js no longer has a REGISTRAR_FACTS object literal to rewrite');
  }

  const merged = { ...recorded, observed };
  for (const field of ADOPTED_FIELDS) merged[field] = live[field];

  return {
    source: source.replace(REGISTRAR_FACTS_PATTERN, () => renderRegistrarFacts(merged)),
    changes: [
      ...drift.map(check => ({ field: check.name, from: check.recorded, to: check.live })),
      { field: 'observed', from: recorded.observed, to: observed },
    ],
  };
};

/**
 * `DOMAIN.md` with the same facts adopted into its prose, and the lines that moved.
 *
 * The runbook is hand-written, so adoption edits it surgically: the sentence that dates the reading,
 * the row that holds the registration and expiry, and the row that holds the delegated nameservers.
 * A phrase that has gone missing is a refusal rather than a silent half-update — the guards would
 * catch the half-update later, but the operator would be holding a runbook that disagrees with
 * itself until they did.
 */
export const adoptRunbook = (text, recorded, live, { observed = today() } = {}) => {
  requireComplete(live);
  requireSameRegistrar(recorded, live);

  if (!driftOf(recorded, live).length) return { text, changes: [] };
  if (!text.includes(recorded.registrar)) {
    throw new Error(`DOMAIN.md no longer names ${recorded.registrar}, so the registrar row cannot be checked`);
  }

  const edits = [
    {
      label: 'the date this was read',
      pattern: /when this was read on \d{4}-\d{2}-\d{2}/,
      render: () => `when this was read on ${observed}`,
    },
    {
      label: 'the Registered row',
      pattern: /^\| Registered \| \d{4}-\d{2}-\d{2}, expires \d{4}-\d{2}-\d{2} \(RDAP\) \|$/m,
      render: () => `| Registered | ${live.registered}, expires ${live.expires} (RDAP) |`,
    },
    {
      label: 'the Nameservers row',
      pattern: /^\| Nameservers \| .+\|$/m,
      render: () => `| Nameservers | ${live.nameservers.map(server => `\`${server.toUpperCase()}\``).join(', ')} |`,
    },
  ];

  const changes = [];
  let next = text;

  for (const { label, pattern, render } of edits) {
    if (!pattern.test(next)) {
      throw new Error(`DOMAIN.md no longer has ${label}; update it by hand, then fix the adopter's pattern`);
    }
    const before = pattern.exec(next)[0];
    const after = render();
    if (before === after) continue;
    next = next.replace(pattern, () => after);
    changes.push({ label, from: before, to: after });
  }

  return { text: next, changes };
};

/**
 * Both files in one step, or neither: the caller writes only when this returns, and it throws before
 * producing anything when either file cannot be updated whole.
 */
export const adoptRegistrar = ({ source, runbook }, recorded, live, { observed } = {}) => {
  const facts = adoptFacts(source, recorded, live, { observed });
  const prose = adoptRunbook(runbook, recorded, live, { observed });
  return { source: facts.source, runbook: prose.text, changes: { facts: facts.changes, runbook: prose.changes } };
};

export { describe as describeRegistrarValue };
