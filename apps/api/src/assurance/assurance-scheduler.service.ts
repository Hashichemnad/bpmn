import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { ControlTestsService } from './control-tests.service';
import { IssuesService } from './issues.service';
import { SurveysService } from './surveys.service';

/**
 * Periodic assurance work in this process (like the governance scheduler): control test cycles
 * and reminders, issue escalation, survey reminders. Dedupe keys / sent markers keep every
 * reminder to one per item and date.
 */
@Injectable()
export class AssuranceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssuranceScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly tests: ControlTestsService,
    private readonly issues: IssuesService,
    private readonly surveys: SurveysService,
    private readonly grcSettings: GrcSettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    const minutes = this.config.SCHEDULER_INTERVAL_MINUTES;
    if (!minutes || this.config.NODE_ENV === 'test') return;
    const run = () => void this.runOnce().catch((e: Error) => this.logger.error(e.message));
    this.first = setTimeout(run, 90_000);
    this.timer = setInterval(run, minutes * 60_000);
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const settings = await this.grcSettings.get();
    const tests = await this.tests.runScheduler(now, settings.reminderDaysBefore);
    if (tests.created || tests.reminders)
      this.logger.log(`Control tests created: ${tests.created}, reminders: ${tests.reminders}`);
    const issues = await this.issues.runScheduler(now);
    if (issues) this.logger.log(`Issue reminders and escalations: ${issues}`);
    const surveys = await this.surveys.runScheduler(now);
    if (surveys) this.logger.log(`Survey reminders: ${surveys}`);
    return { tests, issues, surveys };
  }
}
