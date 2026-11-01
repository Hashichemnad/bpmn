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

/** Sends one clamd command (z-prefixed, NUL-terminated) and returns the answer. */
export function clamdCommand(
  host: string,
  port: number,
  command: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let answer = '';
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('antivirus timeout'));
    });
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`z${command}\0`));
    socket.on('data', (c: Buffer) => {
      answer += c.toString('utf8');
      if (answer.includes('\0')) socket.end();
    });
    socket.on('close', () => resolve(answer.replace(/\0/g, '').trim()));
  });
}

/** Signatures older than this make the antivirus health check fail (D-191). */
export const SIGNATURES_MAX_AGE_HOURS = 72;

export interface AntivirusStatus {
  enabled: boolean;
  /** ok | stale (signatures older than 3 days) | down (clamd unreachable: uploads are refused). */
  status: 'off' | 'ok' | 'stale' | 'down';
  version: string | null;
  signaturesUpdatedAt: string | null;
  signaturesAgeHours: number | null;
}

/**
 * Parses clamd's VERSION answer, e.g. "ClamAV 1.4.2/27443/Sat Nov  1 07:52:51 2026": engine,
 * signature database version and the database's build time.
 */
export function parseClamdVersion(answer: string): { version: string; updatedAt: Date | null } {
  const [version = answer, , date] = answer.split('/');
  const t = date ? Date.parse(`${date.replace(/\s+/g, ' ').trim()} UTC`) : NaN;
  return { version: version.trim(), updatedAt: Number.isNaN(t) ? null : new Date(t) };
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
   * State for monitoring (GET /health/antivirus, D-191): down when clamd does not answer — uploads
   * are refused then —, stale when the signatures are older than SIGNATURES_MAX_AGE_HOURS.
   */
  async status(now = new Date()): Promise<AntivirusStatus> {
    if (!this.enabled)
      return {
        enabled: false,
        status: 'off',
        version: null,
        signaturesUpdatedAt: null,
        signaturesAgeHours: null,
      };
    try {
      const answer = await clamdCommand(
        this.config.CLAMAV_HOST,
        this.config.CLAMAV_PORT,
        'VERSION',
        5000,
      );
      const { version, updatedAt } = parseClamdVersion(answer);
      const age = updatedAt ? (now.getTime() - updatedAt.getTime()) / 3_600_000 : null;
      return {
        enabled: true,
        status: age === null || age > SIGNATURES_MAX_AGE_HOURS ? 'stale' : 'ok',
        version,
        signaturesUpdatedAt: updatedAt?.toISOString() ?? null,
        signaturesAgeHours: age === null ? null : Math.round(age),
      };
    } catch (e) {
      this.logger.error(`Antivirus not reachable: ${(e as Error).message}`);
      return {
        enabled: true,
        status: 'down',
        version: null,
        signaturesUpdatedAt: null,
        signaturesAgeHours: null,
      };
    }
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
