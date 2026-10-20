/**
 * DKIM, found rather than assumed — because it is the one mail record you cannot guess.
 *
 * SPF and DMARC are single records at names everybody knows (`@` and `_dmarc.@`). DKIM's public
 * key lives at `<selector>._domainkey.<domain>`, and the selector is a name the mail platform
 * chose: `default` on most panels, `google` at Google, `postal` on a Postal install, `s1` and `s2`
 * at some providers, a date under others. Moving the zone without it is silent — mail still
 * arrives, and then starts failing DKIM for the receivers that check, which with DMARC at
 * `p=quarantine` is the difference between an inbox and a spam folder.
 *
 * So this asks DNS a long list of names instead of trusting one convention, and it is meant to run
 * **before** the nameservers change: afterwards the old zone is no longer authoritative for the
 * domain, and the only copy of the key went with it. The list below is what was actually tried on
 * 2026-10-17 — 153 names, none of which answered — so the finding in DOMAIN.md is the same list
 * this code runs, not a retelling of it.
 *
 * The honesty limit is stated in the output: absence at every conventional name is not proof that
 * no key exists, because a platform could invent one. What it does establish is that nothing is
 * published, and an unpublished key cannot verify a signature — so whatever the panel holds, the
 * mail is not being signed with this domain today. `--selector` is how a panel's chosen name gets
 * asked.
 *
 * Discovery is read-only, and it must not be confused with "no key" when DNS merely failed: a
 * transient SERVFAIL read as absence would drop the record in exactly the way this exists to
 * prevent. So a name is only absent when the resolver says so, and anything else is retried once
 * and then raised.
 */
import { resolveCname, resolveTxt } from 'node:dns/promises';

/** Resolver answers that mean "this name holds no TXT", as opposed to "the lookup failed". */
const ABSENT = new Set(['ENODATA', 'ENOTFOUND', 'ENOTIMP']);

/**
 * The selector names worth asking about, in the order they are tried: the panel defaults first,
 * then the hosted-mail platforms, then the shapes that encode a size or a date.
 */
const CONVENTIONAL = `default mail email dkim dkim1 dkim2 dkim1024 dkim2048 dk dk1 dk2 s1
  s2 s3 s4 k1 k2 key key1 key2 keys selector selector1 selector2
  google googlemail postal postfix exim cpanel plesk hosting host webmail roundcube zimbra
  exchange office365 outlook microsoft amazon amazonses ses sendgrid mailchimp mandrill mailjet mailgun
  sparkpost postmark smtp smtp1 smtp2 mx mta mailer sender send outbound bulk
  marketing newsletter notification noreply no-reply bounce bounce1 domain domainkey server signature sig
  sign private public rsa rsa1024 rsa2048 rsa1 rsa2 1024 2048 2023 2024
  2025 2026 202401 202501 202410 20241017 oct2024 nov2024 jan2025 jun2025 sep2025 1
  2 3 a b c dk1a dkimkey dkim-key dk-key dkim_1 mail1 mail2
  mail3 mx1 mx2 ms ms1 ms2 bi biz epik epik1 onlineaccount business
  businessidentity identity registry domainregistry glam glamcleaners customers client sender1 sig1 signature1 auth
  auth1 spf dns dns1 host1 server1 smtpout out smtp-relay relay mta1 esmtp
  esmtp1 imap pop pop3 webmail1 s1024 s2048 k1024 k2048`.split(/\s+/);

export const CONVENTIONAL_SELECTORS = Object.freeze([...new Set(CONVENTIONAL.filter(Boolean))]);

/** The record name DKIM actually looks under. Not the apex, and not the domain itself. */
export const dkimName = (selector, host) => `${selector}._domainkey.${host}`;

/**
 * Selectors a person named: `--selector x`, `--selector=x`, repeated, comma-separated, or in
 * `DKIM_SELECTOR`. A pasted record name (`default._domainkey.example.com`) is reduced to the
 * selector, so the panel's value can be copied rather than retyped.
 */
export const selectorsFrom = (args = process.argv.slice(2), value = '') => [
  ...String(value).split(','),
  ...args.flatMap((argument, index) => {
    if (argument === '--selector') return [args[index + 1]];
    if (argument.startsWith('--selector=')) return [argument.slice('--selector='.length)];
    return [];
  }),
]
  .flatMap(entry => String(entry ?? '').split(','))
  .map(entry => entry.trim().replace(/\._domainkey\..*$/i, ''))
  .filter(Boolean);

/**
 * Every name to ask about: any the caller names first, then the conventional ones. A selector
 * given twice is asked once.
 */
export const dkimCandidates = (host, selectors = []) => {
  const seen = new Set();
  return [...selectors, ...CONVENTIONAL_SELECTORS]
    .map(selector => String(selector).trim())
    .filter(selector => selector && !seen.has(selector) && seen.add(selector))
    .map(selector => ({ selector, name: dkimName(selector, host) }));
};

/**
 * The key in a TXT record, or null when the record is something else.
 *
 * `resolveTxt` returns one array per record and one string per 255-byte chunk, so a long key
 * arrives split and only joins back into a key once the chunks are concatenated. `v=DKIM1` is
 * common but optional, so the test is the `p=` tag — with a real base64 length, which is what
 * separates a key from an SPF or a site-verification string that happens to contain `p=`.
 */
export const dkimKey = chunks => {
  const text = chunks.join('').trim();
  if (/^v=(spf1|DMARC1)\b/i.test(text)) return null;
  if (!/(?:^|;)\s*p\s*=\s*[A-Za-z0-9+/]{16,}={0,2}\s*(?:;|$)/.test(text)) return null;
  return text;
};

/** One DER header: tag already consumed, this reads its length and content bounds. */
const der = (buffer, at, tag) => {
  if (buffer[at] !== tag) return null;
  const first = buffer[at + 1];
  if (first === undefined) return null;
  let start;
  let length;
  if (first < 0x80) {
    start = at + 2;
    length = first;
  } else {
    const count = first & 0x7f;
    if (!count || at + 2 + count > buffer.length) return null;
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length * 256) + buffer[at + 2 + index];
    start = at + 2 + count;
  }
  if (start + length > buffer.length) return null;
  return { start, end: start + length };
};

/**
 * The RSA modulus length, not the length of its encoding.
 *
 * `p=` is base64 of a SubjectPublicKeyInfo: SEQUENCE, algorithm SEQUENCE, BIT STRING, then the
 * RSAPublicKey SEQUENCE with modulus and exponent. Counting the encoding instead would report a
 * 2048-bit key as "2352-bit" — the DER wrapper plus a leading zero — which is exactly the kind of
 * confidently wrong number a report should not print. Null when the value does not parse, and the
 * caller then says "key" without a size.
 */
export const keyBits = key => {
  const value = /(?:^|;)\s*p\s*=\s*([A-Za-z0-9+/=\s]+)/.exec(key)?.[1]?.replace(/\s+/g, '');
  if (!value) return null;

  const bytes = Buffer.from(value, 'base64');
  const outer = der(bytes, 0, 0x30);
  const algorithm = outer && der(bytes, outer.start, 0x30);
  const bitString = algorithm && der(bytes, algorithm.end, 0x03);
  if (!bitString || bytes[bitString.start] !== 0x00) return null;
  const rsa = der(bytes, bitString.start + 1, 0x30);
  const modulus = rsa && der(bytes, rsa.start, 0x02);
  if (!modulus) return null;

  let at = modulus.start;
  while (at < modulus.end && bytes[at] === 0) at += 1;
  if (at >= modulus.end) return null;
  return ((modulus.end - at - 1) * 8) + (32 - Math.clz32(bytes[at]));
};

/** Between-resolvers parallelism: enough to be quick, not enough to look like an attack. */
const each = async (items, limit, run) => {
  const results = new Array(items.length);
  let at = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (at < items.length) {
      const index = at++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
};

/** One lookup, retried once, and absent only when the resolver says the name holds nothing. */
const lookup = async (resolve, name) => {
  try {
    return await resolve(name);
  } catch (first) {
    if (ABSENT.has(first.code)) return [];
    try {
      return await resolve(name);
    } catch (second) {
      throw new Error(`${name} could not be read: ${second.code ?? second.message}`, { cause: second });
    }
  }
};

/**
 * One selector's key, or null when that name holds no key. The same lookup and parser the sweep
 * uses, so a signature can be checked against the same record without a second implementation.
 */
export const publishedKey = async (host, selector, { resolve = resolveTxt } = {}) => {
  if (!host || !selector) return null;
  const name = dkimName(selector, host);
  const key = dkimKey((await lookup(resolve, name)).flat());
  return key ? { selector, name, key, bits: keyBits(key) } : null;
};

/**
 * Ask the domain what it publishes.
 *
 * Returns the names tried, every key found (selector, record name, key, bits), any `_domainkey`
 * CNAME — which delegates the whole namespace and cannot be recreated blindly — and any key sitting
 * at the apex, where DKIM never looks. A real key at the apex has been seen in the wild on another
 * domain sharing this mail server, so it is reported rather than silently ignored.
 *
 * `max` bounds the sweep for callers that want one selector answered quickly; the default is all.
 */
export const discoverDkim = async (host, {
  selectors = [],
  resolve = resolveTxt,
  resolveAlias = resolveCname,
} = {}) => {
  const candidates = dkimCandidates(host, selectors);

  const rows = await each(candidates, 16, ({ selector }) => publishedKey(host, selector, { resolve }));

  const delegated = [];
  for (const name of [`_domainkey.${host}`, `*._domainkey.${host}`]) {
    const aliases = await lookup(resolveAlias, name);
    if (aliases.length) delegated.push(`${name} → ${aliases.join(', ')}`);
  }

  const atApex = (await lookup(resolve, host)).flat()
    .map(text => text.trim())
    .filter(text => /^v=DKIM1\b/i.test(text));

  return {
    tried: candidates.map(({ selector }) => selector),
    found: rows.filter(Boolean),
    delegated,
    misplaced: atApex,
  };
};
