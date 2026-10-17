/**
 * The records the zone needs once it lives at Cloudflare, built from the same values the site
 * publishes and the mail records the domain answers with today.
 *
 * Kept apart from scripts/dns-cloudflare.js so the mapping can be tested without a token, a
 * network, or the chance of writing to a real zone: the script is the only thing that talks to
 * the API, and everything it decides is decided here.
 */
import { HOST, LINK_HOST, PAGES_A, PAGES_AAAA, PAGES_DOMAIN } from './dns.js';
import { LINKS_URL } from './links.js';

/** Auto TTL: Cloudflare's own default, and one less number to keep in step. */
const AUTO = 1;

/** A record's identity for comparison: type, name and value, without the Cloudflare id. */
export const recordKey = record => `${record.type}|${record.name}|${record.content}`;

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
 * What must go, given what the zone holds and what it should hold.
 *
 * Cloudflare imports a zone's existing records when it is added, so the forwarder's address and the
 * wildcard arrive with it — and a zone holding both those and GitHub's addresses answers from
 * whichever it likes. So the old web records at the three names this site owns are removed.
 *
 * Narrow on purpose: only A/AAAA/CNAME, only `@`, `www`, `links` and `*`. Mail is not web, and a
 * TXT record somebody added to verify a service is not this script's to judge.
 */
export const obsoleteWebRecords = (current, desired) => {
  const wanted = new Set(desired.map(recordKey));
  const owned = new Set([HOST, `www.${HOST}`, `links.${HOST}`]);
  const web = new Set(['A', 'AAAA', 'CNAME']);
  return current.filter(record => web.has(record.type)
    && (owned.has(record.name) || record.name === `*.${HOST}`)
    && !wanted.has(recordKey(record)));
};
