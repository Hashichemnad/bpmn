import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type AssuranceTasksDto } from '@processhub/shared';
import type { AuthUser } from '../common/auth-user';
import { GrcChangesService } from './grc-changes.service';
import { ControlTestsService } from './control-tests.service';

/** My tasks → assurance tabs: change approvals, control tests, issues, actions, surveys. */
@Injectable()
export class AssuranceTasksService {
  constructor(
    private readonly changes: GrcChangesService,
    private readonly tests: ControlTestsService,
  ) {}

  async myTasks(user: AuthUser): Promise<AssuranceTasksDto> {
    const grc = user.permissions.has(PERMISSIONS.GRC_READ);
    return {
      grcChanges: grc ? await this.changes.list({ mine: true }, user) : [],
      ...(await this.tests.myTasks(user)),
    };
  }
}
