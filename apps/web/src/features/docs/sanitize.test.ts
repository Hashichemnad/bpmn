import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('removes scripts, event handlers and javascript: links', () => {
    expect(
      sanitizeHtml(
        '<p onmouseover="x()">a<script>alert(1)</script><a href="javascript:alert(1)">b</a><img src=x onerror=alert(1)></p>',
      ),
    ).toBe('<p>a<a>b</a></p>');
  });

  it('keeps editor markup and marks external links', () => {
    const out = sanitizeHtml(
      '<div data-type="callout" data-callout="warning"><p dir="rtl">نص</p></div><a href="https://x.org">x</a>',
    );
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain('<p dir="rtl">نص</p>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
});
