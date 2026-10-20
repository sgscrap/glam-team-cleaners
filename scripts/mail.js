/**
 * What a delivered message proves about the mailbox.
 *
 *   npm run mail -- message.txt          # the delivered message source, saved to a file
 *   pbpaste | npm run mail               # or pasted straight in
 *   npm run mail < message.txt
 *   npm run mail -- message.txt --key default._domainkey.example.com='v=DKIM1; p=…'
 *
 * `npm run dkim` shows what the zone publishes; this shows what a receiver did with it — and, when
 * the paste includes the body, it does not take the receiver's word for the signature at all:
 * `src/dkim-verify.js` recomputes the body hash and checks the signature against the published key.
 * A `dkim=pass` line is a string; a signature that verifies here is arithmetic on the message's
 * own bytes.
 *
 * The header has to come from the **delivered** copy — Gmail's "Show original", Outlook's "View
 * source" — because `Authentication-Results` is written by the receiving server, not the sender.
 * Verification needs the body as well, and it needs it byte for byte: a paste that lost its CRLF
 * line endings, or lost the body, is reported as unverifiable rather than as a failed signature.
 *
 * `--key` verifies against a record you paste in, for a key that is not published yet — the question
 * "does this mailbox sign with the key I am about to publish" can be asked before the record exists.
 *
 * It reads; it writes nothing; it needs no token. Exit 1 when it found no headers, or when a
 * signature it actually checked does not verify.
 */
import { readFileSync } from 'node:fs';
import { publishedKey } from '../src/dkim.js';
import { verifyMessage } from '../src/dkim-verify.js';
import { alignment, dmarcVerdict, inspectHeaders, parseMailArgs } from '../src/mail.js';

// The arguments — the message, and any `--key` overrides — are parsed in src/mail.js, where the
// separator between a flag's value and the file is testable. Here it is just the failure message.
let parsed;
try {
  parsed = parseMailArgs(process.argv.slice(2));
} catch (error) {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
}
const { file, overrides } = parsed;

let text = '';
try {
  if (file) text = readFileSync(file, 'utf8');
  else if (!process.stdin.isTTY) text = readFileSync(0, 'utf8');
} catch (error) {
  console.error(`\n✗ Could not read ${file ?? 'standard input'}: ${error.message}\n`);
  process.exit(1);
}

if (!text.trim()) {
  console.error('\n✗ No header text.');
  console.error('  Paste the delivered message source, not the rendered message:');
  console.error('    npm run mail -- message.txt        (Gmail: Show original; Outlook: View source)');
  console.error('    pbpaste | npm run mail');
  console.error('  A key that is not published yet can be pasted in, and the signature is then');
  console.error('  checked against it rather than against DNS:');
  console.error("    npm run mail -- message.txt --key default._domainkey.example.com='v=DKIM1; p=…'\n");
  process.exit(1);
}

const report = inspectHeaders(text);

if (!report.headers.length) {
  console.error('\n✗ No header lines found in that text.');
  console.error('  It needs `Name: value` lines. Use the message source, not the text of the message.\n');
  process.exit(1);
}

/** The published key for each signature, asked one at a time so a failure is attributed. */
for (const signature of report.signatures) {
  if (!signature.d || !signature.s) continue;
  try {
    signature.key = await publishedKey(signature.d, signature.s);
  } catch (error) {
    signature.keyError = error.message;
  }
}

/**
 * What the signature is checked against: the pasted record if there is one, otherwise what DNS
 * answered. A lookup that failed resolves to nothing rather than to a guess — the caller is told
 * it could not ask, and "not asked" is never printed as "does not verify".
 */
const keyFor = (domain, selector) => overrides.get(`${domain}|${selector}`)
  ?? report.signatures.find(signature => signature.d === domain && signature.s === selector)?.key?.key
  ?? null;

const verification = verifyMessage(text, { keyFor });

/**
 * Each verified signature carries the alignment DMARC would judge it by. `verifiedSignatures` is
 * what lets the verdict below rest on this tool's own arithmetic when no receiver spoke.
 */
const verifiedSignatures = verification.signatures.map(signature => ({
  ...signature,
  alignment: alignment(signature.d, report.fromDomain),
}));

const verdict = dmarcVerdict({ ...report, verifiedSignatures });
const mark = ok => (ok ? '✓' : '✗');
const or = (value, fallback = '—') => (value === null || value === undefined || value === '' ? fallback : value);

console.log('\nMessage header — authentication\n');
console.log(`  From         ${or(report.from?.address, 'no From address parsed')}`);
console.log(`  Domain       ${or(report.fromDomain)}`);
if (report.returnPath) {
  console.log(`  Return-Path  ${report.returnPath.address}      SPF is checked against this, not From`);
}

if (!report.signatures.length) {
  console.log('\n  DKIM         none — this message carries no DKIM-Signature header');
} else {
  report.signatures.forEach((signature, index) => {
    const label = report.signatures.length > 1 ? `DKIM ${index + 1}` : 'DKIM';
    console.log(`\n  ${label.padEnd(12)} s=${or(signature.s)}  d=${or(signature.d)}${signature.a ? `  a=${signature.a}` : ''}`);

    if (signature.keyError) {
      console.log(`               key  lookup failed — ${signature.keyError}`);
    } else if (signature.key) {
      console.log(`               key  ${signature.key.name} — published${signature.key.bits ? `, ${signature.key.bits}-bit` : ''}`);
    } else if (signature.d && signature.s) {
      // A key pasted in with --key is not a key DNS failed to answer for, and saying so would be
      // the difference between "you have not published this" and "the lookup did not run".
      const name = `${signature.s}._domainkey.${signature.d}`;
      console.log(overrides.has(`${signature.d}|${signature.s}`)
        ? `               key  ${name} — the record pasted in with --key, not asked of DNS`
        : `               key  ${name} — not published, so nothing can verify this signature`);
    }

    const { relaxed, strict } = signature.alignment;
    console.log(`               align  relaxed ${relaxed ? 'yes' : 'no'}  strict ${strict ? 'yes' : 'no'}  against ${or(report.fromDomain)}`);
  });
}

if (verification.signatures.length) {
  console.log('\n  Verified here  (recomputed from the message, not read from a header)');

  verification.signatures.forEach((signature, index) => {
    const label = verification.signatures.length > 1 ? `DKIM ${index + 1}` : 'DKIM';
    const bodyLine = {
      pass: `✓ body hashes to bh= — ${signature.a}, ${signature.c}, ${or(signature.bodyCovered)} octets`,
      fail: '✗ body does not hash to bh=',
      skipped: '— body hash not checked',
    }[signature.bodyHash];
    console.log(`               ${label.padEnd(7)} ${bodyLine}`);

    const signatureLine = {
      pass: `✓ signature verifies with ${or(signature.key?.name, 'the published key')}${signature.key?.bits ? `, ${signature.key.bits}-bit` : ''}`,
      fail: '✗ signature does not verify with the published key',
      skipped: '— signature not checked',
    }[signature.signature];
    console.log(`                       ${signatureLine}`);

    for (const note of signature.notes) console.log(`                       note  ${note}`);
  });

  if (verification.verified) {
    console.log('\n  ✓ This message is signed with a key the domain publishes, and its body is the body');
    console.log('    that was signed. Nothing here had to take a header at its word.');
  } else if (verification.failed.length) {
    console.log('\n  ✗ A signature was checked and failed:');
    for (const problem of [...new Set(verification.signatures.flatMap(signature => signature.problems))]) {
      console.log(`      ${problem}`);
    }
  } else {
    console.log('\n  ! Nothing could be verified here:');
    for (const note of [...new Set(verification.signatures.flatMap(signature => signature.notes))]) {
      console.log(`      ${note}`);
    }
    console.log('      A copy with no body, or a key no nameserver publishes, cannot settle it either way.');
  }
}

if (report.spf) {
  console.log(`\n  Received-SPF ${report.spf.result ?? '—'}${report.spf.mailfrom ? `  mailfrom=${report.spf.mailfrom}` : ''}${report.spf.clientIp ? `  ip=${report.spf.clientIp}` : ''}`);
}

if (report.results.length) {
  for (const result of report.results) {
    console.log(`\n  Receiver     ${or(result.id, 'unnamed')}`);
    for (const method of result.methods) {
      if (method.method === 'dkim') {
        const domain = method.props['header.d'] ?? method.props['header.i']?.replace(/^@/, '') ?? '—';
        console.log(`               dkim=${method.result}${method.props['header.s'] ? `  s=${method.props['header.s']}` : ''}  d=${domain}`);
      } else if (method.method === 'spf') {
        console.log(`               spf=${method.result}${method.props['smtp.mailfrom'] ? `  mailfrom=${method.props['smtp.mailfrom']}` : ''}`);
      } else if (method.method === 'dmarc') {
        console.log(`               dmarc=${method.result}${method.props.p ? `  p=${method.props.p}` : ''}${method.props['header.from'] ? `  from=${method.props['header.from']}` : ''}`);
      } else {
        console.log(`               ${method.method}=${method.result}`);
      }
    }
  }
} else {
  console.log('\n  Receiver     no Authentication-Results header');
}

/** The signature this tool verified itself and that aligns with From — proof, not testimony. */
const proof = verifiedSignatures.find(signature => signature.verified && signature.alignment.relaxed);

console.log('\n  DMARC');
if (!report.dkimReports.length && !(report.spfReport || report.spf)) {
  console.log(proof
    ? '               no receiver reported a dkim= or spf= result; the pass below rests on the signature verified here'
    : '               nothing to align — no dkim= or spf= result was reported');
}
if (report.dkimReports.length) {
  for (const dkim of report.dkimReports) {
    console.log(`               dkim  d=${or(dkim.domain)}  ${dkim.result}  ${dkim.alignment.relaxed ? 'aligned (relaxed)' : 'not aligned'}`);
  }
}
// Only when an SPF result exists: a Return-Path is not a verdict, and printing alignment beside
// no result would suggest DMARC had something to work with.
if (report.spfIdentity && (report.spfReport || report.spf)) {
  const result = report.spfReport?.result ?? report.spf?.result ?? 'no result';
  console.log(`               spf   ${result}  ${report.spfIdentity}  ${report.spfAlignment.relaxed ? 'aligned (relaxed)' : 'not aligned'}`);
}

if (verdict.result === 'pass') {
  const policy = verdict.policy ? ` (p=${verdict.policy})` : '';
  console.log(`\n  ${mark(true)} DMARC passes${policy} — ${verdict.source}.`);
  if (proof && !report.dmarcReport) {
    console.log('    No receiver spelled this one out. The pass rests on the signature verified above,');
    console.log(`    which is aligned to ${or(report.fromDomain)} under relaxed alignment — so it is this`);
    console.log('    tool\'s arithmetic on the message, not a header somebody wrote.');
  } else {
    if (!report.results.length) {
      console.log('    SPF alone was reported; DMARC alignment is computed here, not observed.');
    }
    console.log('    This is the proof: it came from the receiving server, not from the sender.');
  }
} else if (verdict.result) {
  console.log(`\n  ${mark(false)} dmarc=${verdict.result} — ${verdict.source}.`);
  console.log('    Mail from this domain is not authenticating at this receiver.');
} else if (report.hasVerdict) {
  console.log('\n  ✗ No aligned pass: neither DKIM nor SPF matched the From domain under relaxed alignment.');
} else {
  console.log('\n  ! No verdict in this copy. The signature is the sender\'s claim; only a receiver');
  console.log('    reports whether it passed. Ask for the delivered source — Gmail: Show original,');
  console.log('    Outlook: View source — and run this on that.');
  if (!verification.bodyPresent) {
    console.log('    Nor could the signature be checked from here: the paste stops at the blank line, and');
    console.log('    the body is half of what a signature covers. Save the whole source and run it again.');
  }
}

console.log('');

// A signature that was checked and did not verify is the one result worth failing on: it means the
// message was altered after signing, or the key is not the one that signed it. Everything else —
// no key, no body, no receiver verdict — is a limitation of the copy, and says so.
if (verification.failed.length) process.exitCode = 1;
