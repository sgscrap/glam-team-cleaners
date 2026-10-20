/**
 * A DKIM signature, checked here instead of taken on trust.
 *
 * `src/mail.js` reads what a message *says* — the selector it claims, the verdict a receiver
 * wrote. This does the other thing: it recomputes the two hashes the signature commits to, and
 * verifies the signature over them with the key the domain publishes. The difference matters
 * because "dkim=pass" in a header is a string anybody can type, while a signature that verifies
 * here is arithmetic on bytes: the body was not altered after signing, and the signer held the
 * private half of a key published under the domain it claims.
 *
 * What it cannot do, and says so rather than implying otherwise:
 *
 *   - **Byte-exactness of the copy.** DKIM hashes octets, with CRLF line endings. A paste that
 *     lost its CRLFs, or a client that re-wrapped the body, fails the body hash — and that is a
 *     statement about the copy, not about the mail. The result carries the line endings it saw, and
 *     anything non-latin1 is reported as unverifiable rather than hashed as something it is not.
 *   - **Anything the signature does not cover.** A `l=` tag signs a prefix; whatever follows is
 *     unsigned, and the result says how many octets were covered.
 *   - **Whether the key is the *right* key.** Verifying proves the signature matches the key. That
 *     the key belongs to the domain is DNS's claim, and that the domain is the one DMARC cares
 *     about is alignment — `src/mail.js` computes that.
 *
 * The canonicalization and the header selection follow RFC 6376 §3.4 and §3.5: `simple` keeps the
 * bytes as they are, `relaxed` lower-cases header names, unfolds, and collapses whitespace; a name
 * repeated in `h=` is taken from the bottom of the header block upward. RFC 8463's `ed25519-sha256`
 * is understood, with the raw 32-byte key wrapped into the SPKI envelope OpenSSL wants.
 *
 * Nothing here touches the network: `verifyMessage` takes a key resolver, so the caller decides
 * where a key comes from and this stays testable without DNS.
 */
import { createHash, createPublicKey, verify as verifyWith } from 'node:crypto';

/** The `a=` values this understands, and what each one asks of node:crypto. */
const ALGORITHMS = {
  'rsa-sha256': { digest: 'sha256', keyType: 'rsa', cryptoHash: 'sha256' },
  'rsa-sha1': { digest: 'sha1', keyType: 'rsa', cryptoHash: 'sha1' },
  // Ed25519 signs the message itself; there is no separate digest to name.
  'ed25519-sha256': { digest: 'sha256', keyType: 'ed25519', cryptoHash: null },
};

/** Ed25519's `p=` is a bare 32-byte key; this is the SPKI header that carries it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** One line-ending convention to canonicalize against, whichever the paste arrived with. */
const asCrlf = text => String(text ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

/**
 * The message as its two halves, with the fields kept as they were written.
 *
 * Everything is measured from the first empty line, which is the only header/body boundary there
 * is: a body may contain colons, blank-looking lines, anything. The fields keep their original
 * text — folded lines included — because canonicalization is defined on that text, not on a
 * parsed value. `complete` is false when the paste has no empty line at all, which is a header
 * dump and not a message; `body` is then null rather than an empty string, since those two mean
 * different things to a body hash.
 */
export const splitMessage = source => {
  const text = String(source ?? '').replace(/^\uFEFF/, '');
  const lineEndings = /\r\n/.test(text) ? 'crlf' : 'lf';
  const crlf = asCrlf(text);
  const separator = crlf.indexOf('\r\n\r\n');

  const headerText = separator === -1 ? crlf.replace(/\r\n$/, '') : crlf.slice(0, separator);
  const fields = [];
  for (const line of headerText.split('\r\n')) {
    if (/^[ \t]/.test(line) && fields.length) {
      fields[fields.length - 1].raw += `\r\n${line}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    fields.push({ name: line.slice(0, colon).trim(), raw: line });
  }

  return {
    lineEndings,
    fields,
    body: separator === -1 ? null : crlf.slice(separator + 4),
    complete: separator !== -1,
    // DKIM hashes octets. A paste decoded as UTF-8 cannot be hashed as the octets that were
    // signed once a character needs more than one byte, so that is reported, not guessed at.
    eightBitClean: !/[^\u0000-\u00ff]/.test(text),
  };
};

/**
 * One header field, canonicalized: `simple` exactly as written, `relaxed` per RFC 6376 §3.4.2 —
 * name lower-cased, continuation lines unfolded, whitespace runs collapsed to one space, and the
 * spaces around the colon and at the end of the value gone. Either way the field ends in CRLF.
 */
export const canonicalHeader = (algorithm, raw) => {
  const text = asCrlf(raw);
  if (algorithm !== 'relaxed') return `${text}\r\n`;

  const colon = text.indexOf(':');
  const name = text.slice(0, colon).trim().toLowerCase();
  const value = text.slice(colon + 1)
    .replace(/\r\n/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[ \t]+/, '')
    .replace(/[ \t]+$/, '');
  return `${name}:${value}\r\n`;
};

/**
 * The body, canonicalized per RFC 6376 §3.4.3–3.4.4: trailing empty lines are dropped, a non-empty
 * body ends in CRLF, and an empty one is a single CRLF. `relaxed` additionally collapses whitespace
 * inside a line and strips it from the end of one.
 *
 * `length` is the `l=` tag: a count of octets into the canonicalized body, which is what the signer
 * hashed. Anything past it is not covered by the signature, and the caller is told so.
 */
export const canonicalBody = (algorithm, body, length = null) => {
  const text = asCrlf(body ?? '');
  const lines = algorithm === 'relaxed'
    ? text.split('\r\n').map(line => line.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/, ''))
    : text.split('\r\n');

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  // RFC 6376 §3.4.3 and §3.4.4 disagree about an empty body, deliberately: `simple` canonicalizes
  // it to one CRLF (two octets), while `relaxed` leaves it as the null input — which is why the
  // RFC prints the hash of the empty string beside that algorithm and 2 octets beside this one.
  const canonical = lines.length
    ? `${lines.join('\r\n')}\r\n`
    : (algorithm === 'relaxed' ? '' : '\r\n');

  return length === null || length === undefined || Number.isNaN(length)
    ? canonical
    : canonical.slice(0, length);
};

/**
 * The value of a header field: the name and colon removed. Tags live in the value, and a field is
 * not a record — `tags()` on `DKIM-Signature: v=1; …` would read a tag called `dkim-signature: v`.
 *
 * The field name itself is lower-cased rather than parsed, because a signature's own name is not
 * case-sensitive in the way a list of tags is: `DKIM-Signature` and `Dkim-Signature` are the same
 * header, and both are read here.
 */
export const headerValue = raw => {
  const colon = String(raw).indexOf(':');
  return colon === -1 ? '' : String(raw).slice(colon + 1);
};

/** The tags of a `DKIM-Signature` value or of a published key record, unfolded and trimmed. */
export const tags = value => {
  const parsed = {};
  for (const part of String(value).split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    if (name) parsed[name] = part.slice(at + 1).replace(/\r\n/g, '').replace(/\s+$/, '').trim();
  }
  return parsed;
};

/** Base64 in these tags may be folded across lines; the value is the octets, not the layout. */
const base64 = value => Buffer.from(String(value ?? '').replace(/\s+/g, ''), 'base64');

/**
 * The `b=` value removed from the signature header before it is hashed — the one header the signer
 * could not sign, because signing it would change it. Everything else about the field is hashed
 * exactly as it appears, including its position in the header block.
 */
export const withoutSignatureValue = raw => String(raw).replace(/(^|[;\s])b[ \t\r\n]*=[^;]*/i, '$1b=');

/** A `k=rsa` key record as a key node:crypto will verify with, or null if it does not parse. */
export const publicKeyFrom = (record, keyType) => {
  const parsed = tags(record);
  const value = String(parsed.p ?? '').replace(/\s+/g, '');
  if (!value) return null;

  const bytes = base64(value);
  if (!bytes.length) return null;

  try {
    if (keyType === 'ed25519') {
      // RFC 8463: `p=` is the raw key. Some publishers send the SPKI wrapper anyway; both work.
      if (bytes.length === 32) {
        return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]), format: 'der', type: 'spki' });
      }
      return createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    }
    return createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  } catch {
    return null;
  }
};

/** The domain an `i=` identity belongs to, for the check that it sits under `d=`. */
const identityDomain = identifier => {
  const at = String(identifier ?? '').lastIndexOf('@');
  return (at === -1 ? String(identifier ?? '') : String(identifier).slice(at + 1))
    .toLowerCase()
    .replace(/\.$/, '');
};

/**
 * One signature, verified. Never throws and never guesses: every check that could not be run is
 * reported as skipped with the reason, and `verified` is true only when the body hash matched *and*
 * the signature verified against a published key.
 */
export const verifySignature = ({ raw, message, keyRecord = null, now = Math.floor(Date.now() / 1000) }) => {
  const parsed = tags(headerValue(raw));
  const [headerAlgorithm = 'simple', bodyAlgorithm = 'simple'] = String(parsed.c ?? 'simple/simple')
    .toLowerCase()
    .split('/');
  const algorithm = ALGORITHMS[String(parsed.a ?? '').toLowerCase()] ?? null;

  const result = {
    tags: parsed,
    d: String(parsed.d ?? '').toLowerCase().replace(/\.$/, '') || null,
    s: parsed.s ?? null,
    a: String(parsed.a ?? '').toLowerCase() || null,
    c: `${headerAlgorithm}/${bodyAlgorithm}`,
    h: parsed.h ?? null,
    l: parsed.l === undefined ? null : Number(parsed.l),
    x: parsed.x === undefined ? null : Number(parsed.x),
    i: parsed.i ?? null,
    key: null,
    bodyHash: 'skipped',
    signature: 'skipped',
    verified: false,
    problems: [],
    notes: [],
  };

  if (String(parsed.v ?? '') !== '1') result.problems.push(`v= is ${parsed.v ?? 'missing'}, not 1`);
  if (!algorithm) result.problems.push(`a=${parsed.a ?? 'missing'} is not a signature algorithm this knows`);
  if (!parsed.h) result.problems.push('h= is missing, so there is no way to know which headers were signed');
  if (!parsed.b) result.problems.push('b= is missing, so there is no signature to check');
  if (!parsed.bh) result.problems.push('bh= is missing, so the body hash cannot be compared');
  if (headerAlgorithm !== 'simple' && headerAlgorithm !== 'relaxed') {
    result.problems.push(`c=${headerAlgorithm}/… is not a canonicalization this knows`);
  }
  if (bodyAlgorithm !== 'simple' && bodyAlgorithm !== 'relaxed') {
    result.problems.push(`c=…/${bodyAlgorithm} is not a canonicalization this knows`);
  }

  if (result.x !== null && !Number.isNaN(result.x)) {
    if (result.x < now) {
      result.problems.push(`the signature expired on ${new Date(result.x * 1000).toISOString().slice(0, 10)}`);
    } else {
      result.notes.push(`expires ${new Date(result.x * 1000).toISOString().slice(0, 10)}`);
    }
  }
  if (parsed.t !== undefined && Number(parsed.t) > now + 3600) {
    result.notes.push('t= is in the future, which is what a wrong clock looks like');
  }

  if (result.i && result.d) {
    const identity = identityDomain(result.i);
    if (identity !== result.d && !identity.endsWith(`.${result.d}`)) {
      result.problems.push(`i=${result.i} is not under d=${result.d}`);
    }
  }

  /* --- the body ---------------------------------------------------------- */

  const body = message.body;
  if (body === null) {
    result.notes.push('this copy has no body, so the body hash cannot be recomputed');
  } else if (algorithm) {
    const covered = canonicalBody(bodyAlgorithm, body, result.l === null || Number.isNaN(result.l) ? null : result.l);
    const digest = createHash(algorithm.digest).update(Buffer.from(covered, 'latin1')).digest('base64');
    result.bodyCovered = covered.length;
    result.bodyLength = canonicalBody(bodyAlgorithm, body).length;
    result.bodyHash = digest === String(parsed.bh).replace(/\s+/g, '') ? 'pass' : 'fail';
    if (result.bodyHash === 'fail') {
      result.problems.push('the body hash does not match bh= — this copy is not the body that was signed');
    }
    if (result.bodyLength !== result.bodyCovered) {
      result.notes.push(
        `l=${result.l} covers ${result.bodyCovered} of ${result.bodyLength} octets — anything after that is unsigned`,
      );
    }
  }

  /* --- the headers, and the signature over them --------------------------- */

  const signedNames = String(parsed.h ?? '').split(':').map(name => name.trim().toLowerCase()).filter(Boolean);
  const byName = new Map();
  message.fields.forEach((field, index) => {
    const name = field.name.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), index]);
  });

  // A name repeated in `h=` is taken from the bottom of the header block upward: the last
  // occurrence first, then the one before it. A name with no occurrence at all contributes
  // nothing — not an empty header field, nothing — which is RFC 6376 §3.5's rule and the reason a
  // signer may list a field it intends to prove absent: "nonexistent header fields do not
  // contribute to the signature computation". dkimpy signs `h=…:from` twice for that reason, and
  // treating the second one as missing would make its signatures unverifiable everywhere.
  const taken = new Map();
  const selected = [];
  const absent = [];
  for (const name of signedNames) {
    const candidates = byName.get(name) ?? [];
    const used = taken.get(name) ?? 0;
    taken.set(name, used + 1);
    const index = candidates[candidates.length - 1 - used];
    if (index === undefined) absent.push(name);
    else selected.push(message.fields[index].raw);
  }
  if (absent.length) {
    result.notes.push(
      `h= names ${[...new Set(absent)].join(', ')}, which this message does not have — the null input, as the signer intended`,
    );
  }

  const key = keyRecord === null ? null : publicKeyFrom(keyRecord, algorithm?.keyType ?? 'rsa');
  if (keyRecord !== null) {
    const parsedKey = tags(keyRecord);
    if (!parsedKey.p) {
      result.problems.push('the published key has no p= — it has been revoked, so nothing can verify with it');
    } else if (!key) {
      result.problems.push('the published key does not parse as a public key');
    } else if (parsedKey.k && algorithm && parsedKey.k.toLowerCase() !== algorithm.keyType) {
      result.problems.push(`the key is k=${parsedKey.k} and the signature is a=${result.a}`);
    }
  }

  if (key && algorithm) {
    // The signature's own header is the one field hashed *without* its trailing CRLF — RFC 6376
    // §3.7's examples and every implementation that follows them. Strip it, and the whitespace a
    // `simple` canonicalization would leave in front of it, or nothing verifies.
    const signed = canonicalHeader(headerAlgorithm, withoutSignatureValue(raw)).replace(/[\r\n \t]+$/, '');
    const input = Buffer.from(
      selected.map(field => canonicalHeader(headerAlgorithm, field)).join('') + signed,
      'latin1',
    );
    try {
      result.signature = verifyWith(algorithm.cryptoHash, input, key, base64(parsed.b)) ? 'pass' : 'fail';
      result.key = {
        name: result.s && result.d ? `${result.s}._domainkey.${result.d}` : null,
        bits: algorithm.keyType === 'rsa' ? key.asymmetricKeyDetails?.modulusLength ?? null : null,
      };
      if (result.signature === 'fail') {
        result.problems.push('the signature does not verify against the published key');
      }
    } catch (error) {
      result.problems.push(`the signature could not be checked: ${error.message}`);
    }
  } else if (!keyRecord) {
    result.notes.push(
      result.s && result.d
        ? `no key is published at ${result.s}._domainkey.${result.d}, so nothing can verify this signature`
        : 'the signature names no selector or domain',
    );
  }

  if (!message.eightBitClean) {
    result.notes.push('this copy contains characters beyond 8 bits, so hashing its octets is a guess');
  }
  if (message.lineEndings === 'lf') {
    result.notes.push('this copy had bare LF line endings; DKIM hashes CRLF, so they were normalized');
  }

  result.verified = result.bodyHash === 'pass' && result.signature === 'pass' && result.problems.length === 0;
  return result;
};

/**
 * Every `DKIM-Signature` in a message, each verified against the key the caller resolves for its
 * `d=` and `s=`. `keyFor(domain, selector)` returns the published TXT record, or null when the
 * name holds none — which is reported as "nothing can verify this" rather than as a failure.
 */
export const verifyMessage = (source, { keyFor = () => null, now } = {}) => {
  const message = splitMessage(source);
  const signatureFields = message.fields
    .filter(field => field.name.toLowerCase() === 'dkim-signature')
    .map(field => field.raw);

  const signatures = signatureFields.map(raw => {
    const parsed = tags(headerValue(raw));
    const domain = String(parsed.d ?? '').toLowerCase().replace(/\.$/, '');
    const keyRecord = parsed.d && parsed.s ? keyFor(domain, parsed.s) : null;
    return verifySignature({ raw, message, keyRecord: keyRecord ?? null, now });
  });

  return {
    message,
    signatures,
    bodyPresent: message.body !== null,
    verified: signatures.some(signature => signature.verified),
    failed: signatures.filter(signature => signature.bodyHash === 'fail' || signature.signature === 'fail'),
  };
};
