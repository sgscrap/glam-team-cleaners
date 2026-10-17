/**
 * The zone as Cloudflare will hold it, held to the zone file this repository ships.
 *
 * The migration is a one-way door — once the registrar points elsewhere, the old zone is gone — and
 * the two ways it can go wrong are quiet: an orange cloud on the Pages records (GitHub can then
 * never verify its certificate) and a mail record transcribed by hand that no longer matches what
 * the domain answers. So the site records are compared with `dns/glamcleaners.net.zone`, and the
 * mail mapping is checked against the shape a DNS resolver actually returns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOST, PAGES_DOMAIN, ZONE_FILE } from '../src/dns.js';
import { dmarcRecords, mailRecords, obsoleteWebRecords, webRecords } from '../src/cloudflare.js';

const records = webRecords();
const addressable = records.filter(record => record.type === 'A' || record.type === 'AAAA');

test('every site record is DNS only, because GitHub has to answer for it', () => {
  for (const record of records) {
    assert.equal(record.proxied, false, `${record.type} ${record.name} must not be proxied`);
    assert.equal(record.ttl, 1, 'auto TTL, so no stale TTL outlives the migration');
  }
});

test('the site records are the ones the zone file lists', () => {
  const zone = readFileSync(new URL(`../${ZONE_FILE}`, import.meta.url), 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith(';') && !line.startsWith('$'));

  const fromZone = zone.map(line => {
    const [name, , type, value] = line.split(/\s+/);
    return `${type} ${name === '@' ? HOST : `${name}.${HOST}`} ${value.replace(/\.$/, '')}`;
  }).sort();
  const fromCloudflare = records.map(record => `${record.type} ${record.name} ${record.content}`).sort();

  assert.deepEqual(fromCloudflare, fromZone, 'the panel file and the API move must describe one zone');
});

test('the apex carries GitHub\'s four addresses over both protocols', () => {
  assert.equal(addressable.length, 8);
  assert.equal(addressable.filter(record => record.type === 'A').length, 4);
  assert.equal(addressable.filter(record => record.type === 'AAAA').length, 4);
  assert.ok(records.filter(record => record.type === 'CNAME')
    .every(record => record.content === PAGES_DOMAIN), 'both names point at the Pages default domain');
  assert.deepEqual(
    records.filter(record => record.type === 'CNAME').map(record => record.name).sort(),
    [`links.${HOST}`, `www.${HOST}`],
  );
});

test('the move removes the forward, the wildcard, and nothing else', () => {
  // What Cloudflare imports when the zone is added: the forwarder's address, the wildcard behind
  // it, and the records that are not this site's business.
  const imported = [
    { id: '1', type: 'A', name: HOST, content: '66.223.49.89' },
    { id: '2', type: 'A', name: `*.${HOST}`, content: '66.223.49.89' },
    { id: '3', type: 'A', name: `mail.${HOST}`, content: '66.223.100.94' },
    { id: '4', type: 'MX', name: HOST, content: 'mailserver.businessidentity.llc' },
    { id: '5', type: 'TXT', name: HOST, content: 'v=spf1 a mx ~all' },
    { id: '6', type: 'TXT', name: HOST, content: 'google-site-verification=abc' },
    ...webRecords().map((record, index) => ({ ...record, id: `new-${index}` })),
  ];

  assert.deepEqual(
    obsoleteWebRecords(imported, webRecords()).map(record => record.id),
    ['1', '2'],
    'the forwarder and the wildcard go; a mail host, MX and TXT records stay',
  );
});

test('mail moves with the domain', () => {
  // What node:dns returns for resolveTxt: a list of records, each a list of strings.
  const mx = [{ exchange: 'mailserver.businessidentity.llc', priority: 10 }];
  const spf = [['v=spf1 a mx include:spf.postal.businessidentity.llc ~all']];
  const records = mailRecords(mx, spf);

  assert.deepEqual(records[0], {
    type: 'MX',
    name: HOST,
    content: 'mailserver.businessidentity.llc',
    priority: 10,
    ttl: 1,
  }, 'priority 10 is part of the record, and losing it reroutes the mailbox');
  assert.deepEqual(records[1], {
    type: 'TXT',
    name: HOST,
    content: 'v=spf1 a mx include:spf.postal.businessidentity.llc ~all',
    ttl: 1,
  }, 'SPF is flattened from the TXT chunks a resolver returns');

  assert.deepEqual(dmarcRecords([['v=DMARC1; p=quarantine; fo=1']]), [{
    type: 'TXT',
    name: `_dmarc.${HOST}`,
    content: 'v=DMARC1; p=quarantine; fo=1',
    ttl: 1,
  }], 'DMARC belongs under _dmarc, not at the apex');
});
