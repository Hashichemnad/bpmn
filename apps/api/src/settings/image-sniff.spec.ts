import { sanitizeSvg, sniffImageType } from './image-sniff';

describe('sniffImageType', () => {
  it('detects png, jpeg, webp and svg by content', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe('image/svg+xml');
  });
  it('rejects other content', () => {
    expect(sniffImageType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('sanitizeSvg', () => {
  it('removes scripts and event handlers', () => {
    const out = sanitizeSvg(
      '<svg onload="alert(1)"><script>alert(2)</script><rect width="1"/></svg>',
    );
    expect(out).not.toContain('script');
    expect(out).not.toContain('onload');
    expect(out).toContain('<rect');
  });

  it('removes links, animations, foreign content and external references', () => {
    const vectors = [
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
      '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
      '<svg><foreignObject><iframe src="javascript:alert(1)"/></foreignObject></svg>',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      '<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>',
      '<svg><style>@import url(https://evil.example/x.css); rect{fill:url("https://evil.example/y")}</style></svg>',
      '<svg><rect style="fill:url(https://evil.example/x)"/></svg>',
    ];
    for (const v of vectors) {
      const out = sanitizeSvg(v);
      expect(out).not.toMatch(/javascript:|evil\.example|foreignObject|iframe|<use|<animate|<set/i);
    }
    // In-document references (gradients) keep working.
    expect(sanitizeSvg('<svg><rect style="fill:url(#g)"/></svg>')).toContain('url(#g)');
  });
});
