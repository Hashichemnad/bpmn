import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type AssuranceTasksDto } from '@processhub/shared';
import type { AuthUser } from '../common/auth-user';
import { GrcChangesService } from './grc-changes.service';
import { ControlTestsService } from './control-tests.service';
import { IssuesService } from './issues.service';
import { AuditsService } from './audits.service';
import { SurveysService } from './surveys.service';

/** My tasks → assurance tabs: change approvals, control tests, issues, actions, surveys. */
@Injectable()
export class AssuranceTasksService {
  constructor(
    private readonly changes: GrcChangesService,
    private readonly tests: ControlTestsService,
    private readonly issues: IssuesService,
    private readonly audits: AuditsService,
    private readonly surveys: SurveysService,
  ) {}

  async myTasks(user: AuthUser): Promise<AssuranceTasksDto> {
    const grc = user.permissions.has(PERMISSIONS.GRC_READ);
    return {
      grcChanges: grc ? await this.changes.list({ mine: true }, user) : [],
      ...(await this.tests.myTasks(user)),
      ...(await this.issues.myTasks(user)),
      ...(await this.audits.myTasks(user)),
      ...(await this.surveys.myTasks(user)),
    };
  }
}
