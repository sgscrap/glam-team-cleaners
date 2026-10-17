/**
 * The DNS records, held to the values GitHub documents.
 *
 * `src/dns.js` is the single owner of the addresses the domain check compares against, which is
 * the right shape for the check and the wrong shape for a mistake: a wrong address there would be
 * wrong in the zone file and in the check at once, and both would agree. So the documented values
 * are spelled out here, as literals, where they can disagree.
 *
 * Nothing here touches the network. Whether the domain currently holds these records is a
 * question for `npm run domain`, which asks the DNS; this asks only whether the file the repo
 * publishes is the one somebody meant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOST, LINK_HOST, PAGES_A, PAGES_AAAA, PAGES_DOMAIN, ZONE_FILE, zoneFile } from '../src/dns.js';
import { site } from '../src/data.js';

/** GitHub's four addresses for an apex domain, from "Managing a custom domain for your GitHub
    Pages site". An apex domain needs at least one A record; GitHub publishes four. */
const DOCUMENTED_A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const DOCUMENTED_AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];

/** The address the zone currently answers with — a forward, and not part of any fix. */
const FORWARDER = '66.223.49.89';

const zone = zoneFile();
/** The records, without the commentary that explains them. */
const records = zone.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith(';'));

test('the apex records are the ones GitHub documents', () => {
  assert.deepEqual(PAGES_A, DOCUMENTED_A, 'a wrong A record sends the domain somewhere nothing answers');
  assert.deepEqual(PAGES_AAAA, DOCUMENTED_AAAA);
  assert.equal(PAGES_DOMAIN, 'sgscrap.github.io', 'the CNAME target is the Pages default domain, without the repository name');
});

test('the zone is written for the host the site publishes', () => {
  assert.equal(HOST, new URL(site.url).hostname, 'the domain under test and the canonical host must be one value');
  assert.equal(HOST, 'glamcleaners.net');
  assert.equal(`$ORIGIN ${HOST}.`, records[0], 'a zone file without $ORIGIN is applied to whatever zone it lands in');
});

test('the zone carries the apex, www and links records, and nothing else', () => {
  const apex = records.filter(line => line.startsWith('@ '));
  assert.equal(apex.length, 8, 'four A and four AAAA records, no more');
  for (const address of [...DOCUMENTED_A, ...DOCUMENTED_AAAA]) {
    assert.ok(apex.some(line => line.endsWith(address)), `${address} is missing from the apex`);
  }
  const www = records.filter(line => line.startsWith('www '));
  assert.deepEqual(www, [`www     IN  CNAME  ${PAGES_DOMAIN}.`], 'www is a CNAME, and a CNAME cannot sit beside an A record');

  // The link page's own host. It points at the Pages default domain like www does, because it is a
  // second Pages site: GitHub gives each site one custom domain, so a bare subdomain cannot ride
  // on the first site's.
  assert.equal(LINK_HOST, 'links.glamcleaners.net');
  assert.equal(LINK_HOST, `links.${HOST}`, 'the subdomain is this domain, not a lookalike');
  const links = records.filter(line => line.startsWith('links '));
  assert.equal(links.length, 1, 'exactly one record for the subdomain');
  assert.match(links[0], /^links\s+IN\s+CNAME\s+sgscrap\.github\.io\.$/, 'a CNAME, not an A record GitHub would not answer on');
});

test('the zone describes no forward and no wildcard', () => {
  assert.ok(!records.some(line => line.includes(FORWARDER)), 'the forwarder is the fault, not part of the fix');
  assert.ok(!records.some(line => line.startsWith('*')), 'a wildcard would answer for every subdomain, which is how links. resolved to the forwarder');
});

test('the committed zone is what the generator emits', () => {
  assert.equal(
    readFileSync(new URL(`../${ZONE_FILE}`, import.meta.url), 'utf8'),
    zone,
    `regen: npm run build — ${ZONE_FILE} is generated from src/dns.js`,
  );
});
