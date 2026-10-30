import { Injectable } from '@nestjs/common';
import type { Locale } from '@processhub/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ReportsService } from '../reports/reports.service';
import { buildAuditReport } from '../reports/audit-report-docx';
import { AuditsService } from './audits.service';
import { AssuranceSettingsService } from './assurance-settings.service';

/** Audit report export (Word, EN / AR) with the organisation name and logo; audited `EXPORT`. */
@Injectable()
export class AuditReportService {
  constructor(
    private readonly audits: AuditsService,
    private readonly reports: ReportsService,
    private readonly settings: AssuranceSettingsService,
    private readonly audit: AuditService,
  ) {}

  async build(id: string, locale: Locale, user: AuthUser, meta: RequestMeta) {
    const engagement = await this.audits.reportData(id, user);
    const [org, logo, settings] = await Promise.all([
      this.reports.orgSettings(),
      this.reports.logo(),
      this.settings.get(),
    ]);
    const rtl = locale === 'ar';
    const data = await buildAuditReport({
      locale,
      orgName: (rtl ? org.nameAr || org.nameEn : org.nameEn || org.nameAr) || 'ProcessHub',
      logo,
      engagement,
      ratings: settings.severities,
      generatedBy: (rtl ? user.nameAr || user.nameEn : user.nameEn || user.nameAr) || user.email,
      generatedAt: new Date(),
    });
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'AuditEngagement',
      entityId: id,
      userId: user.id,
      summary: { report: 'audit-report', locale },
      meta,
    });
    return { data, fileName: `${engagement.code}-audit-report-${locale}.docx` };
  }
}
