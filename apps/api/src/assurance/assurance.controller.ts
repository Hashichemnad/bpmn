import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { AssuranceTasksService } from './assurance-tasks.service';

@ApiTags('assurance')
@Controller('assurance')
export class AssuranceController {
  constructor(private readonly tasks: AssuranceTasksService) {}

  /** The caller's own assurance tasks (each list is filtered by the caller's permissions). */
  @Get('tasks')
  @Authenticated()
  myTasks(@CurrentUser() user: AuthUser) {
    return this.tasks.myTasks(user);
  }
}
