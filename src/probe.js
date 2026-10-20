/**
 * One HTTPS request, read off the socket, with the certificate that carried it.
 *
 * Written by hand for one reason: the provider answering this domain today ends its header lines
 * with a bare newline, which `fetch` and `https.get` both refuse to parse. Refusing to read it
 * would leave a check saying "the request failed" about a server that answered perfectly clearly.
 * What arrives instead is reported as what it is — a status, a destination, and whether the bytes
 * were an HTTP response at all.
 *
 * TLS is not bypassed to get there. `rejectUnauthorized` stays on, so a certificate covering the
 * wrong name or signed by nobody trusted fails the connection, and the error is handed back with
 * its code rather than smoothed into a message. That is the same warning a browser would show, and
 * the whole point of asking the alias a question is that the answer has to be reachable.
 *
 * `address` and `port` exist for the tests, which run a loopback server holding a certificate for
 * the alias name: they cannot make DNS point elsewhere, so they point the connection instead. The
 * name in the URL is still what TLS verifies and what goes in `Host`.
 */
import { connect } from 'node:tls';

/**
 * De-frame a chunked body: GitHub sends one, and a comparison is on bytes, not on framing.
 */
export const dechunk = buffer => {
  const parts = [];
  let at = 0;
  while (at < buffer.length) {
    const end = buffer.indexOf('\r\n', at);
    if (end === -1) break;
    const size = Number.parseInt(buffer.subarray(at, end).toString('latin1'), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    parts.push(buffer.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return Buffer.concat(parts);
};

export const probe = (url, { port = 443, address, ca, timeout = 20_000 } = {}) => new Promise((resolve, reject) => {
  const { hostname, pathname, search } = new URL(url);
  let certificate;
  const socket = connect({ host: address ?? hostname, servername: hostname, port, ca }, () => {
    // The certificate the browser would have been shown: the chain and the name were checked to
    // get this far, so what is left to report is who issued it and when it runs out.
    certificate = socket.getPeerCertificate();
    socket.write(`GET ${pathname}${search} HTTP/1.1\r\n`
      + `Host: ${hostname}\r\n`
      + 'User-Agent: glam-team-cleaners domain check\r\n'
      + 'Accept: */*\r\n'
      + 'Connection: close\r\n\r\n');
  });
  const chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  socket.on('end', () => {
    const raw = Buffer.concat(chunks);
    // Headers end at the first blank line, in whichever line-ending convention the server used.
    const crlf = raw.indexOf('\r\n\r\n');
    const lf = raw.indexOf('\n\n');
    const boundary = crlf !== -1 ? crlf + 4 : lf !== -1 ? lf + 2 : raw.length;
    const lines = raw.subarray(0, boundary).toString('latin1').split(/\r?\n/);
    const header = name => lines
      .map(line => new RegExp(`^${name}:\\s*(.+)$`, 'i').exec(line.trim())?.[1]?.trim())
      .find(Boolean);
    resolve({
      status: Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(lines[0]?.trim() ?? '')?.[1]),
      location: header('location'),
      chunked: /chunked/i.test(header('transfer-encoding') ?? ''),
      body: raw.subarray(boundary),
      certificate,
    });
  });
  socket.on('error', reject);
  socket.setTimeout(timeout, () => socket.destroy(new Error('no answer within 20s')));
});
