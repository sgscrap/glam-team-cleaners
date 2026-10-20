/**
 * The alias, end to end, against a server that behaves the way Cloudflare's rule should.
 *
 * The zone is not on Cloudflare yet, so the live check cannot pass anywhere — and a check written
 * for that day and never run is a check that will fail on the one day it matters. So this starts a
 * real HTTPS server on loopback holding a real certificate for the alias name, answers with the
 * 301 the rule is configured to send, and takes `src/alias.js` and `src/probe.js` through the whole
 * path: TLS verification, header parsing, the query string, and the verdict.
 *
 * The certificate is minted per run by `openssl` into the system temp directory rather than
 * committed. A private key in a public repository is a secret-scanning alert waiting to be
 * dismissed, even when it signs nothing but a loopback server that lives for one test; a machine
 * without openssl reports the TLS tests as skipped instead, so the gap is visible rather than
 * silently green.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aliasForms, redirectVerdict, tlsVerdict } from '../src/alias.js';
import { LINK_HOST } from '../src/dns.js';
import { LINKS_URL } from '../src/links.js';
import { dechunk, probe } from '../src/probe.js';

const openssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

/** One throwaway certificate for the alias name, made once and shared by the loopback servers. */
let mintedDirectory;
const mint = (() => {
  let made;
  return () => {
    if (made) return made;
    const dir = mkdtempSync(join(tmpdir(), 'alias-tls-'));
    mintedDirectory = dir;
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-days', '3650',
      '-subj', `/CN=${LINK_HOST}`,
      '-addext', `subjectAltName=DNS:${LINK_HOST}`,
    ], { stdio: 'ignore' });
    made = {
      dir,
      key: readFileSync(join(dir, 'key.pem')),
      cert: readFileSync(join(dir, 'cert.pem')),
    };
    return made;
  };
})();

after(() => {
  if (mintedDirectory) rmSync(mintedDirectory, { recursive: true, force: true });
});

/** The rule, in miniature: one 301 to the canonical page, carrying the query and nothing else. */
const rule = (request, response) => {
  const { search } = new URL(request.url, `https://${LINK_HOST}`);
  response.writeHead(301, { location: `${LINKS_URL}${search}` });
  response.end();
};

/** A server on loopback, for the length of one test. */
const serving = async t => {
  const { key, cert } = mint();
  const server = createServer({ key, cert }, rule);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  return { port, trusted: { address: '127.0.0.1', port, ca: cert } };
};

test('every form of the alias is a 301 to the one address, over a trusted certificate', async t => {
  if (!openssl) return t.skip('openssl is not installed, so no certificate can be minted for the loopback server');

  const { trusted } = await serving(t);

  for (const form of aliasForms()) {
    const response = await probe(form.url, trusted);
    assert.equal(response.status, 301, `${form.form}: ${form.url}`);
    assert.deepEqual(
      redirectVerdict(form.expected, response),
      { ok: true, text: `301 ${form.expected}` },
      `${form.form} must arrive at ${form.expected}`,
    );
    const tls = tlsVerdict({ certificate: response.certificate });
    assert.equal(tls.ok, true, `${form.form} must be reachable without a warning: ${tls.why}`);
    assert.match(tls.text, /trusted certificate from/);
  }
});

test('the query string is on the wire, not only in the expectation', async t => {
  if (!openssl) return t.skip('openssl is not installed, so no certificate can be minted for the loopback server');

  const { trusted } = await serving(t);
  const response = await probe(`https://${LINK_HOST}/?utm_source=bio&utm_medium=social`, trusted);
  assert.equal(response.location, 'https://glamcleaners.net/links/?utm_source=bio&utm_medium=social');
});

test('an untrusted certificate is a warning, not a failed request', async t => {
  if (!openssl) return t.skip('openssl is not installed, so no certificate can be minted for the loopback server');

  const { port } = await serving(t);

  await assert.rejects(
    probe(`https://${LINK_HOST}/`, { address: '127.0.0.1', port }),
    error => {
      const verdict = tlsVerdict({ error });
      assert.equal(verdict.ok, false);
      assert.match(verdict.why, /browser shows a warning/, `said instead: ${verdict.why}`);
      return true;
    },
  );
});

test('a chunked body is de-framed before it is compared', () => {
  const framed = Buffer.from('10\r\n0123456789abcdef\r\n5\r\nxxxxx\r\n0\r\n\r\n');
  assert.equal(dechunk(framed).toString(), '0123456789abcdefxxxxx');
});
