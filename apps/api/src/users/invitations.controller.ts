import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { acceptInvitationSchema, type AcceptInvitationInput } from '@processhub/shared';
import { getConfig } from '../config/config';
import { Public, ReqMeta } from '../common/decorators';
import type { RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { InvitationsService } from './invitations.service';

const loginLimit = () => ({
  default: {
    limit: getConfig().LOGIN_RATE_LIMIT_MAX,
    ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000,
  },
});

/** Public set-password page of an invitation (the token is the credential; login rate limit). */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  @Public()
  @Throttle(loginLimit())
  info(@Param('token', new ZodPipe(acceptInvitationSchema.shape.token)) token: string) {
    return this.invitations.info(token);
  }

  @Post('accept')
  @HttpCode(200)
  @Public()
  @Throttle(loginLimit())
  accept(
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.invitations.accept(body, meta);
  }
}
