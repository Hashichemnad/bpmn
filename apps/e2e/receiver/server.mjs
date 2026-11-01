// Webhook test receiver for local / CI Docker Compose (Phase 4.4): records every POST (path,
// headers, raw body) and lists them at GET /received; DELETE /received clears the list. Dev and
// test only — never deploy it. ProcessHub reaches it as http://webhook-receiver:8090 (the host is
// in OUTBOUND_ALLOWED_HOSTS of docker-compose.yml); Playwright reads it on localhost:8090.
import { createServer } from 'node:http';

const received = [];
createServer((req, res) => {
  if (req.url === '/received' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(received));
  }
  if (req.url === '/received' && req.method === 'DELETE') {
    received.length = 0;
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body, at: new Date().toISOString() });
    if (received.length > 500) received.shift();
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
}).listen(8090);
