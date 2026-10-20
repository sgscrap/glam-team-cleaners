/**
 * A message header, read for what it can actually prove.
 *
 * The distinction the tests enforce is the one that matters after a mail migration: a
 * `DKIM-Signature` is the sender's claim, `Authentication-Results` is the receiver's verdict, and
 * DMARC alignment is neither — it is arithmetic on the two. A tool that blurred them would report
 * "signed" as "authenticated", which is exactly the false confidence this is meant to remove.
 *
 * The samples are synthetic, shaped like Gmail's and like a provider that signs with its own domain
 * instead of the customer's. No network: key lookup is exercised in test/dkim.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignment,
  dmarcVerdict,
  inspectHeaders,
  organizationalDomain,
  parseAddress,
  parseAuthenticationResults,
  parseDkimSignature,
  parseHeaders,
  parseMailArgs,
  parseReceivedSpf,
} from '../src/mail.js';

const alignedMessage = `From: Glam Team <hello@glamcleaners.net>
To: someone@example.com
Subject: Your clean
Return-Path: <bounce@glamcleaners.net>
Received-SPF: pass (google.com: domain of bounce@glamcleaners.net designates 66.223.49.91 as permitted sender) client-ip=66.223.49.91;
Authentication-Results: mx.google.com;
       dkim=pass header.i=@glamcleaners.net header.s=default header.b=XyZ;
       spf=pass (google.com: domain of bounce@glamcleaners.net designates 66.223.49.91 as permitted sender) smtp.mailfrom=bounce@glamcleaners.net;
       dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=glamcleaners.net
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
        d=glamcleaners.net; s=default;
        t=1697500000; h=from:to:subject;
        bh=YWJj; b=ZGVm

This is the body: it has a colon and must not become a header.
`;

const thirdPartyMessage = `From: hello@glamcleaners.net
Return-Path: <bounce@businessidentity.llc>
Authentication-Results: mx.example.net;
       dkim=pass header.d=businessidentity.llc header.s=postal;
       spf=pass smtp.mailfrom=businessidentity.llc;
       dmarc=fail header.from=glamcleaners.net
DKIM-Signature: v=1; a=rsa-sha256; d=businessidentity.llc; s=postal; b=eA==`;

test('headers are unfolded, and a body that looks like a header is not one', () => {
  const { headers, body } = parseHeaders(alignedMessage);
  const names = headers.map(header => header.name);

  assert.ok(names.includes('DKIM-Signature'));
  assert.equal(body.trim(), 'This is the body: it has a colon and must not become a header.');

  const results = headers.find(header => header.name === 'Authentication-Results');
  assert.match(results.value, /dkim=pass header\.i=@glamcleaners\.net header\.s=default/);
  assert.doesNotMatch(results.value, /\n/, 'a folded header is one value');
});

test('an address carries the domain DMARC aligns on', () => {
  assert.deepEqual(parseAddress('Glam Team <hello@glamcleaners.net>'), {
    name: 'Glam Team',
    address: 'hello@glamcleaners.net',
    domain: 'glamcleaners.net',
  });
  assert.equal(parseAddress('<bounce@GLAMCLEANERS.NET>').domain, 'glamcleaners.net');
  assert.equal(parseAddress('<>'), null, 'an empty return path is not an address');
});

test('relaxed alignment compares organizational domains, strict compares the names', () => {
  assert.equal(organizationalDomain('mail.glamcleaners.net'), 'glamcleaners.net');
  assert.equal(organizationalDomain('glamcleaners.net'), 'glamcleaners.net');
  assert.equal(organizationalDomain('post.postal.co.uk'), 'postal.co.uk', 'a two-label suffix is not the suffix');

  assert.deepEqual(alignment('mail.glamcleaners.net', 'glamcleaners.net'), {
    strict: false,
    relaxed: true,
    organizational: 'glamcleaners.net',
  });
  assert.equal(alignment('businessidentity.llc', 'glamcleaners.net').relaxed, false);
});

test('a DKIM-Signature is reduced to the tags that identify it', () => {
  const signature = parseDkimSignature('v=1; a=rsa-sha256; d=GLAMCLEANERS.NET.; s=default; b=abc');
  assert.equal(signature.s, 'default');
  assert.equal(signature.d, 'glamcleaners.net');
  assert.equal(signature.a, 'rsa-sha256');
  assert.equal(signature.tags.b, 'abc', 'the signature value is kept but never printed');
});

test('a receiver result keeps each method, its verdict and its identifiers', () => {
  const parsed = parseAuthenticationResults(
    ' mx.google.com; dkim=pass header.i=@glamcleaners.net header.s=default; spf=pass smtp.mailfrom=bounce@glamcleaners.net; dmarc=pass (p=QUARANTINE dis=NONE) header.from=glamcleaners.net',
  );

  assert.equal(parsed.id, 'mx.google.com');
  assert.deepEqual(parsed.methods.map(method => `${method.method}=${method.result}`), [
    'dkim=pass',
    'spf=pass',
    'dmarc=pass',
  ]);
  assert.equal(parsed.methods[0].props['header.s'], 'default');
  assert.equal(parsed.methods[1].props['smtp.mailfrom'], 'bounce@glamcleaners.net');
  assert.equal(parsed.methods[2].props.p, 'QUARANTINE');
});

test('Received-SPF yields the verdict and the identity it checked', () => {
  const spf = parseReceivedSpf(
    'pass (google.com: domain of bounce@glamcleaners.net designates 66.223.49.91 as permitted sender) client-ip=66.223.49.91; envelope-from=bounce@glamcleaners.net;',
  );
  assert.equal(spf.result, 'pass');
  assert.equal(spf.mailfrom, 'bounce@glamcleaners.net');
  assert.equal(spf.clientIp, '66.223.49.91');
});

test('an aligned, reported DMARC pass is the proof', () => {
  const inspection = inspectHeaders(alignedMessage);
  assert.equal(inspection.fromDomain, 'glamcleaners.net');
  assert.equal(inspection.signatures.length, 1);
  assert.equal(inspection.signatures[0].s, 'default');
  assert.equal(inspection.signatures[0].d, 'glamcleaners.net');
  assert.equal(inspection.signatures[0].alignment.relaxed, true);

  assert.deepEqual(dmarcVerdict(inspection), {
    result: 'pass',
    policy: 'QUARANTINE',
    subdomainPolicy: 'QUARANTINE',
    source: 'reported by mx.google.com',
  });
});

test('a signature from the provider, aligned to nothing, is reported as a DMARC failure', () => {
  const inspection = inspectHeaders(thirdPartyMessage);
  assert.equal(inspection.dkimReports[0].domain, 'businessidentity.llc');
  assert.equal(inspection.dkimReports[0].result, 'pass');
  assert.equal(inspection.dkimReports[0].alignment.relaxed, false, 'a third-party signer passes DKIM and fails DMARC');
  assert.equal(inspection.spfAlignment.relaxed, false);

  assert.equal(dmarcVerdict(inspection).result, 'fail');
  assert.equal(dmarcVerdict(inspection).source, 'reported by mx.example.net');
});

test('a signature alone is not a verdict, and the tool does not pretend it is', () => {
  const inspection = inspectHeaders(
    'From: hello@glamcleaners.net\nDKIM-Signature: v=1; a=rsa-sha256; d=glamcleaners.net; s=default; b=eA==\n',
  );

  assert.equal(inspection.signatures[0].alignment.relaxed, true);
  assert.equal(inspection.hasVerdict, false, 'the sender signed it; nobody has said it passed');
  assert.equal(dmarcVerdict(inspection).result, null);
  assert.match(dmarcVerdict(inspection).source, /no aligned pass/);
});

test('SPF alignment is computed when the receiver reported SPF but not DMARC', () => {
  const inspection = inspectHeaders(
    'From: hello@glamcleaners.net\nReturn-Path: <bounce@glamcleaners.net>\n'
    + 'Received-SPF: pass (mx.example: domain of bounce@glamcleaners.net) envelope-from=bounce@glamcleaners.net; client-ip=66.223.49.91\n',
  );

  const verdict = dmarcVerdict(inspection);
  assert.equal(verdict.result, 'pass');
  assert.match(verdict.source, /computed from spf=pass/);
});

test('a --key value is not mistaken for the message to open', () => {
  // The bug this exists for: the script used to take the first argument that did not begin with a
  // dash as the file, which is the key record, and then failed to open it. Exposed by the piped
  // form — where there is no file argument at all — rather than by the file-first form.
  const key = 'default._domainkey.glamcleaners.net=v=DKIM1; k=rsa; p=AAAA';

  const piped = parseMailArgs(['--key', key]);
  assert.equal(piped.file, null, 'a piped message has no file argument, and the key is not one');
  assert.equal(piped.overrides.get('glamcleaners.net|default'), 'v=DKIM1; k=rsa; p=AAAA');

  const afterKey = parseMailArgs(['--key', key, 'delivered.eml']);
  assert.equal(afterKey.file, 'delivered.eml', 'the file is the argument after the value');

  const beforeKey = parseMailArgs(['delivered.eml', '--key', key]);
  assert.equal(beforeKey.file, 'delivered.eml', 'and the order does not matter');

  const equals = parseMailArgs([`--key=${key}`, 'delivered.eml']);
  assert.equal(equals.file, 'delivered.eml');
  assert.equal(equals.overrides.size, 1, 'the --key= form carries the same record');

  const unknown = parseMailArgs(['--verbose', 'delivered.eml']);
  assert.equal(unknown.file, 'delivered.eml', 'an unknown flag is ignored, not read as a message');

  assert.throws(() => parseMailArgs(['--key', 'not-a-record']), /--key takes <selector>\._domainkey\.<domain>=<TXT record>/);
  assert.throws(() => parseMailArgs(['--key']), /got \(nothing\)/, 'a missing value is a usage error, not a crash');
});

test('a signature verified locally is a DMARC pass with no receiver involved', () => {
  // What `npm run mail` produces when the paste includes the body: `src/dkim-verify.js` checked the
  // hash and the signature, so the pass is arithmetic rather than a header anybody could type.
  const inspection = inspectHeaders(
    'From: hello@glamcleaners.net\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=glamcleaners.net; s=default; h=from; bh=AA==; b=BB\n\nbody\n',
  );
  const verified = { ...inspection.signatures[0], verified: true, alignment: alignment('glamcleaners.net', 'glamcleaners.net') };

  const verdict = dmarcVerdict({ ...inspection, verifiedSignatures: [verified] });
  assert.equal(verdict.result, 'pass');
  assert.match(verdict.source, /computed from a DKIM signature verified here \(d=glamcleaners\.net\)/);
  assert.equal(verdict.policy, null, 'no policy was read: this says nothing about a receiver\'s DMARC record');
});

test('a verified signature that does not align, or did not verify, is not a pass', () => {
  const inspection = inspectHeaders(
    'From: hello@glamcleaners.net\nDKIM-Signature: v=1; a=rsa-sha256; d=businessidentity.llc; s=postal; h=from; bh=AA==; b=BB\n\nbody\n',
  );
  const verified = { ...inspection.signatures[0], verified: true, alignment: alignment('businessidentity.llc', 'glamcleaners.net') };
  assert.equal(dmarcVerdict({ ...inspection, verifiedSignatures: [verified] }).result, null, 'verified, but for a domain DMARC does not accept');

  const failed = { ...verified, verified: false, alignment: alignment('glamcleaners.net', 'glamcleaners.net') };
  assert.equal(dmarcVerdict({ ...inspection, verifiedSignatures: [failed] }).result, null, 'aligned, but nothing was proved');
});

test('what a receiver reported still wins over what this tool verified', () => {
  const inspection = inspectHeaders(alignedMessage);
  const proof = { d: 'glamcleaners.net', verified: true, alignment: alignment('glamcleaners.net', 'glamcleaners.net') };
  const verdict = dmarcVerdict({ ...inspection, verifiedSignatures: [proof] });

  assert.equal(verdict.source, 'reported by mx.google.com', 'a receiver\'s own dmarc= result is its verdict, policy included');
  assert.equal(verdict.policy, 'QUARANTINE');
});

test('SPF for a domain that does not align is not a DMARC pass', () => {
  const inspection = inspectHeaders(
    'From: hello@glamcleaners.net\nReturn-Path: <bounce@businessidentity.llc>\n'
    + 'Received-SPF: pass (mx.example: domain of bounce@businessidentity.llc) envelope-from=bounce@businessidentity.llc\n',
  );

  const verdict = dmarcVerdict(inspection);
  assert.equal(verdict.result, null);
  assert.match(verdict.source, /no aligned pass/);
});
