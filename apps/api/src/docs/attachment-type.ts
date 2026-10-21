import { ATTACHMENT_TYPES } from '@processhub/shared';

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

function sniff(buf: Buffer): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
    return 'image/gif';
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  return null;
}

/** Text files: valid UTF-8 without NUL bytes. */
function isText(buf: Buffer): boolean {
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    // A multi-byte character may be cut at the 64 KB boundary.
    return buf.length > head.length;
  }
}

// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f"<>|:*?]/g;

/** Cleans a client-supplied file name: base name only, no control or path characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 200);
  return clean || 'file';
}

/**
 * Determines the attachment type from the extension (allow-list) AND the file content.
 * Returns null when the type is not allowed or the content does not match the extension.
 */
export function detectAttachmentType(buf: Buffer, fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const declared = ATTACHMENT_TYPES[ext];
  if (!declared || !buf.length) return null;
  const sniffed = sniff(buf);
  if (declared.startsWith('image/') || declared === 'application/pdf') {
    return sniffed === declared ? declared : null;
  }
  if (['docx', 'xlsx', 'pptx'].includes(ext)) return sniffed === 'zip' ? declared : null;
  // txt, csv, md, bpmn
  return !sniffed && isText(buf) ? declared : null;
}
