import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { IMPORT_LIMITS } from '@processhub/shared';

/**
 * Upload security of the Import Center (D-157). Every importer reads files only through these
 * helpers: the type is decided by the content (and must agree with the extension), archives are
 * checked before anything is decompressed and while decompressing, XML never has a DTD, and
 * macro-enabled Office files are refused. Nothing is ever written to disk or executed.
 */

export class ImportFileError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

export type SniffedType = 'zip' | 'pdf' | 'ole' | 'xml' | 'text' | 'image' | 'binary';

const IMAGE_MAGIC: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
];

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** Image MIME type from the magic bytes (PNG, JPEG, GIF, WebP), or null. */
export function sniffImage(buf: Buffer): string | null {
  for (const [type, magic] of IMAGE_MAGIC) if (startsWith(buf, magic)) return type;
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/** Whether the bytes are text (UTF-8 / UTF-16 with BOM, no NUL bytes in UTF-8). */
function looksLikeText(buf: Buffer): boolean {
  if (startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff])) return true;
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    // A multi-byte character may be cut at the boundary; legacy 8-bit XML is checked later.
    return buf.length > head.length || /^\s*<\?xml/.test(head.toString('latin1'));
  }
}

/** Type of a file by its content. */
export function sniffType(buf: Buffer): SniffedType {
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]))
    return 'zip';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (sniffImage(buf)) return 'image';
  if (!buf.length) return 'binary';
  if (looksLikeText(buf)) {
    const text = decodeText(buf.subarray(0, 4096)).trimStart();
    return text.startsWith('<') ? 'xml' : 'text';
  }
  return 'binary';
}

const MACRO_EXTENSIONS = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam']);
const OLD_OFFICE = new Set(['doc', 'xls', 'ppt', 'dot', 'xlt']);

/** What an extension must contain. */
const EXPECTED: Record<string, SniffedType[]> = {
  xlsx: ['zip'],
  docx: ['zip'],
  vsdx: ['zip'],
  zip: ['zip'],
  pdf: ['pdf'],
  bpmn: ['xml'],
  xml: ['xml'],
  dmn: ['xml'],
  aml: ['xml'],
  csv: ['text', 'xml'],
  md: ['text', 'xml'],
  markdown: ['text', 'xml'],
  txt: ['text', 'xml'],
  html: ['xml', 'text'],
  htm: ['xml', 'text'],
};

export const extensionOf = (name: string) => {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : '';
};

/**
 * Checks one uploaded file against the accepted extensions of the import kind and its content.
 * Throws ImportFileError with a translated code.
 */
export function checkUpload(
  fileName: string,
  data: Buffer,
  accepted: readonly string[],
): { ext: string; type: SniffedType } {
  const ext = extensionOf(fileName);
  if (data.length > IMPORT_LIMITS.fileBytes)
    throw new ImportFileError('FILE_TOO_LARGE', { file: fileName });
  if (!data.length) throw new ImportFileError('EMPTY_FILE', { file: fileName });
  if (MACRO_EXTENSIONS.has(ext)) throw new ImportFileError('MACRO_NOT_ALLOWED', { file: fileName });
  const type = sniffType(data);
  if (ext === 'vsd' || (type === 'ole' && extensionOf(fileName) === 'vsdx'))
    throw new ImportFileError('VSD_BINARY', { file: fileName });
  if (OLD_OFFICE.has(ext) || type === 'ole')
    throw new ImportFileError('OLD_OFFICE_FORMAT', { file: fileName });
  if (!accepted.includes(ext))
    throw new ImportFileError('FILE_EXTENSION_NOT_ACCEPTED', { file: fileName, ext });
  const expected = EXPECTED[ext];
  if (!expected || !expected.includes(type))
    throw new ImportFileError('FILE_TYPE_MISMATCH', { file: fileName, ext });
  return { ext, type };
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// ---------- Text and XML ----------

/** Decodes text: BOM (UTF-8 / UTF-16), else the XML declaration's encoding, else UTF-8. */
export function decodeText(buf: Buffer): string {
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return buf.subarray(3).toString('utf8');
  if (startsWith(buf, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (startsWith(buf, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const decl = /^\s*<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(buf.toString('latin1', 0, 200));
  const enc = decl?.[1].toLowerCase();
  if (enc && !['utf-8', 'utf8'].includes(enc)) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      /* unknown encoding: fall back to UTF-8 */
    }
  }
  return buf.toString('utf8');
}

let dom: JSDOM | null = null;
const parser = () => new (dom ??= new JSDOM('')).window.DOMParser();

/**
 * Parses XML safely: DTDs and entity declarations are refused before parsing (no XXE, no
 * "billion laughs"); jsdom's parser never loads external resources. Throws ImportFileError.
 */
export function parseSafeXml(xml: string, file = ''): Document {
  if (xml.length > IMPORT_LIMITS.xmlBytes) throw new ImportFileError('FILE_TOO_LARGE', { file });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ImportFileError('XML_DTD_NOT_ALLOWED', { file });
  const doc = parser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length)
    throw new ImportFileError('XML_INVALID', { file });
  return doc;
}

// ---------- ZIP ----------

export interface ZipEntryInfo {
  path: string;
  size: number;
  compressedSize: number;
}

export interface SafeZip {
  entries: ZipEntryInfo[];
  has(path: string): boolean;
  /** Decompresses one entry; the total of all reads is limited (zip bomb). */
  read(path: string): Promise<Buffer>;
  readText(path: string): Promise<string>;
}

const UNSAFE_PATH = /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-zA-Z]:|\0/;

/** Normalised entry path ("a/b.html"). */
export const normaliseEntryPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Reads the central directory of a ZIP without decompressing anything and checks the limits:
 * entry count, declared total size, ratio per entry, encrypted entries, unsafe paths
 * (absolute, drive letters, "..", NUL — ZIP-slip) and symbolic links.
 */
export function inspectZip(
  buf: Buffer,
  file = '',
  maxTotal: number = IMPORT_LIMITS.zipUncompressedBytes,
): ZipEntryInfo[] {
  // End of central directory: last 22 bytes + up to 64 KB comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportFileError('ZIP_INVALID', { file });
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff)
    throw new ImportFileError('ZIP_INVALID', { file }); // ZIP64 is not accepted
  if (count > IMPORT_LIMITS.zipEntries)
    throw new ImportFileError('ZIP_TOO_MANY_ENTRIES', { file, max: IMPORT_LIMITS.zipEntries });
  if (cdOffset + cdSize > buf.length) throw new ImportFileError('ZIP_INVALID', { file });
  const entries: ZipEntryInfo[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw new ImportFileError('ZIP_INVALID', { file });
    const flags = buf.readUInt16LE(p + 8);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const external = buf.readUInt32LE(p + 38);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new ImportFileError('ZIP_ENCRYPTED', { file });
    if (UNSAFE_PATH.test(name)) throw new ImportFileError('ZIP_UNSAFE_PATH', { file, entry: name });
    // Unix host (3) with S_IFLNK in the high word: a symbolic link.
    if (madeBy === 3 && ((external >>> 16) & 0o170000) === 0o120000)
      throw new ImportFileError('ZIP_UNSAFE_PATH', { file, entry: name });
    if (name.endsWith('/')) continue;
    total += size;
    if (total > maxTotal)
      throw new ImportFileError('ZIP_TOO_LARGE', {
        file,
        max: Math.round(maxTotal / 1024 / 1024),
      });
    if (size > 1024 * 1024 && size / Math.max(1, compressedSize) > IMPORT_LIMITS.zipRatio)
      throw new ImportFileError('ZIP_RATIO', { file, entry: name });
    entries.push({ path: normaliseEntryPath(name), size, compressedSize });
  }
  return entries;
}

/**
 * Opens a ZIP after `inspectZip`. Reads stream the entry and stop as soon as it grows beyond its
 * declared size or the archive's budget — a lying header cannot inflate past the limits.
 */
export async function openSafeZip(
  buf: Buffer,
  file = '',
  maxBytes: number = IMPORT_LIMITS.zipUncompressedBytes,
): Promise<SafeZip> {
  const entries = inspectZip(buf, file, maxBytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: true });
  } catch {
    throw new ImportFileError('ZIP_INVALID', { file });
  }
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const objects = new Map<string, JSZip.JSZipObject>();
  zip.forEach((path, obj) => {
    if (!obj.dir) objects.set(normaliseEntryPath(path), obj);
  });
  let budget = maxBytes;
  const read = (path: string) =>
    new Promise<Buffer>((resolve, reject) => {
      const info = byPath.get(path);
      const obj = objects.get(path);
      if (!info || !obj) return reject(new ImportFileError('ZIP_ENTRY_MISSING', { file, path }));
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = obj.nodeStream('nodebuffer');
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        budget -= chunk.length;
        if (size > info.size || budget < 0) {
          (stream as unknown as { destroy?: () => void }).destroy?.();
          stream.removeAllListeners();
          reject(new ImportFileError('ZIP_TOO_LARGE', { file }));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', () => reject(new ImportFileError('ZIP_INVALID', { file })));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  return {
    entries,
    has: (path) => objects.has(normaliseEntryPath(path)),
    read: (path) => read(normaliseEntryPath(path)),
    readText: async (path) => decodeText(await read(normaliseEntryPath(path))),
  };
}

/** True when a ZIP's entry list contains a VBA project (renamed .docm / .xlsm / .pptm). */
export const hasMacroParts = (entries: { path: string }[]) =>
  entries.some((e) => /vbaProject\.bin$|vbaData\.xml$/i.test(e.path));

/**
 * Office Open XML package checks (docx / xlsx / vsdx): the main part must exist and the package
 * must not contain VBA macros (a renamed .docm / .xlsm).
 *
 * Every entry is decompressed once through the budgeted reader (final session part B, SEC-12):
 * ExcelJS and mammoth open the buffer again with their own unzip, which trusts the declared sizes
 * and inflates an entry completely — a lying header ("1 KB" that inflates to gigabytes) would
 * exhaust the API's memory. After this check the real uncompressed size is known to be within
 * `maxBytes`.
 */
export async function checkOfficePackage(
  buf: Buffer,
  file: string,
  mainPart: string,
  maxBytes: number = IMPORT_LIMITS.zipUncompressedBytes,
): Promise<SafeZip> {
  const zip = await openSafeZip(buf, file, maxBytes);
  for (const entry of zip.entries) await zip.read(entry.path);
  if (hasMacroParts(zip.entries)) throw new ImportFileError('MACRO_NOT_ALLOWED', { file });
  if (zip.has('[Content_Types].xml')) {
    const types = await zip.readText('[Content_Types].xml');
    if (/macroEnabled/i.test(types)) throw new ImportFileError('MACRO_NOT_ALLOWED', { file });
  }
  if (!zip.has(mainPart)) throw new ImportFileError('FILE_TYPE_MISMATCH', { file });
  return zip;
}

/**
 * Excel workbook uploads parsed outside the Import Center (GRC / EA / KPI Excel imports): the same
 * structure, macro and real-size checks as `checkOfficePackage`, with a smaller budget because the
 * whole workbook is loaded into memory by ExcelJS in the request (SEC-12).
 */
export const WORKBOOK_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
export async function checkWorkbookUpload(buf: Buffer, file = 'upload.xlsx'): Promise<void> {
  await checkOfficePackage(buf, file, 'xl/workbook.xml', WORKBOOK_UNCOMPRESSED_BYTES);
}

/**
 * Event-log workbooks (process mining) can be large — the sheets are streamed row by row — so the
 * total budget is wider, but the archive structure, macros and the one part ExcelJS keeps in memory
 * (`xl/sharedStrings.xml`) are checked with the budgeted reader (SEC-12).
 */
export async function checkMiningWorkbook(buf: Buffer, file: string): Promise<void> {
  const zip = await openSafeZip(buf, file, 4 * 1024 * 1024 * 1024 - 1);
  if (hasMacroParts(zip.entries)) throw new ImportFileError('MACRO_NOT_ALLOWED', { file });
  if (!zip.has('xl/workbook.xml')) throw new ImportFileError('FILE_TYPE_MISMATCH', { file });
  const shared = zip.entries.find((e) => e.path === 'xl/sharedStrings.xml');
  if (shared) {
    if (shared.size > 256 * 1024 * 1024) throw new ImportFileError('ZIP_TOO_LARGE', { file });
    await zip.read(shared.path);
  }
}
