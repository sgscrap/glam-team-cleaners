/**
 * A DKIM signature, checked rather than believed.
 *
 * Three kinds of evidence, and the difference between them is why this file is long:
 *
 *   - **Published vectors.** The body canonicalization examples are RFC 6376 §3.4.5's, down to the
 *     space before the CRLF: `simple` keeps every byte, `relaxed` strips whitespace at the end of a
 *     line and collapses a run of it inside one. A test that only round-tripped through this
 *     repository's own signer would pass just as happily on a canonicalization nobody else
 *     implements.
 *   - **A second implementation in the test.** The signer below is written from the spec, separately
 *     from `src/dkim-verify.js`, and uses the least clever code that could be right.
 *   - **The failures that matter.** A body altered after signing, a signature that is not the one
 *     published, an expired signature, a `h=` naming a header that is not there, a length-limited
 *     signature whose tail was edited. Each is checked to fail, because a verifier that says yes
 *     too often is worse than none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signWith } from 'node:crypto';
import {
  canonicalBody,
  canonicalHeader,
  splitMessage,
  verifyMessage,
  withoutSignatureValue,
} from '../src/dkim-verify.js';

/* --- the published examples ---------------------------------------------- */

// RFC 6376 §3.4.5, the bracketed notation expanded: a leading space on the first line, a run of
// space-tab-space inside the second, and two empty lines at the end.
const EXAMPLE_BODY = ' C \r\nD \t E\r\n\r\n\r\n';

test('relaxed body canonicalization is the algorithm the RFC examples describe', () => {
  assert.equal(canonicalBody('relaxed', EXAMPLE_BODY), ' C\r\nD E\r\n');
});

test('simple body canonicalization keeps every byte and only drops the empty tail', () => {
  assert.equal(canonicalBody('simple', EXAMPLE_BODY), ' C \r\nD \t E\r\n');
});

test('an empty body differs by algorithm, which the RFC prints the hashes of', () => {
  // §3.4.3: `simple` canonicalizes an empty or missing body to a single CRLF, two octets.
  assert.equal(canonicalBody('simple', ''), '\r\n');
  assert.equal(canonicalBody('simple', '\r\n\r\n'), '\r\n', 'a body of nothing but empty lines is the same thing');
  // §3.4.4: `relaxed` leaves it as the null input, and publishes the hash that must result.
  assert.equal(canonicalBody('relaxed', ''), '');
  assert.equal(
    createHash('sha256').update(Buffer.from(canonicalBody('relaxed', ''), 'latin1')).digest('base64'),
    '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    'the SHA-256 value the RFC prints for a relaxed empty body',
  );
  assert.equal(
    createHash('sha1').update(Buffer.from(canonicalBody('relaxed', ''), 'latin1')).digest('base64'),
    '2jmj7l5rSw0yVb/vlWAYkK/YBwk=',
    'and the SHA-1 value from the same paragraph',
  );
});

test('a body without a final CRLF gets one, and trailing whitespace goes only in relaxed', () => {
  assert.equal(canonicalBody('simple', 'hello'), 'hello\r\n');
  assert.equal(canonicalBody('relaxed', 'hello\r\n\r\n\r\n'), 'hello\r\n', 'empty lines at the end are not content');
  assert.equal(canonicalBody('relaxed', 'hello   \r\n'), 'hello\r\n');
});

test('relaxed header canonicalization lower-cases the name and rewrites the whitespace', () => {
  assert.equal(
    canonicalHeader('relaxed', 'SUBJECT:  a   b\r\n\tc  '),
    'subject:a b c\r\n',
    'name lowercased, folded continuation unfolded, runs of whitespace collapsed, ends trimmed',
  );
  assert.equal(
    canonicalHeader('simple', 'SUBJECT:  a   b\r\n\tc'),
    'SUBJECT:  a   b\r\n\tc\r\n',
    'simple changes nothing but the terminator',
  );
});

test('the one header a signer cannot sign is hashed with its value removed', () => {
  const raw = 'DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=default;\r\n\tbh=YWJj; b=WFla';
  const stripped = withoutSignatureValue(raw);

  assert.match(stripped, /b=$/, 'the signature value is gone and the tag is left empty');
  assert.match(stripped, /bh=YWJj/, 'and the body hash, a different tag, is untouched');
});

/* --- a message, signed here and verified there --------------------------- */

const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RECORD = `v=DKIM1; k=rsa; p=${KEY.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`;

const b64 = (value, hash) => createHash(hash).update(Buffer.from(value, 'latin1')).digest('base64');

/** RFC 6376 §3.4, written again here so the module's own canonicalizers are not the only ones. */
const testCanonicalHeader = raw => {
  const at = raw.indexOf(':');
  const name = raw.slice(0, at).trim().toLowerCase();
  const value = raw.slice(at + 1)
    .split('\r\n').join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return `${name}:${value}\r\n`;
};

/** The signature header is the one field hashed without its trailing CRLF (RFC 6376 §3.7). */
const testCanonicalSignature = raw => testCanonicalHeader(raw).replace(/[\r\n \t]+$/, '');

const testCanonicalBody = body => {
  const lines = body.split('\r\n').map(line => line.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `${lines.join('\r\n')}\r\n` : '\r\n';
};

const HEADERS = [
  'From: Someone <hello@example.com>',
  'To: someone@elsewhere.test',
  'Subject: A short one',
  'Date: Tue, 14 Nov 2023 22:13:20 +0000',
];

/**
 * A message signed the long way: canonicalize the body, hash it, canonicalize the named headers and
 * the signature header with an empty `b=`, sign that, then write `b=` in. `l=` and the algorithm are
 * parameters so the length-limited and RSA-SHA1 cases can be built the way a real signer builds them.
 */
const signed = ({ body = 'Hello, world.\r\n', d = 'example.com', s = 'default', a = 'rsa-sha256', l = null, h = 'from:to:subject:date', now = 1700000000, x = null, headers = HEADERS } = {}) => {
  const canonical = testCanonicalBody(body);
  const bh = b64(l === null ? canonical : canonical.slice(0, l), a === 'rsa-sha1' ? 'sha1' : 'sha256');

  const tags = [
    'v=1',
    `a=${a}`,
    'c=relaxed/relaxed',
    `d=${d}`,
    `s=${s}`,
    `t=${now}`,
    x ? `x=${x}` : null,
    l === null ? null : `l=${l}`,
    `h=${h}`,
    `bh=${bh}`,
  ].filter(Boolean).join('; ');

  // Folded, the way real signatures arrive: the signing input has to survive the fold in both
  // implementations for this to mean anything.
  const raw = `DKIM-Signature: ${tags};\r\n b=`;
  const input = [...headers.map(testCanonicalHeader), testCanonicalSignature(raw)].join('');
  const signature = signWith(a === 'rsa-sha1' ? 'sha1' : 'sha256', Buffer.from(input, 'latin1'), KEY.privateKey)
    .toString('base64');

  return {
    signature,
    bh,
    prefix: `${headers.join('\r\n')}\r\n`,
    signatureHeader: `${raw}${signature}`,
    message: `${headers.join('\r\n')}\r\n${raw}${signature}\r\n\r\n${body}`,
  };
};

const lookup = () => RECORD;

test('a message this repository signs verifies, with the body hash and the signature both checked', () => {
  const { message, signature } = signed({});
  const result = verifyMessage(message, { keyFor: lookup });

  assert.equal(result.signatures.length, 1);
  const [verified] = result.signatures;
  assert.equal(verified.bodyHash, 'pass', `expected the recomputed body hash to match bh=: ${verified.problems.join('; ')}`);
  assert.equal(verified.signature, 'pass', `expected the signature to verify: ${verified.problems.join('; ')}`);
  assert.equal(verified.verified, true);
  assert.equal(verified.d, 'example.com');
  assert.equal(verified.s, 'default');
  assert.equal(verified.c, 'relaxed/relaxed');
  assert.equal(verified.key.bits, 2048, 'the key size is read from the key that verified it');
  assert.match(verified.key.name, /^default\._domainkey\.example\.com$/);
  assert.equal(result.verified, true);
  assert.deepEqual(result.failed, []);
  assert.ok(signature.length > 300, 'the fixture really carries a signature');
});

test('a body changed after signing fails the body hash, not the signature', () => {
  const { message } = signed({});
  const tampered = message.replace('Hello, world.', 'Hello, w0rld.');
  const [result] = verifyMessage(tampered, { keyFor: lookup }).signatures;

  assert.equal(result.bodyHash, 'fail');
  assert.equal(
    result.signature,
    'pass',
    'the two halves are checked separately: the headers are exactly as signed, and it is the body that was changed',
  );
  assert.equal(result.verified, false, 'and a pass on one half is not a verification of the message');
  assert.match(result.problems.join(' '), /body hash does not match bh=/);
});

test('a signature that is not the one that was made does not verify', () => {
  const { message, signature } = signed({});
  const flipped = `${signature.slice(0, 8)}${signature[8] === 'A' ? 'B' : 'A'}${signature.slice(9)}`;
  const [result] = verifyMessage(message.replace(signature, flipped), { keyFor: lookup }).signatures;

  assert.equal(result.bodyHash, 'pass', 'the body is untouched, so only the signature half can fail');
  assert.equal(result.signature, 'fail');
  assert.equal(result.verified, false);
  assert.match(result.problems.join(' '), /signature does not verify against the published key/);
});

test('a signature checked against the wrong published key does not verify', () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherRecord = `v=DKIM1; k=rsa; p=${other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`;
  const [result] = verifyMessage(signed({}).message, { keyFor: () => otherRecord }).signatures;

  assert.equal(result.signature, 'fail');
  assert.equal(result.verified, false);
});

test('with no key published, nothing is claimed either way', () => {
  const [result] = verifyMessage(signed({}).message, { keyFor: () => null }).signatures;

  assert.equal(result.signature, 'skipped');
  assert.equal(result.bodyHash, 'pass', 'the body hash needs no key');
  assert.equal(result.verified, false, 'half a check is not a verification');
  assert.match(result.notes.join(' '), /no key is published at default\._domainkey\.example\.com/);
  assert.deepEqual(result.problems, [], 'a missing key is a limitation, not a failure of the message');
});

test('a header the signature names but the message does not have contributes nothing', () => {
  const { message } = signed({ h: 'from:to:subject:date:cc' });
  const [result] = verifyMessage(message, { keyFor: lookup }).signatures;

  // RFC 6376 §3.5: "nonexistent header fields do not contribute to the signature computation".
  // dkimpy signs exactly this shape on every message (it lists `from` twice), so a verifier that
  // failed here would fail most real mail.
  assert.equal(result.verified, true, result.problems.join('; '));
  assert.match(result.notes.join(' '), /h= names cc, which this message does not have/);
  assert.deepEqual(result.problems, []);
});

test('a signed header that was added after signing changes the hash and fails', () => {
  const { prefix, signatureHeader, message } = signed({ h: 'from:to:subject:date:cc' });
  // The signer covered `cc` while it was absent; adding one is what that protects against.
  const withCc = `${prefix}Cc: someone@example.org\r\n${signatureHeader}\r\n\r\nHello, world.\r\n`;

  const [result] = verifyMessage(withCc, { keyFor: lookup }).signatures;
  assert.equal(result.signature, 'fail', 'the added field is signed, so its arrival breaks the signature');
  assert.equal(result.verified, false);
  assert.notEqual(withCc, message, 'the two copies really differ');
});

test('an expired signature is reported with the date it expired', () => {
  const { message } = signed({ now: 1600000000, x: 1610000000 });
  const [result] = verifyMessage(message, { keyFor: lookup }).signatures;

  assert.equal(result.verified, false);
  assert.match(result.problems.join(' '), /expired on 2021-01-07/);
  assert.equal(result.signature, 'pass', 'the arithmetic still holds; the signature is simply no longer valid');
});

test('an algorithm this does not implement is refused rather than assumed', () => {
  const [result] = verifyMessage(signed({ a: 'rsa-md5' }).message, { keyFor: lookup }).signatures;

  assert.equal(result.verified, false);
  assert.equal(result.signature, 'skipped');
  assert.match(result.problems.join(' '), /a=rsa-md5 is not a signature algorithm this knows/);
});

test('rsa-sha1 with simple canonicalization verifies, since old mail is still signed that way', () => {
  const body = 'Hello, world.\r\n';
  const header = `DKIM-Signature: v=1; a=rsa-sha1; c=simple/simple; d=example.com; s=default; h=${'from:to:subject:date'}; bh=${b64(body, 'sha1')}; b=`;
  // simple canonicalization is the bytes as written, minus the trailing CRLF on the signature
  // header itself — which is the whole reason this line is not just `${header}\r\n`.
  const input = `${HEADERS.map(line => `${line}\r\n`).join('')}${header}`;
  const signature = signWith('sha1', Buffer.from(input, 'latin1'), KEY.privateKey).toString('base64');
  const message = `${HEADERS.join('\r\n')}\r\n${header}${signature}\r\n\r\n${body}`;

  const [result] = verifyMessage(message, { keyFor: lookup }).signatures;
  assert.equal(result.signature, 'pass', result.problems.join('; '));
  assert.equal(result.bodyHash, 'pass');
  assert.equal(result.c, 'simple/simple');
});

test('an Ed25519 signature verifies against its raw 32-byte key', () => {
  const ed = generateKeyPairSync('ed25519');
  const raw = ed.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const record = `v=DKIM1; k=ed25519; p=${raw.toString('base64')}`;

  const body = 'Hello, world.\r\n';
  const header = `DKIM-Signature: v=1; a=ed25519-sha256; c=relaxed/relaxed; d=example.com; s=ed; h=from:to:subject:date; bh=${b64(testCanonicalBody(body), 'sha256')}; b=`;
  const input = [...HEADERS.map(testCanonicalHeader), testCanonicalSignature(header)].join('');
  const signature = signWith(null, Buffer.from(input, 'latin1'), ed.privateKey).toString('base64');
  const message = `${HEADERS.join('\r\n')}\r\n${header}${signature}\r\n\r\n${body}`;

  const [result] = verifyMessage(message, { keyFor: () => record }).signatures;
  assert.equal(result.signature, 'pass', result.problems.join('; '));
  assert.equal(result.verified, true);
  assert.equal(result.key.bits, null, 'an Ed25519 key has no modulus to report');
});

test('a message with no body is not verified against an empty one', () => {
  const { message } = signed({});
  const headersOnly = message.slice(0, message.indexOf('\r\n\r\n'));
  const result = verifyMessage(headersOnly, { keyFor: lookup });

  assert.equal(result.bodyPresent, false);
  assert.equal(result.signatures[0].bodyHash, 'skipped');
  assert.equal(result.signatures[0].verified, false);
  assert.match(result.signatures[0].notes.join(' '), /has no body/);
});

test('a copy that lost its CRLFs still verifies, and says what it assumed', () => {
  const [result] = verifyMessage(signed({}).message.replace(/\r\n/g, '\n'), { keyFor: lookup }).signatures;

  assert.equal(result.verified, true, 'a paste through an editor is the common case; CRLF is restored before hashing');
  assert.match(result.notes.join(' '), /bare LF line endings/);
});

test('a length-limited signature still verifies after the tail is edited', () => {
  const body = 'Signed part.\r\nUnsigned tail.\r\n';
  const { message } = signed({ body, l: 'Signed part.\r\n'.length });
  const edited = message.replace('Unsigned tail.', 'Completely different.');

  const [result] = verifyMessage(edited, { keyFor: lookup }).signatures;
  assert.equal(result.verified, true, 'l= signs a prefix, which is exactly why the tail may change');
  assert.match(result.notes.join(' '), /l=14 covers 14 of \d+ octets — anything after that is unsigned/);
});

test('two signatures are checked one at a time, so one with no key does not hide behind a good one', () => {
  const first = signed({});
  const second = signed({ s: 'other' });
  const message = `${first.prefix}${first.signatureHeader}\r\n${second.signatureHeader}\r\n\r\nHello, world.\r\n`;

  const result = verifyMessage(message, { keyFor: (domain, selector) => (selector === 'other' ? null : RECORD) });
  assert.equal(result.signatures.length, 2, 'both signature headers are read');
  assert.equal(result.signatures[0].verified, true, 'the one with a published key verifies');
  assert.equal(result.signatures[1].verified, false, 'and the one with no key is not counted as verified');
  assert.equal(result.verified, true);
  assert.deepEqual(result.failed, [], 'a key that is not published is a limitation, not a failed signature');
});

test('the split finds the body at the first empty line and keeps folded headers whole', () => {
  const split = splitMessage('A: 1\r\n B\r\nC: 2\r\n\r\nbody: not a header\r\n');

  assert.deepEqual(split.fields.map(field => field.name), ['A', 'C']);
  assert.equal(split.fields[0].raw, 'A: 1\r\n B', 'a continuation line is part of the field it continues');
  assert.equal(split.body, 'body: not a header\r\n');
  assert.equal(split.complete, true);

  const headersOnly = splitMessage('A: 1\r\nC: 2\r\n');
  assert.equal(headersOnly.body, null, 'no blank line means no body, which is not the same as an empty one');
  assert.equal(headersOnly.complete, false);
});
