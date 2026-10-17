/**
 * The records the zone needs once it lives at Cloudflare, built from the same values the site
 * publishes and the mail records the domain answers with today.
 *
 * Kept apart from scripts/dns-cloudflare.js so the mapping can be tested without a token, a
 * network, or the chance of writing to a real zone: the script is the only thing that talks to
 * the API, and everything it decides is decided here.
 */
import { HOST, PAGES_A, PAGES_AAAA, PAGES_DOMAIN } from './dns.js';

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
