import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AntivirusService } from './antivirus.service';

/** Thin wrapper around MinIO (S3-compatible) object storage. */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private bucketReady?: Promise<void>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly antivirus: AntivirusService,
  ) {
    this.client = new Client({
      endPoint: config.MINIO_ENDPOINT,
      port: config.MINIO_PORT,
      useSSL: config.MINIO_USE_SSL,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
    });
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const bucket = this.config.MINIO_BUCKET;
      if (!(await this.client.bucketExists(bucket))) await this.client.makeBucket(bucket);
    })().catch((err: Error) => {
      this.bucketReady = undefined;
      this.logger.error(`MinIO bucket check failed: ${err.message}`);
      throw err;
    });
    return this.bucketReady;
  }

  /**
   * Stores an object. Every upload is scanned for malware first (D-184); only files ProcessHub
   * generates itself (rendered images, snapshots, report files, generated documents) pass
   * `{ generated: true }` and skip the scan.
   */
  async put(
    key: string,
    data: Buffer,
    contentType: string,
    opts: { generated?: boolean } = {},
  ): Promise<void> {
    if (!opts.generated) await this.antivirus.assertClean(data, key);
    await this.ensureBucket();
    await this.client.putObject(this.config.MINIO_BUCKET, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async get(key: string): Promise<Readable> {
    await this.ensureBucket();
    return this.client.getObject(this.config.MINIO_BUCKET, key);
  }

  async remove(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.removeObject(this.config.MINIO_BUCKET, key);
  }
}
