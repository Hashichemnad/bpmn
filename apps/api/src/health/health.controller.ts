import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AntivirusService } from '../storage/antivirus.service';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly antivirus: AntivirusService,
  ) {}

  @Get()
  @Public()
  @SkipThrottle()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  /**
   * Antivirus monitoring for the uptime monitor (D-191): 503 when clamd is down (uploads are being
   * refused) or its signatures are older than 3 days; 200 when it is fine or turned off. Reveals no
   * more than the engine and signature versions.
   */
  @Get('antivirus')
  @Public()
  // Rate-limited like every route (each call opens a connection to clamd); a monitor polling once a
  // minute stays far below the limit.
  async antivirusStatus(@Res({ passthrough: true }) res: Response) {
    const s = await this.antivirus.status();
    if (s.status === 'down' || s.status === 'stale') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return s;
  }
}
