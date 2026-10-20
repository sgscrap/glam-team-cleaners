/**
 * The alias, held to the four forms it owes and to the certificate that has to sit in front of them.
 *
 * Every assertion here is about a value, not a request: the live zone does not exist yet, and when
 * it does, a test suite that reached the internet would fail for whichever laptop was offline. So
 * `scripts/verify-domain.js` does the fetching and this pins the judgement it applies to what came
 * back — including the failure directions, which are the ones that matter: a 302 that looks like a
 * working link, a 301 that quietly drops the query string, and a certificate error that a terminal
 * would otherwise report as "the request failed".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasForms, redirectVerdict, tlsVerdict } from '../src/alias.js';
import { HOST, LINK_HOST } from '../src/dns.js';
import { LINKS_URL } from '../src/links.js';

const forms = aliasForms();
const byName = name => forms.find(form => form.form === name);

test('the alias is asked in each form a visitor can arrive on', () => {
  assert.equal(forms.length, 4, 'one sample would let a rule that only handles a path sneak through');
  assert.equal(forms[0].form, 'no path', 'the bare name is the one a bio link contains');
  assert.equal(byName('no path').url, `https://${LINK_HOST}`, 'no trailing slash: the form the rule must not depend on');
  assert.equal(byName('trailing slash').url, `https://${LINK_HOST}/`, 'the form a browser adds when the bare name is pasted');
  assert.equal(byName('path dropped').url, `https://${LINK_HOST}/promo`);
  assert.equal(new Set(forms.map(form => form.url)).size, forms.length, 'each form is a different request');
});

test('every form lands on the www-less canonical page', () => {
  for (const form of forms) {
    assert.ok(form.expected.startsWith(LINKS_URL), `${form.form} must reach ${LINKS_URL} and nothing beside it`);
  }
  for (const form of forms.filter(form => form.form !== 'query kept')) {
    assert.equal(form.expected, LINKS_URL, `${form.form} must reach the one address exactly`);
  }
  assert.equal(LINKS_URL, `https://${HOST}/links/`);
  assert.ok(!new URL(LINKS_URL).hostname.startsWith('www.'), 'the target is the www-less name, not a second address');
});

test('a query string rides along, and nothing else of the request does', () => {
  const tagged = byName('query kept');
  assert.equal(tagged.expected, `${LINKS_URL}?utm_source=bio&utm_medium=social`, 'preserve_query_string keeps the tag a bio carries');
  assert.equal(byName('path dropped').expected, LINKS_URL, 'a deeper path is replaced, not appended to a page that does not exist');
});

test('a permanent 301 to the one address is the only pass', () => {
  const pass = redirectVerdict(LINKS_URL, { status: 301, location: LINKS_URL });
  assert.deepEqual(pass, { ok: true, text: `301 ${LINKS_URL}` });

  const temporary = redirectVerdict(LINKS_URL, { status: 302, location: LINKS_URL });
  assert.equal(temporary.ok, false);
  assert.match(temporary.why, /temporary/, 'a 302 leaves both addresses indexed');

  const elsewhere = redirectVerdict(LINKS_URL, { status: 301, location: 'https://glamcleaners.net/' });
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.why, /glamcleaners\.net\/links\//, 'the reason names the address it should have used');

  const noDestination = redirectVerdict(LINKS_URL, { status: 301 });
  assert.equal(noDestination.ok, false);
});

test('a redirect that drops the query string fails the tagged form', () => {
  const tagged = byName('query kept');
  const verdict = redirectVerdict(tagged.expected, { status: 301, location: LINKS_URL });
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /utm_source=bio/, 'the missing tag is named, because that is the lost attribution');
});

test('serving the page is not a redirect, and bytes that are not HTTP are their own answer', () => {
  assert.match(
    redirectVerdict(LINKS_URL, { status: 200, location: undefined }).why,
    /serves a page/,
    'a page answering is the state before the rule exists, not a missing page',
  );
  assert.match(
    redirectVerdict(LINKS_URL, { status: 404 }).why,
    /404/,
    'a status other than the owed 301 is reported as what it was',
  );
  assert.match(
    redirectVerdict(LINKS_URL, { status: Number.NaN }).why,
    /not an HTTP response/,
    'the forwarder answers with bytes no HTTP client will parse, and that is what should be said',
  );
});

test('a trusted certificate is reported, and a warning is called a warning', () => {
  const later = new Date(Date.now() + 90 * 86_400_000).toUTCString();
  const good = tlsVerdict({ certificate: { valid_to: later, issuer: { O: 'Google Trust Services' } } });
  assert.equal(good.ok, true);
  assert.match(good.text, /Google Trust Services/);
  assert.match(good.text, /day\(s\) left/);

  const untrusted = tlsVerdict({ error: Object.assign(new Error('unable to verify'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
  assert.equal(untrusted.ok, false);
  assert.match(untrusted.why, /browser shows a warning/, 'an untrusted chain is a red padlock, not a missing page');

  const wrongName = tlsVerdict({ error: Object.assign(new Error('altname'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) });
  assert.match(wrongName.why, /browser shows a warning/);

  const offline = tlsVerdict({ error: Object.assign(new Error('no such host'), { code: 'ENOTFOUND' }) });
  assert.equal(offline.ok, false);
  assert.doesNotMatch(offline.why, /certificate/, 'a name that does not resolve is not a certificate fault');

  const expired = tlsVerdict({ certificate: { valid_to: new Date(Date.now() - 3 * 86_400_000).toUTCString(), issuer: { O: 'X' } } });
  assert.equal(expired.ok, false);
  assert.match(expired.why, /expired 3 day\(s\) ago/);

  assert.equal(tlsVerdict({}).ok, false, 'no handshake, no certificate, no pass');
});
