/**
 * DKIM discovery, held to what it must find and — more importantly — what it must not.
 *
 * The failure this file is about is quiet. A selector sweep that treats a failed lookup as "no
 * key" loses the record during the move, and nothing says so until mail starts failing
 * authentication weeks later; a parser that accepts any `p=` would copy a blank key, which is worse
 * than a missing one because it looks configured. So the fake resolver here fails on purpose, and
 * the keys are real — generated in the test — rather than strings that merely look like base64.
 *
 * No network: `discoverDkim` takes its resolvers, so the sweep can be judged in milliseconds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  CONVENTIONAL_SELECTORS,
  dkimCandidates,
  dkimKey,
  dkimName,
  discoverDkim,
  publishedKey,
  keyBits,
  selectorsFrom,
} from '../src/dkim.js';
import { dkimRecords } from '../src/cloudflare.js';
import { HOST } from '../src/dns.js';

/** A real RSA key of the given size, in the exact shape a DKIM `p=` carries. */
const keyFor = bits => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
};

/** A resolver that answers from a map and fails like DNS does for everything else. */
const fake = entries => {
  const calls = [];
  const resolve = async name => {
    calls.push(name);
    const value = entries[name];
    if (value === undefined) {
      const missing = new Error(`no TXT for ${name}`);
      missing.code = 'ENODATA';
      throw missing;
    }
    if (typeof value === 'function') return value(name, calls.length);
    return value;
  };
  return { resolve, calls };
};

const noAlias = async () => {
  const missing = new Error('no CNAME');
  missing.code = 'ENODATA';
  throw missing;
};

test('the sweep asks every conventional selector, plus any named by hand', () => {
  assert.equal(CONVENTIONAL_SELECTORS.length, 153, 'the number the runbook reports is the number run');
  const candidates = dkimCandidates(HOST, ['exotic']);

  assert.equal(candidates[0].selector, 'exotic', 'a selector from the panel is asked first');
  assert.equal(candidates.length, 154);
  assert.ok(candidates.some(({ name }) => name === `default._domainkey.${HOST}`));
  assert.ok(candidates.every(({ name }) => name.endsWith(`._domainkey.${HOST}`)), 'never the apex');
  assert.equal(new Set(candidates.map(({ name }) => name)).size, candidates.length, 'no name asked twice');
});

test('a selector is read from a flag, an env value, or a pasted record name', () => {
  assert.deepEqual(selectorsFrom(['--selector', 'exotic']), ['exotic']);
  assert.deepEqual(selectorsFrom(['--selector=one,two']), ['one', 'two']);
  assert.deepEqual(selectorsFrom(['--selector', 'a', '--selector', 'b']), ['a', 'b']);
  assert.deepEqual(selectorsFrom([], 'from-panel'), ['from-panel']);
  assert.deepEqual(
    selectorsFrom([`--selector=${dkimName('pasted', HOST)}`]),
    ['pasted'],
    'a record name copied from a panel is reduced to its selector',
  );
});

test('a key split across TXT chunks is joined; anything that is not a key is refused', () => {
  const key = keyFor(2048);
  const chunks = [key.slice(0, 255), key.slice(255)];
  assert.equal(dkimKey(chunks), key, 'a 255-byte split is how a long key arrives, not a broken record');

  assert.equal(dkimKey([`v=spf1 a mx include:spf.postal.${HOST} ~all`]), null, 'SPF is not a key');
  assert.equal(dkimKey(['v=DKIM1; k=rsa; p=']), null, 'a blank p= is a revoked key, not a key to copy');
  assert.equal(dkimKey(['google-site-verification=abc123']), null);
  assert.equal(dkimKey(['v=DKIM1; k=rsa; p=abc']), null, 'sixteen base64 characters is the floor for a real key');
});

test('the key size is the modulus, not the size of its encoding', () => {
  assert.equal(keyBits(keyFor(1024)), 1024);
  assert.equal(keyBits(keyFor(2048)), 2048, 'a 2048-bit key must not be reported as 2352');
  assert.equal(keyBits('v=DKIM1; k=rsa; p=not-base64!!'), null);
});

test('a published key is found, under the name its selector puts it at', async () => {
  const key = keyFor(2048);
  const { resolve } = fake({ [dkimName('default', HOST)]: [[key]] });
  const report = await discoverDkim(HOST, { resolve, resolveAlias: noAlias });

  assert.equal(report.found.length, 1);
  assert.deepEqual(
    { ...report.found[0], key: report.found[0].key.length },
    { selector: 'default', name: `default._domainkey.${HOST}`, key: key.length, bits: 2048 },
  );
  assert.equal(report.tried.length, 153);
});

test('a named selector outside the conventions is asked, and found', async () => {
  const key = keyFor(1024);
  const { resolve, calls } = fake({ [dkimName('panel-name', HOST)]: [[key]] });
  const report = await discoverDkim(HOST, { selectors: ['panel-name'], resolve, resolveAlias: noAlias });

  assert.ok(calls.includes(dkimName('panel-name', HOST)));
  assert.equal(report.found[0].selector, 'panel-name');
  assert.equal(report.found[0].bits, 1024);
});

test('a failed lookup is retried, and is never read as an absent key', async () => {
  const key = keyFor(2048);
  const name = dkimName('default', HOST);
  let attempts = 0;
  const { resolve } = fake({
    [name]: () => {
      attempts += 1;
      if (attempts === 1) {
        const failure = new Error('temporary failure in name resolution');
        failure.code = 'SERVFAIL';
        throw failure;
      }
      return [[key]];
    },
  });

  const report = await discoverDkim(HOST, { resolve, resolveAlias: noAlias });
  assert.equal(attempts, 2, 'a transient failure gets one more try');
  assert.equal(report.found.length, 1, 'the retry keeps the key that a naive sweep would have dropped');
});

test('a resolver that keeps failing stops the move instead of reporting no key', async () => {
  const { resolve } = fake({
    [dkimName('default', HOST)]: () => {
      const failure = new Error('temporary failure in name resolution');
      failure.code = 'SERVFAIL';
      throw failure;
    },
  });

  await assert.rejects(
    discoverDkim(HOST, { resolve, resolveAlias: noAlias }),
    /default\._domainkey\..* could not be read: SERVFAIL/,
    'an unanswered lookup is not an empty zone',
  );
});

test('delegation and a key at the apex are reported, not silently ignored', async () => {
  const key = keyFor(2048);
  const alias = async name => (name === `*._domainkey.${HOST}` ? [`dkim.somewhere.example`] : []);

  const report = await discoverDkim(HOST, {
    resolve: fake({ [HOST]: [['v=spf1 ~all'], [key]] }).resolve,
    resolveAlias: alias,
  });

  assert.deepEqual(report.delegated, [`*._domainkey.${HOST} → dkim.somewhere.example`]);
  assert.equal(report.found.length, 0, 'the apex is not a place DKIM looks');
  assert.equal(report.misplaced.length, 1);
  assert.match(report.misplaced[0], /^v=DKIM1/);
});

test('a single selector can be asked on its own, as a signature header needs', async () => {
  const key = keyFor(2048);
  const name = dkimName('default', HOST);
  const found = await publishedKey(HOST, 'default', { resolve: fake({ [name]: [[key]] }).resolve });

  assert.deepEqual(
    { ...found, key: found.key.length },
    { selector: 'default', name, key: key.length, bits: 2048 },
  );
  assert.equal(
    await publishedKey(HOST, 'other', { resolve: fake({}).resolve }),
    null,
    'no key is null, not an exception: the caller reports "not published"',
  );
});

test('found keys become the TXT records Cloudflare holds', () => {
  const key = keyFor(2048);
  assert.deepEqual(dkimRecords(HOST, [{ selector: 'default', key }]), [{
    type: 'TXT',
    name: `default._domainkey.${HOST}`,
    content: key,
    ttl: 1,
  }]);

  assert.deepEqual(dkimRecords(HOST, []), [], 'nothing is fabricated when nothing was published');
});
