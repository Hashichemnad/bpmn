import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { MiningSettingsService } from './mining-settings.service';
import { LogImportService } from './log-import.service';
import { startPeriodic, type Periodic } from '../common/periodic';

/** Periodic mining work (like the KPI scheduler): retention of event logs. */
@Injectable()
export class MiningScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MiningScheduler.name);
  private periodic?: Periodic;
  private readonly jobs: ((now: Date) => Promise<unknown>)[] = [];

  constructor(
    private readonly settings: MiningSettingsService,
    private readonly importer: LogImportService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Further periodic work (mining-based KPIs, step 3). */
  register(job: (now: Date) => Promise<unknown>) {
    this.jobs.push(job);
  }

  onModuleInit() {
    const minutes = this.config.SCHEDULER_INTERVAL_MINUTES;
    if (!minutes || this.config.NODE_ENV === 'test') return;
    // Never two runs at once (a slow run on a large repository skips the next tick).
    this.periodic = startPeriodic(
      'Mining scheduler',
      () => this.runOnce(),
      150_000,
      minutes * 60_000,
      this.logger,
    );
  }

  onModuleDestroy() {
    this.periodic?.stop();
  }

  async runOnce(now = new Date()) {
    const { retentionMonths } = await this.settings.get();
    const purged = await this.importer.purgeExpired(retentionMonths, now);
    for (const job of this.jobs) await job(now);
    return { purged };
  }
}
