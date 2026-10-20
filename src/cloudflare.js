/**
 * The records the zone needs once it lives at Cloudflare, built from the same values the site
 * publishes and the mail records the domain answers with today.
 *
 * Kept apart from scripts/dns-cloudflare.js so the mapping can be tested without a token, a
 * network, or the chance of writing to a real zone: the script is the only thing that talks to
 * the API, and everything it decides is decided here.
 */
import { dkimName } from './dkim.js';
import { HOST, LINK_HOST, MAIL_RECORDS, PAGES_A, PAGES_AAAA, PAGES_DOMAIN, SITE_RECORDS } from './dns.js';
import { LINKS_URL } from './links.js';

/** Auto TTL: Cloudflare's own default, and one less number to keep in step. */
const AUTO = 1;

/** A record's identity for comparison: type, name and value, without the Cloudflare id. */
export const recordKey = record => `${record.type}|${record.name}|${record.content}`;

/**
 * The token's permissions, named once because three places repeat them: this list, the runbook's
 * credentials step, and the error the script prints when there is no token. Drift there is not
 * cosmetic — a token without Dynamic Redirect fails halfway through a move, after the records are
 * written — so `test/runbook.test.js` holds the runbook to this list, in both directions.
 */
export const REQUIRED_PERMISSIONS = [
  { name: 'Zone → DNS → Edit', why: 'the records' },
  { name: 'Zone → Dynamic Redirect → Edit', why: 'the redirect rule' },
  { name: 'Zone → Zone → Read', why: 'looking the zone up by name' },
];

/**
 * Which names are proxied once the move is finished, and which must not be.
 *
 * The apex and `www` stay grey because GitHub has to answer for them to issue their certificates;
 * `links` is orange because a redirect rule only sees traffic for a proxied name, and Cloudflare's
 * Universal SSL covers that first-level subdomain as soon as it is. The records are written grey
 * and flipped after the rule exists, so a failed rule never leaves the alias proxied to nothing.
 */
export const finalProxyState = () => ({
  [HOST]: false,
  [`www.${HOST}`]: false,
  [LINK_HOST]: true,
});

/**
 * The site's records. `proxied: false` is not a preference: GitHub Pages issues a certificate for
 * the hostname, and an orange-clouded record answers with Cloudflare's certificate for a name
 * GitHub then cannot verify.
 */
export const webRecords = () => [
  ...PAGES_A.map(content => ({ type: 'A', name: HOST, content, proxied: false, ttl: AUTO })),
  ...PAGES_AAAA.map(content => ({ type: 'AAAA', name: HOST, content, proxied: false, ttl: AUTO })),
  { type: 'CNAME', name: `www.${HOST}`, content: PAGES_DOMAIN, proxied: false, ttl: AUTO },
  { type: 'CNAME', name: `links.${HOST}`, content: PAGES_DOMAIN, proxied: false, ttl: AUTO },
];

/**
 * The phase Cloudflare keeps Single Redirect rules in. Spelled here rather than in the script so
 * the rule and the request that carries it cannot disagree.
 */
export const REDIRECT_PHASE = 'http_request_dynamic_redirect';

/**
 * The redirect that removes the second copy of the link page.
 *
 * The subdomain and `/links/` served the same page, and only a canonical tag said which one
 * mattered. A 301 says it at the only layer that can: a request to the alias never reaches a copy
 * at all, and the query string rides along so a tagged link still reports where it came from.
 *
 * Cloudflare only sees traffic for a name whose DNS record is proxied, so installing this rule is
 * what makes that one record orange — the apex and `www` stay grey, because GitHub has to answer
 * for them to issue their certificates.
 */
/**
 * The runbook's target state, as the two things it describes: the records and the rule.
 *
 * The table was transcribed by hand and its mail values had already lost a tag when someone read
 * it, which is exactly the failure a runbook cannot afford — it is the list a person writes into a
 * registrar and then checks against. So it is rendered here from the same `SITE_RECORDS`,
 * `MAIL_RECORDS` and `finalProxyState()` that produce the zone file and the API calls, and
 * `npm run check` holds `DOMAIN.md` to the result.
 */
export const targetStateBlock = () => {
  const state = finalProxyState();
  const note = proxied => (proxied
    ? 'proxied  — the redirect rule only sees proxied traffic'
    : 'DNS only — GitHub must answer to issue the certificate');

  const siteRows = [];
  for (const { type, name, content } of SITE_RECORDS()) {
    const previous = siteRows[siteRows.length - 1];
    // Four addresses of one type are one row in a table a person reads, not four.
    if (previous && previous.type === type && previous.name === name) {
      previous.values.push(content);
      continue;
    }
    const absolute = name === '@' ? HOST : `${name}.${HOST}`;
    siteRows.push({ type, name, values: [content], note: type === 'CNAME' ? note(state[absolute]) : undefined });
  }

  const mailRows = MAIL_RECORDS.map(({ type, name, value }) => ({
    type,
    name,
    values: [type === 'TXT' ? `"${value}"` : value],
  }));

  // One column for the annotations, so three rows do not each invent their own gap.
  const annotated = 40;
  const rows = [...siteRows, ...mailRows].map(({ type, name, values, note: why }) => {
    const left = `${type.padEnd(7)}${name.padEnd(7)}${values.join('  ')}`;
    return why ? `${left.padEnd(annotated)}${why}` : left;
  });

  const rule = aliasRedirectRule();
  const { status_code: status, target_url: target, preserve_query_string: keep } = rule.action_parameters.from_value;
  const ruleLine = `when ${rule.expression} then ${status} → ${target.value}${keep ? '  (query kept)' : ''}`;

  return `${rows.join('\n')}\n\n${ruleLine}\n`;
};

/**
 * The markers around that block. Only what sits between them is rewritten, so the prose around the
 * table stays hand-written — and `npm run check` compares the whole document, which is how a stale
 * block is caught rather than published.
 */
export const TARGET_STATE_START = '<!-- target state: generated from src/dns.js and src/cloudflare.js — do not edit -->';
export const TARGET_STATE_END = '<!-- end target state -->';

/** `DOMAIN.md` with its generated region replaced. Idempotent: running it twice changes nothing. */
export const withTargetState = text => {
  const start = text.indexOf(TARGET_STATE_START);
  const end = text.indexOf(TARGET_STATE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`DOMAIN.md lost its generated-region markers: ${TARGET_STATE_START} … ${TARGET_STATE_END}`);
  }
  return `${text.slice(0, start + TARGET_STATE_START.length)}\n\`\`\`\n${targetStateBlock()}\`\`\`\n${text.slice(end)}`;
};

export const aliasRedirectRule = () => ({
  description: `Send ${LINK_HOST} to the link page's canonical address`,
  expression: `(http.host eq "${LINK_HOST}")`,
  action: 'redirect',
  action_parameters: {
    from_value: {
      target_url: { value: LINKS_URL },
      status_code: 301,
      preserve_query_string: true,
    },
  },
  enabled: true,
});

/**
 * The calls that install those rules, as values rather than as requests made inline.
 *
 * Two ways, and the difference matters: Cloudflare will not accept a ruleset's name or kind on an
 * update — "you cannot update the name of the ruleset or its type" — while a ruleset that does not
 * exist yet must be created with both. Sending the wrong one of these is a 400 in the middle of a
 * migration, so both bodies are pinned by tests.
 */
export const redirectWrites = (zoneId, rules) => ({
  read: `/zones/${zoneId}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`,
  update: {
    method: 'PUT',
    path: `/zones/${zoneId}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`,
    body: { rules },
  },
  create: {
    method: 'POST',
    path: `/zones/${zoneId}/rulesets`,
    body: { name: `Zone-level ${REDIRECT_PHASE}`, kind: 'zone', phase: REDIRECT_PHASE, rules },
  },
});

/**
 * The rules the entrypoint should hold: this rule in place of any earlier copy of it, and every
 * other rule exactly as it was. Cloudflare replaces the whole list on write, so a rule somebody
 * else added to the same phase would be deleted by a naive PUT.
 */
export const withAliasRedirect = (rules = [], rule = aliasRedirectRule()) => [
  ...rules.filter(existing => existing.description !== rule.description),
  rule,
];

/**
 * The mailbox, carried over verbatim from the live zone — MX and the apex TXT records, which is
 * where SPF lives. Read rather than transcribed: this is the record that decides whether mail keeps
 * arriving after the move.
 */
export const mailRecords = (mx, txt) => [
  ...mx.map(({ exchange, priority }) => ({ type: 'MX', name: HOST, content: exchange, priority, ttl: AUTO })),
  ...txt.flat().map(content => ({ type: 'TXT', name: HOST, content, ttl: AUTO })),
];

/** DMARC, under the name it is published at rather than the apex. */
export const dmarcRecords = txt => txt
  .flat()
  .map(content => ({ type: 'TXT', name: `_dmarc.${HOST}`, content, ttl: AUTO }));

/**
 * DKIM, at the name its selector puts it under.
 *
 * The values are copied from the live zone by `discoverDkim` before the switch, not composed here:
 * a DKIM key is an opaque public key, and a rewritten one verifies nothing. Nothing is created when
 * nothing was found — writing a fabricated `p=` would be worse than the missing record, because it
 * would look configured.
 */
export const dkimRecords = (host, keys) => keys.map(({ selector, key }) => ({
  type: 'TXT',
  name: dkimName(selector, host),
  content: key,
  ttl: AUTO,
}));

/**
 * The names the clean-up owns, and the only types it takes: the three names this site publishes and
 * any wildcard, as A, AAAA or CNAME.
 *
 * Data rather than two sets inside the function, because `DOMAIN.md`'s step 2 is prose about
 * exactly this list — "removes the old web records at `@`, `www`, `links` and the wildcard `*`" —
 * and `test/runbook.test.js` reads that sentence and holds it to these. Mail is not web, and a TXT
 * record somebody added to verify a service is not this script's to judge.
 */
export const OBSOLETE_NAMES = [HOST, `www.${HOST}`, `links.${HOST}`, `*.${HOST}`];
export const OBSOLETE_TYPES = ['A', 'AAAA', 'CNAME'];

/**
 * How `DOMAIN.md`'s step 2 spells one of those names — `@` for the apex, `*` for the wildcard, and
 * a bare label otherwise. Here rather than in the test so the sentence and the list are held to one
 * spelling: `test/runbook.test.js` reads the step and compares it to these names.
 */
export const runbookName = name => (name === HOST
  ? '@'
  : name === `*.${HOST}`
    ? '*'
    : name.slice(0, -(HOST.length + 1)));

/**
 * What must go, given what the zone holds and what it should hold.
 *
 * Cloudflare imports a zone's existing records when it is added, so the forwarder's address and the
 * wildcard arrive with it — and a zone holding both those and GitHub's addresses answers from
 * whichever it likes. So the old web records at the names above are removed, and only those: what
 * is left over is reported to the operator instead, under "Left alone — not part of this move".
 */
export const obsoleteWebRecords = (current, desired) => {
  const wanted = new Set(desired.map(recordKey));
  const owned = new Set(OBSOLETE_NAMES);
  const web = new Set(OBSOLETE_TYPES);
  return current.filter(record => web.has(record.type)
    && owned.has(record.name)
    && !wanted.has(recordKey(record)));
};
