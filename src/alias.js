/**
 * What the alias must do once its record is proxied, and how to say whether it does.
 *
 * `links.glamcleaners.net` and `/links/` served the same page, separated only by a canonical tag.
 * The Cloudflare rule in `src/cloudflare.js` replaces that with one 301 to the canonical page, and
 * this module holds the forms that rule has to answer — not one sample request, because each form
 * fails differently and only one of them is about the destination:
 *
 *   - the bare name, with no path and no trailing slash, is what someone types or what a bio link
 *     contains;
 *   - the trailing slash is what a browser adds when the bare name is pasted into the address bar,
 *     and a redirect rule written against the path rather than the host would miss one of the two;
 *   - a query string is how a tagged link reports where it came from, and it is the only part of
 *     the request the rule has to carry rather than replace;
 *   - a deeper path has to be dropped, because the target is one page: a rule that carried the path
 *     through would send `/promo` to `/links/promo`, which does not exist.
 *
 * The comparison is exact, and against `LINKS_URL` — the address the two copies already name as
 * canonical. A 302 is not a pass: it tells a crawler the move is temporary, so both addresses stay
 * indexed. A redirect that lands anywhere else, including a hop that would itself redirect, is not
 * a pass either.
 *
 * No network here: `scripts/verify-domain.js` does the requests and hands the answers in, so every
 * decision below is a value a test can pin without a zone, a certificate, or a DNS record.
 */
import { LINK_HOST } from './dns.js';
import { LINKS_URL } from './links.js';

/** A tagged link, as a bio would carry it: the query is the only part that must survive. */
const TAGGED = 'utm_source=bio&utm_medium=social';

/**
 * Every form a visitor can arrive on, in the order they are reported, with the exact `Location`
 * the 301 must carry. The bare name first, because that is the one that matters most.
 */
export const aliasForms = () => [
  { form: 'no path', url: `https://${LINK_HOST}`, expected: LINKS_URL },
  { form: 'trailing slash', url: `https://${LINK_HOST}/`, expected: LINKS_URL },
  { form: 'query kept', url: `https://${LINK_HOST}/?${TAGGED}`, expected: `${LINKS_URL}?${TAGGED}` },
  { form: 'path dropped', url: `https://${LINK_HOST}/promo`, expected: LINKS_URL },
];

/**
 * Whether a response is the redirect the alias owes, with the reason it is not when it is not.
 *
 * `status` is NaN when the bytes were not an HTTP response at all — the provider answering this
 * domain today does exactly that, and "the request failed" would be a worse description of it
 * than saying what arrived.
 */
export const redirectVerdict = (expected, { status, location } = {}) => {
  if (!Number.isFinite(status)) {
    return { ok: false, why: 'the host answered with bytes that are not an HTTP response at all' };
  }
  if (status === 200) {
    return { ok: false, why: 'it serves a page instead of redirecting, so the second copy is still reachable' };
  }
  if (status !== 301) {
    return {
      ok: false,
      why: status >= 300 && status < 400
        ? `${status} is temporary: a crawler keeps both addresses indexed`
        : `it answered ${status}, and the alias owes a 301`,
    };
  }
  if (location !== expected) {
    return { ok: false, why: `the 301 goes to ${location ?? 'nowhere'}, and the one address is ${expected}` };
  }
  return { ok: true, text: `301 ${location}` };
};

/**
 * Days until the date a peer reports, truncated so it reads the same either side of zero: a
 * certificate that ran out three days ago says three, not four — flooring the negative would round
 * away from zero and overstate how long it has been broken.
 */
const daysLeft = validTo => Math.trunc((Date.parse(validTo) - Date.now()) / 86_400_000);

/**
 * Whether a browser would show a warning, from the outcome of a TLS connection that verified the
 * chain and the name itself (`rejectUnauthorized`, on by default).
 *
 * The interesting line is the failure: a certificate that does not cover the name, an incomplete
 * chain, or a name Cloudflare never issued for all arrive as an error before any HTTP exists, and
 * each one is a red padlock rather than a missing page. So they are named as that, not as "the
 * request failed". `ENOTFOUND` and `ECONNREFUSED` are not certificate faults and are not called
 * one.
 */
export const tlsVerdict = ({ error, certificate } = {}) => {
  if (error) {
    const code = error.code ?? '';
    const aboutCertificate = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|HOSTNAME|SSL|TLS/i.test(code)
      || /certificate/i.test(error.message ?? '');
    return {
      ok: false,
      why: aboutCertificate
        ? `the certificate is not trusted, so a browser shows a warning (${code || error.message})`
        : `the TLS handshake failed (${code || error.message})`,
    };
  }
  if (!certificate || !certificate.valid_to) {
    return { ok: false, why: 'the connection was not made over TLS, so there is no certificate to trust' };
  }

  const left = daysLeft(certificate.valid_to);
  if (!Number.isFinite(left)) {
    return { ok: false, why: `the certificate's expiry cannot be read (${certificate.valid_to})` };
  }
  if (left < 0) {
    return { ok: false, why: `the certificate expired ${-left} day(s) ago` };
  }

  const issuer = certificate.issuer?.O ?? certificate.issuer?.CN ?? 'an unnamed issuer';
  return { ok: true, text: `trusted certificate from ${issuer}, ${left} day(s) left` };
};
