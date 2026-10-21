import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, auditListQuerySchema, type AuditListQuery } from '@processhub/shared';
import { RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  list(@Query(new ZodPipe(auditListQuerySchema)) q: AuditListQuery) {
    return this.audit.list(q);
  }
}
