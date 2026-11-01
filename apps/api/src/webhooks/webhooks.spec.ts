import { createHmac } from 'node:crypto';
import { DEFAULT_WEBHOOK_SETTINGS, hostMatches } from '@processhub/shared';
import { OutboundPolicy } from '../common/outbound';
import { checkDestination, displayUrl } from './destination-guard';
import { buildPayload, cardText, teamsCard } from './payloads';
import { generateWebhookSecret, signWebhook, verifyWebhook } from './webhook-signature';

describe('webhook signatures', () => {
  it('signs <timestamp>.<body> with HMAC-SHA256 and verifies within the tolerance', () => {
    const secret = generateWebhookSecret();
    const body = '{"a":1}';
    const ts = 1_800_000_000;
    const sig = signWebhook(secret, ts, body);
    expect(sig).toBe(
      `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`,
    );
    expect(verifyWebhook(secret, String(ts), sig, body, 300, ts * 1000 + 1000)).toBe(true);
    expect(verifyWebhook(secret, String(ts), sig, body, 300, ts * 1000 + 301_000)).toBe(false);
    expect(verifyWebhook('whsec_other', String(ts), sig, body, 300, ts * 1000)).toBe(false);
    expect(verifyWebhook(secret, 'abc', sig, body)).toBe(false);
    expect(verifyWebhook(secret, String(ts), undefined, body)).toBe(false);
  });
});

describe('destination guard (SSRF)', () => {
  const policy = new OutboundPolicy([]);
  const settings = DEFAULT_WEBHOOK_SETTINGS;
  const code = async (url: string, kind: 'WEBHOOK' | 'TEAMS' = 'WEBHOOK', s = settings) => {
    try {
      await checkDestination(url, kind, s, policy);
      return 'OK';
    } catch (e) {
      return (e as { code: string }).code;
    }
  };

  it.each([
    ['https://127.0.0.1/x', 'WEBHOOK_HOST_BLOCKED'],
    ['https://169.254.169.254/latest', 'WEBHOOK_HOST_BLOCKED'],
    ['https://192.168.1.10/x', 'WEBHOOK_HOST_BLOCKED'],
    ['https://[fd00::1]/x', 'WEBHOOK_HOST_BLOCKED'],
    ['https://[::ffff:a9fe:a9fe]/x', 'WEBHOOK_HOST_BLOCKED'],
    ['https://2130706433/x', 'WEBHOOK_HOST_BLOCKED'],
    ['http://8.8.8.8/x', 'HTTPS_URL_REQUIRED'],
    ['ftp://8.8.8.8/x', 'HTTPS_URL_REQUIRED'],
    ['https://u:p@8.8.8.8/x', 'WEBHOOK_URL_INVALID'],
    ['not a url', 'WEBHOOK_URL_INVALID'],
    ['https://8.8.8.8/x', 'OK'],
  ])('%s → %s', async (url, expected) => expect(await code(url)).toBe(expected));

  it('applies the allow-lists: Teams hosts by default, optional list for webhooks', async () => {
    expect(await code('https://8.8.8.8/x', 'TEAMS')).toBe('WEBHOOK_HOST_NOT_ALLOWED');
    expect(
      await code('https://8.8.8.8/x', 'WEBHOOK', {
        ...settings,
        allowedHosts: ['hooks.example.com'],
      }),
    ).toBe('WEBHOOK_HOST_NOT_ALLOWED');
    expect(hostMatches('prod-01.westeurope.logic.azure.com', '*.logic.azure.com')).toBe(true);
    expect(hostMatches('logic.azure.com.evil.com', '*.logic.azure.com')).toBe(false);
    expect(hostMatches('evillogic.azure.com', '*.logic.azure.com')).toBe(false);
    expect(hostMatches('hooks.example.com', 'hooks.example.com')).toBe(true);
  });

  it('allows plain http and internal hosts only through OUTBOUND_ALLOWED_HOSTS', async () => {
    const allow = new OutboundPolicy(['receiver']);
    await expect(
      checkDestination('http://receiver:9000/x', 'WEBHOOK', settings, allow, { resolve: false }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('hides the query string (Teams signature) in the displayed URL', () => {
    expect(
      displayUrl(
        new URL('https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SECRET'),
      ),
    ).toBe('https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?…');
  });
});

describe('payloads and Teams cards', () => {
  const event = {
    type: 'integration' as const,
    event: 'process.published' as const,
    entity: {
      type: 'PROCESS',
      id: 'p1',
      code: 'C.01',
      nameEn: 'Pay [me](https://evil.example)',
      nameAr: 'دفع الفواتير',
    },
    departmentId: null,
    processId: 'p1',
    link: '/processes/p1',
    data: { version: 3 },
  };

  it('builds the generic payload with absolute links', () => {
    const p = buildPayload(event, 'https://ph.example.com', 'e1', new Date('2026-11-01T00:00:00Z'));
    expect(p).toEqual({
      id: 'e1',
      type: 'process.published',
      occurredAt: '2026-11-01T00:00:00.000Z',
      entity: {
        type: 'PROCESS',
        id: 'p1',
        code: 'C.01',
        nameEn: 'Pay [me](https://evil.example)',
        nameAr: 'دفع الفواتير',
      },
      links: {
        app: 'https://ph.example.com/processes/p1',
        portal: 'https://ph.example.com/portal/processes/p1',
        api: 'https://ph.example.com/api/public/v1/processes/p1',
      },
      data: { version: 3 },
    });
  });

  it('neutralises links, control and bidi characters in card texts', () => {
    expect(cardText('Pay [me](https://evil.example)')).toBe('Pay [me] (https://evil.example)');
    expect(cardText('a‮b\u0000c\nd')).toBe('a b c d');
    expect(cardText('- list')).toBe('- list');
    expect(cardText('x'.repeat(400))).toHaveLength(300);
  });

  it('renders an Adaptive Card per language; Arabic right to left', () => {
    const payload = buildPayload(event, 'https://ph.example.com');
    const both = teamsCard({ ...payload, owner: { nameEn: 'Omar', nameAr: 'عمر' } }, 'BOTH');
    const card = both.attachments[0].content;
    expect(card.version).toBe('1.5');
    expect(card.body).toHaveLength(2);
    expect(card.body[1].rtl).toBe(true);
    const text = JSON.stringify(card);
    expect(text).toContain('دفع الفواتير');
    expect(text).toContain('عمر');
    expect(text).not.toContain('](https://evil');
    expect(card.actions.map((a: { url: string }) => a.url)).toEqual([
      'https://ph.example.com/processes/p1',
      'https://ph.example.com/portal/processes/p1',
    ]);
    const ar = teamsCard({ ...payload, owner: null }, 'AR').attachments[0].content;
    expect(ar.rtl).toBe(true);
    expect(ar.body).toHaveLength(1);
    expect(ar.actions[0].title).toBe('فتح في ProcessHub');
  });
});
