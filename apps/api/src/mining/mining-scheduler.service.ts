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

/** Periodic mining work (like the KPI scheduler): retention of event logs. */
@Injectable()
export class MiningScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MiningScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
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
    const run = () => void this.runOnce().catch((e: Error) => this.logger.error(e.message));
    this.first = setTimeout(run, 150_000);
    this.timer = setInterval(run, minutes * 60_000);
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const { retentionMonths } = await this.settings.get();
    const purged = await this.importer.purgeExpired(retentionMonths, now);
    for (const job of this.jobs) await job(now);
    return { purged };
  }
}
