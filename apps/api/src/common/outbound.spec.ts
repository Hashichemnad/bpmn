import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isInternalAddress, OutboundBlockedError, OutboundPolicy } from './outbound';
import { GitHttp } from '../integrations/providers/git-http';
import { MailTransport } from '../notifications/mail-transport';
import { loadConfig } from '../config/config';

const config = (allowed = '') =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://x@localhost/x',
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    GIT_HTTP_TIMEOUT_MS: '3000',
    SMTP_TIMEOUT_MS: '3000',
    OUTBOUND_ALLOWED_HOSTS: allowed,
  });

describe('isInternalAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isInternalAddress(ip)).toBe(true));

  it.each(['140.82.112.3', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => expect(isInternalAddress(ip)).toBe(false),
  );

  it('never treats a non-address as safe', () => {
    expect(isInternalAddress('localhost')).toBe(true);
  });
});

describe('OutboundPolicy', () => {
  it('rejects internal IP literals and host names that resolve to them', async () => {
    const policy = new OutboundPolicy([]);
    await expect(policy.resolve('127.0.0.1')).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(policy.resolve('[::1]')).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(policy.resolve('localhost')).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(policy.resolve('169.254.169.254')).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('allows listed host names, addresses and ranges', async () => {
    await expect(new OutboundPolicy(['LocalHost']).resolve('localhost')).resolves.toBeDefined();
    await expect(new OutboundPolicy(['127.0.0.1']).resolve('127.0.0.1')).resolves.toEqual({
      address: '127.0.0.1',
      family: 4,
    });
    const range = new OutboundPolicy(['10.0.0.0/8']);
    expect(() => range.check('git.internal', ['10.9.8.7'])).not.toThrow();
    expect(() => range.check('git.internal', ['10.9.8.7', '192.168.0.1'])).toThrow(
      OutboundBlockedError,
    );
  });

  it('allows public addresses', () => {
    expect(() => new OutboundPolicy([]).check('github.com', ['140.82.112.3'])).not.toThrow();
  });
});

describe('Git and SMTP connections apply the policy', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('GitHttp refuses internal servers and plain http by default', async () => {
    const http = new GitHttp(config());
    await expect(http.request(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({
      code: 'GIT_HOST_BLOCKED',
    });
    await expect(http.request(`https://127.0.0.1:${port}/`)).rejects.toMatchObject({
      code: 'GIT_HOST_BLOCKED',
    });
    await expect(http.request(`https://localhost:${port}/`)).rejects.toMatchObject({
      code: 'GIT_HOST_BLOCKED',
    });
  });

  it('GitHttp reaches allowed hosts and never follows redirects', async () => {
    const http = new GitHttp(config('127.0.0.1'));
    const ok = await http.request(`http://127.0.0.1:${port}/`);
    expect(ok).toMatchObject({ status: 200, body: { ok: true } });
    const redirect = await http.request(`http://127.0.0.1:${port}/redirect`);
    expect(redirect.status).toBe(302);
  });

  it('MailTransport refuses internal SMTP hosts unless allowed', async () => {
    const smtp = {
      host: 'localhost',
      port,
      secure: false,
      username: '',
      password: null,
      fromAddress: 'a@b.c',
      fromName: '',
    };
    const msg = { to: 'x@y.z', subject: 's', html: 'h', text: 't' };
    await expect(new MailTransport(config()).send(smtp, msg)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    // Allowed: the connection is attempted (the HTTP test server is not an SMTP server).
    const err = await new MailTransport(config('localhost')).send(smtp, msg).catch((e) => e);
    expect(err).not.toBeInstanceOf(OutboundBlockedError);
  });
});
