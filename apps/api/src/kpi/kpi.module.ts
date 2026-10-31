import { Module, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@processhub/shared';
import { AssuranceModule } from '../assurance/assurance.module';
import { AssuranceFilesService } from '../assurance/assurance-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';
import { KpiExcelService } from './kpi-excel.service';
import { KpiSettingsService } from './kpi-settings.service';
import { KpiScheduler } from './kpi-scheduler.service';

@Module({
  imports: [AssuranceModule],
  controllers: [KpiController],
  providers: [KpiService, KpiExcelService, KpiSettingsService, KpiScheduler],
  exports: [KpiService, KpiSettingsService, KpiScheduler, KpiExcelService],
})
export class KpiModule implements OnModuleInit {
  constructor(
    private readonly files: AssuranceFilesService,
    private readonly kpis: KpiService,
    private readonly prisma: PrismaService,
  ) {}

  /** Evidence of a measurement: readable with `kpi.read`, changed by whoever may enter the value. */
  onModuleInit() {
    this.files.register('KPI_MEASUREMENT', {
      canRead: async (_id, user) => user.permissions.has(PERMISSIONS.KPI_READ),
      canWrite: async (id, user) => {
        const m = await this.prisma.kpiMeasurement.findUnique({ where: { id } });
        if (!m) return false;
        return this.kpis
          .assertMayMeasure(m.kpiId, user)
          .then(() => true)
          .catch(() => false);
      },
    });
  }
}
