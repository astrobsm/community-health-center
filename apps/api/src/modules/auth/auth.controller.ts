import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  mfaEnrolConfirmRequestSchema,
  mfaVerifyRequestSchema,
  refreshRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type MfaEnrolConfirmRequest,
  type MfaVerifyRequest,
  type RefreshRequest,
} from '@chc/contracts';

import { AuditAction, Ctx, Public, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestContext } from '../../common/request-context';

import { AuthService } from './auth.service';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Public because it is how a session begins.
   *
   * It audits itself with far more detail than the generic interceptor could —
   * it knows whether the password was wrong, the account locked, or MFA
   * enrolment missing.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuditAction('auth.login')
  login(@Body(zodBody(loginRequestSchema)) body: LoginRequest) {
    return this.auth.login(body);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @AuditAction('auth.mfa.verify')
  verifyMfa(@Body(zodBody(mfaVerifyRequestSchema)) body: MfaVerifyRequest) {
    return this.auth.verifyMfa(body.mfaToken, body.code, body.deviceId);
  }

  /**
   * Completes first-time MFA enrolment.
   *
   * Public because the user has no session yet — but the enrolment token is
   * issued only after a correct password, so this is not an open door.
   */
  @Public()
  @Post('mfa/enrol/confirm')
  @HttpCode(HttpStatus.OK)
  @AuditAction('auth.mfa.enrol')
  confirmMfaEnrolment(@Body(zodBody(mfaEnrolConfirmRequestSchema)) body: MfaEnrolConfirmRequest) {
    return this.auth.confirmMfaEnrolment(body.enrolmentToken, body.code, body.deviceId);
  }

  /**
   * Public because the access token has, by definition, expired. Security
   * rests on the refresh token itself: rotated on every use, bound to the
   * device, and revoking its whole family on reuse (doc 07 §2).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AuditAction('auth.refresh')
  refresh(@Body(zodBody(refreshRequestSchema)) body: RefreshRequest) {
    return this.auth.refresh(body.refreshToken, body.deviceId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('facility.read')
  @AuditAction('auth.logout')
  async logout(@Ctx() ctx: RequestContext): Promise<void> {
    if (ctx.sessionId) await this.auth.logout(ctx.sessionId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('facility.read')
  @AuditAction('auth.logout_all')
  async logoutEverywhere(@Ctx() ctx: RequestContext) {
    const ended = await this.auth.logoutEverywhere(ctx.userId!);
    return { sessionsEnded: ended };
  }

  /** Seeing your own sessions is how you notice one you do not recognise. */
  @Get('sessions')
  @RequirePermission('facility.read')
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx.userId!, ctx.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('facility.read')
  @AuditAction('auth.session.revoke')
  async revokeSession(@Param('id') id: string): Promise<void> {
    await this.auth.logout(id);
  }

  @Get('me')
  @RequirePermission('facility.read')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.describeUser(ctx.userId!);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('facility.read')
  @AuditAction('auth.password.change')
  async changePassword(
    @Ctx() ctx: RequestContext,
    @Body(zodBody(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ) {
    const ended = await this.auth.changePassword(ctx.userId!, body.currentPassword, body.newPassword);
    return {
      changed: true,
      otherSessionsEnded: ended,
      message:
        ended > 0
          ? `Your password was changed and ${ended} other session(s) were signed out.`
          : 'Your password was changed.',
    };
  }
}
