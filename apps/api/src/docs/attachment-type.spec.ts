import JSZip from 'jszip';
import { detectAttachmentType, safeFileName } from './attachment-type';

const office = async (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('detectAttachmentType', () => {
  it('accepts files whose content matches the extension', () => {
    expect(detectAttachmentType(png, 'a.PNG')).toBe('image/png');
    expect(detectAttachmentType(Buffer.from('%PDF-1.7 ...'), 'x.pdf')).toBe('application/pdf');
    expect(detectAttachmentType(Buffer.from('a,b\n1,2', 'utf8'), 'x.csv')).toBe('text/csv');
    expect(detectAttachmentType(Buffer.from('مرحبا', 'utf8'), 'x.txt')).toBe('text/plain');
  });

  it('rejects mismatches and unknown types', () => {
    expect(detectAttachmentType(Buffer.from('<script>'), 'evil.png')).toBeNull();
    expect(detectAttachmentType(png, 'x.pdf')).toBeNull();
    expect(detectAttachmentType(Buffer.from('<svg/>'), 'x.svg')).toBeNull();
    expect(detectAttachmentType(Buffer.from('MZ\0\0'), 'x.exe')).toBeNull();
    expect(detectAttachmentType(Buffer.from([0, 1, 2]), 'x.txt')).toBeNull();
    expect(detectAttachmentType(png, 'x.txt')).toBeNull();
    expect(detectAttachmentType(Buffer.alloc(0), 'x.txt')).toBeNull();
  });
});

describe('Office attachments (SEC-17)', () => {
  it('accepts a clean package and refuses macros, broken archives and unsafe paths', async () => {
    const docx = await office({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' });
    expect(detectAttachmentType(docx, 'x.docx')).toMatch(/wordprocessingml/);
    const macro = await office({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w/>',
      'word/vbaProject.bin': 'VBA',
    });
    expect(detectAttachmentType(macro, 'renamed.docx')).toBeNull();
    expect(detectAttachmentType(Buffer.from([0x50, 0x4b, 3, 4, 1]), 'x.docx')).toBeNull();
    const slip = await office({ '[Content_Types].xml': '<Types/>', '../evil.txt': 'x' });
    expect(detectAttachmentType(slip, 'x.xlsx')).toBeNull();
  });
});

describe('safeFileName', () => {
  it('strips paths and unsafe characters', () => {
    expect(safeFileName('../../etc/pa"ss<wd>.txt')).toBe('passwd.txt');
    expect(safeFileName('C:\\temp\\report.pdf')).toBe('report.pdf');
    expect(safeFileName('\u0000')).toBe('file');
  });
});
