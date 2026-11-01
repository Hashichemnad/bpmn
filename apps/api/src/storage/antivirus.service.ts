import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { connect } from 'node:net';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AppException } from '../common/app-exception';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * Talks to the ClamAV daemon (clamd) with the INSTREAM command: the file is streamed in chunks over
 * TCP, nothing touches the disk (final session part B, D-184).
 */
export function clamdScan(
  host: string,
  port: number,
  data: Buffer,
  timeoutMs: number,
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let answer = '';
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('antivirus timeout')));
    socket.on('error', fail);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero length: end of stream
    });
    socket.on('data', (c: Buffer) => {
      answer += c.toString('utf8');
      if (answer.includes('\0')) socket.end();
    });
    socket.on('close', () => {
      const line = answer.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(line)) return resolve({ clean: true });
      const found = /:\s*(.+)\s+FOUND$/.exec(line);
      if (found) return resolve({ clean: false, signature: found[1] });
      reject(new Error(`antivirus: ${line || 'no answer'}`.slice(0, 200)));
    });
  });
}

/** Scans user uploads before they are stored (StorageService.put). */
@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled() {
    return this.config.ANTIVIRUS === 'clamav';
  }

  /**
   * Throws FILE_INFECTED (422) when a virus is found, and ANTIVIRUS_UNAVAILABLE (503) when the
   * scanner cannot be reached — the upload is then refused unless ANTIVIRUS_FAIL_OPEN=true.
   */
  async assertClean(data: Buffer, key: string): Promise<void> {
    if (!this.enabled) return;
    if (data.length > this.config.ANTIVIRUS_MAX_BYTES) {
      // Only event logs can be this large; they are parsed as data and never offered for download.
      this.logger.warn(`Not scanned (larger than ANTIVIRUS_MAX_BYTES): ${key}`);
      return;
    }
    let result: ScanResult;
    try {
      result = await clamdScan(
        this.config.CLAMAV_HOST,
        this.config.CLAMAV_PORT,
        data,
        this.config.ANTIVIRUS_TIMEOUT_MS,
      );
    } catch (e) {
      this.logger.error(`Antivirus scan failed for ${key}: ${(e as Error).message}`);
      if (this.config.ANTIVIRUS_FAIL_OPEN) return;
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ANTIVIRUS_UNAVAILABLE',
        'The virus scanner is not available; try again later',
      );
    }
    if (!result.clean) {
      this.logger.warn(`Upload refused, virus found (${result.signature}): ${key}`);
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FILE_INFECTED',
        'The file contains malware and was not stored',
        { signature: result.signature },
      );
    }
  }
}
