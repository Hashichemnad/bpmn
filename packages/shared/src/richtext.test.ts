import { describe, expect, it } from 'vitest';
import {
  embeddedProcessIds,
  hasRichContent,
  isAllowedHref,
  isAllowedImageSrc,
  referencedAttachmentIds,
} from './richtext';

const id = '0b6f3c1e-9a2d-4c1b-8f3e-2d4a5b6c7d8e';

describe('rich text rules', () => {
  it('allows only safe link targets', () => {
    expect(isAllowedHref('https://example.com')).toBe(true);
    expect(isAllowedHref('mailto:a@b.c')).toBe(true);
    expect(isAllowedHref('/processes/1')).toBe(true);
    expect(isAllowedHref('#top')).toBe(true);
    expect(isAllowedHref('javascript:alert(1)')).toBe(false);
    expect(isAllowedHref(' JaVaScRiPt:alert(1)')).toBe(false);
    expect(isAllowedHref('data:text/html,x')).toBe(false);
    expect(isAllowedHref('//evil.com/x')).toBe(false);
    expect(isAllowedHref('/\\evil.com')).toBe(false);
  });

  it('allows images only from our attachments', () => {
    expect(isAllowedImageSrc(`/api/v1/attachments/${id}/content`)).toBe(true);
    expect(isAllowedImageSrc('https://tracker.example/pixel.gif')).toBe(false);
    expect(isAllowedImageSrc('data:image/png;base64,AAAA')).toBe(false);
    expect(isAllowedImageSrc(`/api/v1/attachments/${id}/content?x=1`)).toBe(false);
  });

  it('finds embedded diagrams and attachments', () => {
    const html = `<div data-type="bpmn-diagram" data-process-id="${id.toUpperCase()}"></div><img src="/api/v1/attachments/${id}/content">`;
    expect(embeddedProcessIds(html)).toEqual([id]);
    expect(referencedAttachmentIds(html)).toEqual([id]);
  });

  it('detects empty content', () => {
    expect(hasRichContent('<p></p>')).toBe(false);
    expect(hasRichContent('<p>&nbsp;</p>')).toBe(false);
    expect(hasRichContent('<p>Hi</p>')).toBe(true);
    expect(hasRichContent('<hr>')).toBe(true);
  });
});
