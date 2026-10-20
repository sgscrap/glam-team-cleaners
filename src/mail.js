/**
 * What a message header says about the mail, read without trusting it.
 *
 * The question this answers is not "does the site exist" but "did this message authenticate":
 * which selector and domain signed it, what the receiving server said about SPF and DMARC, and
 * whether those identifiers line up with the From domain under DMARC's alignment rules. That is
 * the only proof a migration can offer — `npm run dkim` shows what is published, and this shows
 * what a receiver actually did with it.
 *
 * Three kinds of statement, kept apart on purpose:
 *
 *   - **Signed**: `DKIM-Signature` headers, written by the sending side. They prove intent, not
 *     delivery — anyone can add one.
 *   - **Reported**: `Authentication-Results` and `Received-SPF`, written by the receiving server.
 *     These are the verdict, and the reason the tool is worth running after the switch.
 *   - **Computed here**: alignment of `d=` and the envelope domain against the From domain.
 *     DMARC passes on an aligned DKIM or SPF pass, so this is what turns the two lists above into
 *     a verdict when the receiver did not spell one out.
 *
 * A fourth kind belongs to `src/dkim-verify.js` and outranks the first two: a signature *verified*
 * here, by recomputing the body hash and checking the signature against the published key. That is
 * arithmetic on the bytes rather than a claim about them, so when no receiver has spoken it turns
 * an aligned signature into a DMARC pass on its own — and the source line says so, so nobody reads
 * it as something a mail server reported.
 *
 * Alignment needs the organizational domain (RFC 7489 §3.2), and a correct one needs the public
 * suffix list. Rather than fetch or embed that, this knows the common multi-label suffixes; for
 * `glamcleaners.net` and `businessidentity.llc` — the domains this exists for — the answer is exact,
 * and the report says when it is inferring rather than reporting. A receiver's `dmarc=` result
 * always wins over the inference.
 */
/** Two-label public suffixes this is likely to meet; not a substitute for the full list. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.my', 'com.tw',
  'co.in', 'net.in', 'org.in', 'co.il', 'co.ke', 'com.ng', 'co.id', 'com.ph',
  'com.vn', 'co.th', 'com.pl', 'com.ua', 'co.kr', 'or.kr',
]);

/**
 * The registrable domain under the common suffixes. Deliberately approximate and labelled as such:
 * an incorrect guess here could call two different sites aligned, so the report prints the domains
 * it compared rather than only the word "aligned".
 */
export const organizationalDomain = host => {
  const labels = String(host ?? '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
};

/** DMARC strict and relaxed alignment of one identifier against the From domain. */
export const alignment = (identifier, from) => {
  if (!identifier || !from) return { strict: false, relaxed: false, organizational: organizationalDomain(identifier) };
  return {
    strict: identifier.toLowerCase() === from.toLowerCase(),
    relaxed: organizationalDomain(identifier) === organizationalDomain(from),
    organizational: organizationalDomain(identifier),
  };
};

/**
 * Header lines, unfolded, and the body after them.
 *
 * Some clients start the paste with a bare `Subject:` line or a `From - ...` label; those are
 * skipped until the first real header. A blank line ends the headers, because a body may contain
 * colons and quoting it would produce headings that are not headers at all.
 */
export const parseHeaders = text => {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const headers = [];
  let at = lines.findIndex(line => /^[A-Za-z][A-Za-z0-9-]*:/.test(line));

  for (; at !== -1 && at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim()) {
      at += 1;
      break;
    }
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) {
      if (headers.length) headers[headers.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }

  return { headers, body: at > 0 ? lines.slice(at).join('\n') : '' };
};

/** Every value of one header, in the order they appear; DKIM and Received headers repeat. */
export const values = (headers, name) => headers
  .filter(header => header.name.toLowerCase() === name.toLowerCase())
  .map(header => header.value);

/** `Name <a@b>` or a bare address, with the domain lowercased and dot-stripped. */
export const parseAddress = value => {
  if (!value) return null;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1];
  const bare = bracketed ?? /([^\s<>,";:]+@[^\s<>,";:]+)/.exec(value)?.[1];
  if (!bare) return null;
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  const name = value.replace(/<[^>]*>/, '').replace(/^"|"$/g, '').trim();
  return {
    name: name || null,
    address: bare,
    domain: bare.slice(at + 1).toLowerCase().replace(/\.$/, ''),
  };
};

/** A `DKIM-Signature` split into its tags; `b=` and `bh=` are kept but never printed. */
export const parseDkimSignature = value => {
  const tags = {};
  for (const part of String(value).split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    if (name) tags[name] = part.slice(at + 1).trim();
  }
  return {
    tags,
    d: tags.d?.toLowerCase().replace(/\.$/, ''),
    s: tags.s,
    a: tags.a,
    i: tags.i,
    t: tags.t,
  };
};

/**
 * `Authentication-Results` as the receiver wrote it: the authserv-id, then one result per method
 * with its properties (`header.s=`, `header.d=`, `smtp.mailfrom=`, `p=`).
 */
export const parseAuthenticationResults = value => {
  const parts = String(value).split(';');
  const id = parts.shift()?.trim() ?? '';
  const methods = [];

  for (const part of parts) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*([A-Za-z]+)\b(.*)$/.exec(part.trim());
    if (!match) continue;
    const props = {};
    for (const prop of match[3].matchAll(/([A-Za-z][A-Za-z0-9.-]*)\s*=\s*([^\s;]+)/g)) {
      props[prop[1].toLowerCase()] = prop[2].replace(/[;,]+$/, '');
    }
    methods.push({ method: match[1].toLowerCase(), result: match[2].toLowerCase(), props });
  }

  return { id, methods };
};

/** The verdict word and the envelope identity out of a `Received-SPF` header. */
export const parseReceivedSpf = value => {
  if (!value) return null;
  return {
    result: /^([A-Za-z]+)/.exec(value)?.[1]?.toLowerCase() ?? null,
    identity: /\bidentity=([A-Za-z]+)/i.exec(value)?.[1]?.toLowerCase() ?? null,
    mailfrom: /\benvelope-from=([^\s;]+)/i.exec(value)?.[1] ?? null,
    helo: /\bhelo=([^\s;]+)/i.exec(value)?.[1] ?? null,
    clientIp: /\bclient-ip=([^\s;]+)/i.exec(value)?.[1] ?? null,
    receiver: /\breceiver=([^\s;]+)/i.exec(value)?.[1] ?? null,
  };
};

/** The DKIM domain a receiver reported, from `header.d` or the `header.i` identifier. */
export const reportedSigner = props => {
  if (props['header.d']) return props['header.d'].toLowerCase().replace(/\.$/, '');
  const identifier = props['header.i'];
  return identifier ? identifier.replace(/^@/, '').toLowerCase() : null;
};

/**
 * Everything the header offers, still separated by who said it. `keys` maps a `<d>|<s>` pair to
 * what DNS published, so a signature with no published key is visible as that rather than silently
 * assumed good.
 */
export const inspectHeaders = (text, keys = new Map()) => {
  const { headers, body } = parseHeaders(text);

  const from = parseAddress(values(headers, 'from')[0]);
  const returnPath = parseAddress(values(headers, 'return-path')[0]);
  const fromDomain = from?.domain ?? null;

  const signatures = values(headers, 'dkim-signature').map(parseDkimSignature).map(signature => ({
    ...signature,
    alignment: alignment(signature.d, fromDomain),
    key: keys.get(`${signature.d}|${signature.s}`) ?? null,
  }));

  const results = values(headers, 'authentication-results').map(parseAuthenticationResults);
  const methods = results.flatMap(result => result.methods.map(method => ({ ...method, receiver: result.id })));
  const reported = method => methods.find(entry => entry.method === method) ?? null;

  const dkimReports = methods
    .filter(entry => entry.method === 'dkim')
    .map(entry => {
      const domain = reportedSigner(entry.props);
      return { ...entry, domain, selector: entry.props['header.s'] ?? null, alignment: alignment(domain, fromDomain) };
    });

  const spf = parseReceivedSpf(values(headers, 'received-spf')[0]);
  const spfReport = reported('spf');
  const spfIdentity = spfReport?.props['smtp.mailfrom']
    ?? spf?.mailfrom
    ?? returnPath?.address
    ?? null;
  const spfDomain = spfIdentity?.split('@').pop()?.toLowerCase() ?? null;

  const dmarcReport = reported('dmarc');

  return {
    headers,
    body,
    from,
    fromDomain,
    returnPath,
    signatures,
    results,
    spf,
    spfReport,
    spfIdentity,
    spfDomain,
    spfAlignment: alignment(spfDomain, fromDomain),
    dkimReports,
    dmarcReport,
    /** True only when a receiving server spoke; the sender's headers are not a verdict. */
    hasVerdict: results.length > 0 || Boolean(spf),
  };
};

/**
 * The arguments `scripts/mail.js` accepts: at most one file (none means standard input) and any
 * number of `--key <selector>._domainkey.<domain>=<TXT record>` overrides.
 *
 * Here rather than in the script because getting it wrong fails silently, and did: `--key` takes a
 * value that does not begin with a dash, so picking the file by looking for the first non-flag
 * argument reads the pasted key record as the message to open. Parsing it in one pass is what makes
 * that impossible, and testable without running the script.
 *
 * Throws on a malformed `--key`, with the usage line the script prints.
 */
export const parseMailArgs = (args = []) => {
  const overrides = new Map();
  let file = null;

  const addOverride = pair => {
    const split = String(pair ?? '').indexOf('=');
    const name = split === -1 ? '' : String(pair).slice(0, split);
    const record = split === -1 ? '' : String(pair).slice(split + 1);
    const parsed = /^([^._][^.]*)\._domainkey\.(.+)$/.exec(name);
    if (!parsed) {
      throw new Error(`--key takes <selector>._domainkey.<domain>=<TXT record>; got ${pair || '(nothing)'}`);
    }
    overrides.set(`${parsed[2].toLowerCase()}|${parsed[1]}`, record);
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--key') {
      addOverride(args[index + 1]);
      index += 1; // its value is not the message
      continue;
    }
    if (argument.startsWith('--key=')) {
      addOverride(argument.slice('--key='.length));
      continue;
    }
    if (argument.startsWith('-')) continue;
    if (file === null) file = argument;
  }

  return { file, overrides };
};

/**
 * DMARC, as the receiver reported it or as it follows from their method results.
 *
 * `pass` here is never inferred from the presence of a signature: only from an aligned `dkim=pass`
 * or `spf=pass`. When the receiver wrote its own `dmarc=` line, that line is returned untouched and
 * labelled as reported.
 */
export const dmarcVerdict = inspection => {
  const {
    dmarcReport,
    dkimReports,
    spfReport,
    spf,
    spfAlignment,
    fromDomain,
    /** From `src/dkim-verify.js`: signatures this tool verified itself, not ones a receiver vouched for. */
    verifiedSignatures = [],
  } = inspection;

  if (dmarcReport) {
    return {
      result: dmarcReport.result,
      policy: dmarcReport.props.p ?? null,
      subdomainPolicy: dmarcReport.props.sp ?? null,
      source: dmarcReport.receiver ? `reported by ${dmarcReport.receiver}` : 'reported',
    };
  }
  if (!fromDomain) return { result: null, policy: null, source: 'unknown' };

  // Proof before testimony: a signature checked here against the published key is stronger than a
  // receiver's word, so it answers first when no `dmarc=` result was reported.
  const proof = verifiedSignatures.find(signature => signature.verified && signature.alignment?.relaxed);
  if (proof) {
    return { result: 'pass', policy: null, source: `computed from a DKIM signature verified here (d=${proof.d})` };
  }

  const alignedDkim = dkimReports.find(report => report.result === 'pass' && report.alignment.relaxed);
  if (alignedDkim) return { result: 'pass', policy: null, source: `computed from dkim=pass (d=${alignedDkim.domain})` };

  const spfPass = (spfReport?.result ?? spf?.result) === 'pass';
  if (spfPass && spfAlignment.relaxed) {
    return { result: 'pass', policy: null, source: `computed from spf=pass (${inspection.spfIdentity})` };
  }

  return {
    result: null,
    policy: null,
    source: 'computed: no aligned pass reported',
  };
};
