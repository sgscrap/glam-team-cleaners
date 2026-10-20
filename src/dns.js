/**
 * The DNS this site needs, written down once — as a zone file the repo can show.
 *
 * The site publishes `site.url` as its canonical host in four places a crawler reads, and nothing
 * in a build can check that the host answers. `npm run domain` asks that question, but its answer
 * lives in a terminal; this module is the other half: the records the domain should hold, emitted
 * as a file so the change at the provider is a copy-paste rather than a transcription from a
 * comment in a script.
 *
 * One owner for the addresses. `verify-domain.js` imports them from here instead of restating
 * them, and `test/dns.test.js` pins them to the values GitHub documents, so a wrong address cannot
 * be wrong consistently in both the file and the check.
 *
 * The zone below is the *site's* records only. The domain also carries email — MX, SPF, DMARC and
 * DKIM — and a provider that replaces the whole zone with this file would take the mailbox down
 * with it. That is why the header says so, in the file, where someone about to paste it will read
 * it.
 */
import { site } from './data.js';

/** The host every canonical names, read from the one place it is written. */
export const HOST = new URL(site.url).hostname;

/** Where the repository itself publishes. Attaching a custom domain replaces it as the address,
    and GitHub then redirects from it to the domain. */
export const PAGES_DOMAIN = 'sgscrap.github.io';

/**
 * The short address for the link page. One label under the site, so a bio can hold it — and not a
 * second copy of the page: a redirect rule at the edge turns it into a 301 to the canonical page,
 * and the record below only makes the name resolvable (and proxied, so Cloudflare terminates TLS
 * for it and can apply the rule at all).
 */
export const LINK_HOST = `links.${HOST}`;

/**
 * GitHub Pages' own addresses for an apex domain, from "Managing a custom domain for your GitHub
 * Pages site". Spelled as data rather than discovered: they are what the records must contain.
 */
export const PAGES_A = [
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
];

/** The same four over IPv6. Optional at GitHub, included because the panel accepts them. */
export const PAGES_AAAA = [
  '2606:50c0:8000::153',
  '2606:50c0:8001::153',
  '2606:50c0:8002::153',
  '2606:50c0:8003::153',
];

/** Where the file is published in the repository. Not part of the site: this never ships. */
export const ZONE_FILE = `dns/${HOST}.zone`;

/**
 * The email the domain carries, as it answered on the day this was written. Values, not a
 * prescription: they are printed in the file so nobody replaces the zone without seeing what else
 * is in it, and the note beside them says where to read the real ones from.
 *
 * Exported because the date is part of the claim: `npm run domain` answers for these values against
 * the live zone, and a mail record that answers differently is a provider change since that day
 * rather than a fault — which it can only say by naming the day.
 */
export const MAIL_OBSERVED_ON = '2026-10-17';

/**
 * The mail records as values rather than as lines of text, because two renderings need them: the
 * zone file's comment block, which is what someone pastes, and the runbook's target-state table,
 * which is what someone checks the pasted result against. Written twice as lines, the two could
 * disagree in a value or a quote and nothing would notice until mail stopped.
 */
export const MAIL_RECORDS = [
  { type: 'MX', name: '@', value: '10 mailserver.businessidentity.llc' },
  { type: 'TXT', name: '@', value: 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all' },
  { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; ruf=mailto:bounce@dmarc.businessidentity.llc; fo=1' },
];

/**
 * The site's records, the shape both the zone file and the runbook table are rendered from. One
 * list, so the file someone pastes and the table they check it against cannot say different things.
 */
export const SITE_RECORDS = () => [
  ...PAGES_A.map(content => ({ type: 'A', name: '@', content })),
  ...PAGES_AAAA.map(content => ({ type: 'AAAA', name: '@', content })),
  // No trailing dot: this is the value the API takes and the table shows. The zone file adds the
  // dot, because a CNAME target there is a name and `sgscrap.github.io` without one would be read
  // as relative to the zone.
  { type: 'CNAME', name: 'www', content: PAGES_DOMAIN },
  { type: 'CNAME', name: 'links', content: PAGES_DOMAIN },
];

/** `@       IN  A      185.199.108.153` — the columns the zone file has always used. */
const zoneLine = ({ name, type, content }) => `${name.padEnd(8)}IN  ${type.padEnd(7)}${type === 'CNAME' ? `${content}.` : content}`;

/** `TXT    _dmarc "…"` — the same columns, with TXT quoted and MX's owner left off. */
const zoneMailLine = ({ type, name, value }) => (type === 'MX'
  ? `${type.padEnd(7)}${value}`
  : `${type.padEnd(7)}${name === '@' ? '' : `${name} `}"${value}"`);

/**
 * The zone file. Records only — no SOA and no NS: whoever hosts the zone owns those, and a file
 * that invented them would be wrong for every provider it was pasted into.
 */
export const zoneFile = () => {
  const records = SITE_RECORDS().map(zoneLine);

  return `; ==========================================================================
; ${HOST} — the records this site needs at the business's own domain
;
; Generated by src/build.js from src/dns.js. Do not edit this file.
;
; The panel edit, in order:
;   1. Replace the A record that points elsewhere with the four below.
;   2. Point www and links at the Pages default domain, as the two CNAMEs below.
;   3. Delete the URL forward, and any wildcard record.
;   4. Attach ${HOST} to the repository once DNS answers:
;        gh api -X PUT repos/sgscrap/glam-team-cleaners/pages \\
;          -f cname=${HOST}
;
; Why the forward has to go: it rewrites every path to one address, so
; /links/ arrives at the homepage and every canonical on the site names a URL
; that immediately redirects away from itself.
;
; Why the wildcard has to go: *.${HOST} currently resolves (to the same
; forwarder), which means every subdomain already "works" and none of them
; serves the site. GitHub's own guidance is not to use a wildcard at all.
;
; The links record is not a second site. It is proxied so Cloudflare sees the
; name at all, and the redirect rule answers every request for it with a 301 to
; /links/ before the origin is reached; the wildcard is exactly what would keep
; it answering with the forwarder's homepage instead.
;
; This file is the site's records only. The domain also carries email, and a
; provider that takes this file as the whole zone would stop it:
;
${MAIL_RECORDS.map(record => `;   ${zoneMailLine(record)}`).join('\n')}
;
;   No DKIM key is published under this domain: 153 conventional selector
;   names (<selector>._domainkey.${HOST}) answered with no TXT, observed
;   ${MAIL_OBSERVED_ON}. Nothing to copy, and nothing that can verify a
;   signature under this domain. If the panel names a selector, read it with
;   npm run dkim -- --selector <name> — the move writes any key it finds.
;
; The whole sequence, in order, with the commands and the rollback: DOMAIN.md
; in the repository root.
; ==========================================================================

$ORIGIN ${HOST}.
$TTL 3600

; GitHub Pages, apex. GitHub's four addresses, and the same four over IPv6.
${records.join('\n')}
`;
};
