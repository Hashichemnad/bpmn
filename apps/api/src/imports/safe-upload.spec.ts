import JSZip from 'jszip';
import {
  ImportFileError,
  checkOfficePackage,
  checkUpload,
  decodeText,
  inspectZip,
  openSafeZip,
  parseSafeXml,
  sniffType,
} from './safe-upload';
import { sanitizeRichText } from '../docs/rich-text';
import { sanitizeSvg } from '../settings/image-sniff';

const zipOf = async (
  files: Record<string, string | Buffer>,
  opts: Partial<JSZip.JSZipGeneratorOptions> = {},
) => {
  const z = new JSZip();
  for (const [k, v] of Object.entries(files)) z.file(k, v, { createFolders: false });
  return (await z.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    ...opts,
  } as JSZip.JSZipGeneratorOptions<'nodebuffer'>)) as Buffer;
};

const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ImportFileError) return e.code;
    throw e;
  }
  return 'OK';
};

const BPMN =
  '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>';

describe('sniffType / checkUpload (type by content, D-157)', () => {
  it('detects the type by content', async () => {
    expect(sniffType(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(sniffType(await zipOf({ a: 'x' }))).toBe('zip');
    expect(sniffType(Buffer.from(BPMN))).toBe('xml');
    expect(sniffType(Buffer.from('code;name\nC.01;x'))).toBe('text');
    expect(sniffType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBe('binary');
  });

  it('accepts a matching file', () => {
    expect(checkUpload('a.bpmn', Buffer.from(BPMN), ['bpmn', 'xml', 'zip'])).toEqual({
      ext: 'bpmn',
      type: 'xml',
    });
  });

  it('rejects an executable renamed to .bpmn and a ZIP renamed to .pdf', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]);
    expect(await codeOf(() => checkUpload('evil.bpmn', exe, ['bpmn']))).toBe('FILE_TYPE_MISMATCH');
    expect(await codeOf(async () => checkUpload('a.pdf', await zipOf({ a: 'x' }), ['pdf']))).toBe(
      'FILE_TYPE_MISMATCH',
    );
  });

  it('rejects extensions the kind does not accept, empty files and macro formats', () => {
    expect(() => checkUpload('a.exe', Buffer.from('x'), ['bpmn'])).toThrow(ImportFileError);
    expect(codeOf(() => checkUpload('a.bpmn', Buffer.alloc(0), ['bpmn']))).resolves.toBe(
      'EMPTY_FILE',
    );
    expect(
      codeOf(() => checkUpload('sop.docm', Buffer.from('PK'), ['docx', 'docm'])),
    ).resolves.toBe('MACRO_NOT_ALLOWED');
    expect(codeOf(() => checkUpload('list.xlsm', Buffer.from('PK'), ['xlsx']))).resolves.toBe(
      'MACRO_NOT_ALLOWED',
    );
  });

  it('explains binary Visio and old Office files', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(codeOf(() => checkUpload('flow.vsd', ole, ['vsdx', 'vsd']))).resolves.toBe('VSD_BINARY');
    expect(codeOf(() => checkUpload('sop.doc', ole, ['docx']))).resolves.toBe('OLD_OFFICE_FORMAT');
  });
});

describe('ZIP archives (zip-slip, zip bombs, D-157)', () => {
  it('lists a normal archive and reads its entries', async () => {
    const zip = await openSafeZip(await zipOf({ 'a/b.bpmn': BPMN, 'c.txt': 'hello' }));
    expect(zip.entries.map((e) => e.path).sort()).toEqual(['a/b.bpmn', 'c.txt']);
    expect(await zip.readText('c.txt')).toBe('hello');
  });

  it('rejects path traversal and absolute paths (zip-slip)', async () => {
    for (const name of ['../evil.sh', 'a/../../evil.sh', '/etc/passwd', 'C:/x.txt', '..\\x.txt']) {
      const buf = await zipOf({ [name]: 'x' });
      expect(await codeOf(() => inspectZip(buf))).toBe('ZIP_UNSAFE_PATH');
    }
  });

  it('rejects symbolic links', async () => {
    const z = new JSZip();
    z.file('link', '/etc/passwd', { unixPermissions: 0o120777 });
    const buf = Buffer.from(await z.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    expect(await codeOf(() => inspectZip(buf))).toBe('ZIP_UNSAFE_PATH');
  });

  it('rejects a zip bomb (compression ratio) before decompressing', async () => {
    const buf = await zipOf({ 'bomb.txt': Buffer.alloc(30 * 1024 * 1024, 0) });
    expect(buf.length).toBeLessThan(100 * 1024);
    expect(await codeOf(() => inspectZip(buf))).toBe('ZIP_RATIO');
  });

  it('rejects too many entries', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 2001; i++) files[`f${i}.txt`] = 'x';
    expect(await codeOf(async () => inspectZip(await zipOf(files, { compression: 'STORE' })))).toBe(
      'ZIP_TOO_MANY_ENTRIES',
    );
  });

  it('stops an entry that inflates beyond its declared size (lying header)', async () => {
    const buf = await zipOf({ 'x.txt': Buffer.alloc(200_000, 65) });
    // Patch the declared uncompressed size in the central directory to 10 bytes.
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt32LE(10, cd + 24);
    const zip = await openSafeZip(buf).catch((e: ImportFileError) => e);
    if (zip instanceof ImportFileError) expect(zip.code).toMatch(/ZIP_/);
    else expect(await codeOf(() => zip.read('x.txt'))).toMatch(/ZIP_TOO_LARGE|ZIP_INVALID/);
  });

  it('rejects encrypted entries and garbage', async () => {
    const buf = await zipOf({ 'x.txt': 'secret' });
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt16LE(buf.readUInt16LE(cd + 8) | 1, cd + 8);
    expect(await codeOf(() => inspectZip(buf))).toBe('ZIP_ENCRYPTED');
    expect(await codeOf(() => inspectZip(Buffer.from('PK\x03\x04 not really')))).toBe(
      'ZIP_INVALID',
    );
  });

  it('rejects a renamed macro workbook (vbaProject.bin) and a macro content type', async () => {
    const xlsm = await zipOf({
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml': '<workbook/>',
      'xl/vbaProject.bin': Buffer.from([1, 2, 3]),
    });
    expect(await codeOf(() => checkOfficePackage(xlsm, 'x.xlsx', 'xl/workbook.xml'))).toBe(
      'MACRO_NOT_ALLOWED',
    );
    const docm = await zipOf({
      '[Content_Types].xml':
        '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      'word/document.xml': '<w:document/>',
    });
    expect(await codeOf(() => checkOfficePackage(docm, 'x.docx', 'word/document.xml'))).toBe(
      'MACRO_NOT_ALLOWED',
    );
    const ok = await zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<d/>' });
    expect(await codeOf(() => checkOfficePackage(ok, 'x.docx', 'word/document.xml'))).toBe('OK');
  });
});

describe('XML without DTDs (XXE, billion laughs)', () => {
  it('rejects external entities', () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>';
    expect(codeOf(() => parseSafeXml(xxe))).resolves.toBe('XML_DTD_NOT_ALLOWED');
  });

  it('rejects entity expansion (billion laughs)', () => {
    const lol =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    expect(codeOf(() => parseSafeXml(lol))).resolves.toBe('XML_DTD_NOT_ALLOWED');
  });

  it('rejects malformed XML and parses good XML', () => {
    expect(codeOf(() => parseSafeXml('<a><b></a>'))).resolves.toBe('XML_INVALID');
    expect(parseSafeXml(BPMN).documentElement.localName).toBe('definitions');
  });

  it('decodes BOMs and legacy encodings', () => {
    expect(decodeText(Buffer.from('\uFEFF<a/>', 'utf8'))).toBe('<a/>');
    const latin = Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?><a>caf\xe9</a>',
      'latin1',
    );
    expect(decodeText(latin)).toContain('café');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a>نص</a>', 'utf16le')]);
    expect(decodeText(utf16)).toBe('<a>نص</a>');
  });
});

describe('HTML and SVG content of imports', () => {
  it('sanitises imported HTML with the wiki rules', () => {
    const out = sanitizeRichText(
      '<p onmouseover="x()">Text<script>alert(1)</script><img src="http://evil/x.png" onerror="y()"></p><iframe src="//e"></iframe>',
    );
    expect(out).toBe('<p>Text</p>');
  });

  it('sanitises SVG (scripts, handlers, external references)', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onload="x()" width="1"/><a href="javascript:alert(1)"><text>x</text></a></svg>',
    );
    expect(out).not.toMatch(/script|onload|javascript:/i);
  });
});
