import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  MFA_REQUIRED_ROLES,
  OFFLINE_DISALLOWED_ROLES,
  type AuthenticatedUser,
  type LoginRequest,
  type LoginResponse,
  type RoleCode,
} from '@chc/contracts';
import * as OTPAuth from 'otpauth';
import Redis from 'ioredis';

import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { tryGetContext } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';

import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly redis: Redis,
  ) {}

  /**
   * Sign in.
   *
   * Deliberate properties:
   *  - The response and its timing are the same whether or not the account
   *    exists, so this endpoint cannot be used to enumerate staff email
   *    addresses.
   *  - Lockout is per account AND per IP, so one attacker cannot lock out a
   *    whole facility by guessing, and one account cannot be ground down from
   *    many addresses.
   *  - Every outcome is audited, including failures — but never the attempted
   *    password.
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const email = request.email.toLowerCase().trim();

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        organisation_id: string;
        password_hash: string;
        status: string;
        mfa_enabled: boolean;
        permission_version: number;
        failed_login_count: number;
        locked_until: Date | null;
      }>
    >`SELECT * FROM core.authenticate_lookup(${email}::citext)`;

    const user = rows[0];

    if (!user) {
      // Burn comparable time so a missing account is indistinguishable.
      await this.passwords.burnTime();
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'app_user',
        outcome: 'FAILURE',
        severity: 'CRITICAL',
        reason: 'No account with that email address.',
        organisationId: await this.anyOrganisationId(),
      });
      throw new UnauthorizedException('Those sign-in details are not correct.');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'app_user',
        entityId: user.id,
        organisationId: user.organisation_id,
        outcome: 'DENIED',
        severity: 'CRITICAL',
        reason: 'Account is locked.',
      });
      throw new UnauthorizedException(
        'This account is temporarily locked after repeated failed attempts. Try again later, or ask an administrator to unlock it.',
      );
    }

    const correct = await this.passwords.verify(user.password_hash, request.password);

    if (!correct) {
      await this.registerFailure(user.id, user.organisation_id, user.failed_login_count);
      throw new UnauthorizedException('Those sign-in details are not correct.');
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'app_user',
        entityId: user.id,
        organisationId: user.organisation_id,
        outcome: 'DENIED',
        severity: 'CRITICAL',
        reason: `Account status is ${user.status}.`,
      });
      throw new UnauthorizedException('This account is not active. Please contact your administrator.');
    }

    await this.prisma.appUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    if (user.mfa_enabled) {
      const mfaToken = randomUUID();
      await this.redis.setex(`${this.env.REDIS_KEY_PREFIX}mfa:${mfaToken}`, 300, user.id);
      await this.audit.record({
        action: 'auth.mfa.challenged',
        entityType: 'app_user',
        entityId: user.id,
        organisationId: user.organisation_id,
      });
      return { mfaRequired: true, mfaToken };
    }

    const enrolment = await this.mfaEnrolmentIfRequired(user.id, user.organisation_id);
    if (enrolment) return enrolment;

    return this.establishSession(user.id, user.organisation_id, user.permission_version, request);
  }

  /**
   * Completes first-time MFA enrolment and issues the session.
   *
   * The password was already verified when the enrolment token was issued, so
   * this step proves possession of the authenticator and nothing more.
   */
  async confirmMfaEnrolment(enrolmentToken: string, code: string, deviceId?: string): Promise<LoginResponse> {
    const key = `${this.env.REDIS_KEY_PREFIX}mfa-enrol:${enrolmentToken}`;
    const stored = await this.redis.get(key);

    if (!stored) {
      throw new UnauthorizedException('That enrolment step has expired. Please sign in again.');
    }

    const { userId, secret } = JSON.parse(stored) as { userId: string; secret: string };

    const totp = new OTPAuth.TOTP({
      issuer: this.env.MFA_ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    if (totp.validate({ token: code, window: 1 }) === null) {
      throw new UnauthorizedException(
        'That code is not correct. Check that your device clock is accurate, then try the next code.',
      );
    }

    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, organisationId: true, permissionVersion: true },
    });

    await this.prisma.$transaction([
      this.prisma.userMfaFactor.create({
        data: {
          userId,
          factorType: 'TOTP',
          secretEncrypted: secret,
          label: 'Authenticator app',
          confirmedAt: new Date(),
        },
      }),
      this.prisma.appUser.update({ where: { id: userId }, data: { mfaEnabled: true } }),
    ]);

    await this.redis.del(key);

    await this.audit.record({
      action: 'auth.mfa.enrolled',
      entityType: 'app_user',
      entityId: userId,
      organisationId: user.organisationId,
      severity: 'CRITICAL',
    });

    return this.establishSession(user.id, user.organisationId, user.permissionVersion, { deviceId });
  }

  async verifyMfa(mfaToken: string, code: string, deviceId?: string): Promise<LoginResponse> {
    const key = `${this.env.REDIS_KEY_PREFIX}mfa:${mfaToken}`;
    const userId = await this.redis.get(key);

    if (!userId) {
      throw new UnauthorizedException('That verification step has expired. Please sign in again.');
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organisationId: true,
        permissionVersion: true,
        mfaFactors: { where: { factorType: 'TOTP', confirmedAt: { not: null } } },
      },
    });

    if (!user) throw new UnauthorizedException('Account not found.');

    const factor = user.mfaFactors[0];
    if (!factor) throw new UnauthorizedException('No confirmed authenticator is registered.');

    const totp = new OTPAuth.TOTP({
      issuer: this.env.MFA_ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(factor.secretEncrypted),
    });

    // ±1 window tolerates ordinary clock drift on a cheap phone without
    // meaningfully widening the guessing window.
    const delta = totp.validate({ token: code, window: 1 });

    if (delta === null) {
      await this.audit.record({
        action: 'auth.mfa.failed',
        entityType: 'app_user',
        entityId: user.id,
        organisationId: user.organisationId,
        outcome: 'FAILURE',
        severity: 'CRITICAL',
      });
      throw new UnauthorizedException('That code is not correct.');
    }

    // Single use: consumed whether or not the rest succeeds.
    await this.redis.del(key);

    return this.establishSession(user.id, user.organisationId, user.permissionVersion, { deviceId });
  }

  private async establishSession(
    userId: string,
    organisationId: string,
    permissionVersion: number,
    request: { deviceId?: string; deviceLabel?: string },
  ): Promise<LoginResponse> {
    const context = tryGetContext();

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        deviceId: request.deviceId,
        deviceLabel: request.deviceLabel,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken({ userId, sessionId: session.id, organisationId, permissionVersion }),
      this.tokens.issueRefreshToken(session.id, request.deviceId),
    ]);

    await this.audit.record({
      action: 'auth.login.succeeded',
      entityType: 'user_session',
      entityId: session.id,
      organisationId,
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.env.ACCESS_TOKEN_TTL_SECONDS,
      user: await this.describeUser(userId),
    };
  }

  async refresh(refreshToken: string, deviceId?: string) {
    const rotated = await this.tokens.rotateRefreshToken(refreshToken, deviceId);

    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: rotated.userId },
      select: { id: true, organisationId: true, permissionVersion: true, status: true },
    });

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is no longer active.');
    }

    const accessToken = await this.tokens.issueAccessToken({
      userId: user.id,
      sessionId: rotated.sessionId,
      organisationId: user.organisationId,
      permissionVersion: user.permissionVersion,
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresInSeconds: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: 'Signed out' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({ action: 'auth.logout', entityType: 'user_session', entityId: sessionId });
  }

  async logoutEverywhere(userId: string): Promise<number> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });

    for (const session of sessions) await this.logout(session.id);
    return sessions.length;
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, deviceLabel: true, ipAddress: true, createdAt: true, lastSeenAt: true },
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      isCurrent: session.id === currentSessionId,
    }));
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<number> {
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, passwordHash: true, organisationId: true },
    });

    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Your current password is not correct.');
    }

    const check = this.passwords.validate(newPassword, { email: user.email, fullName: user.fullName });
    if (!check.valid) {
      throw new BadRequestException(check.problems.join(' '));
    }

    await this.prisma.appUser.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: new Date() },
    });

    // Every other session ends, and the user is told how many — so a session
    // they did not recognise becomes visible to them.
    const context = tryGetContext();
    const others = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, id: { not: context?.sessionId ?? '' } },
      select: { id: true },
    });
    for (const session of others) await this.logout(session.id);

    await this.audit.record({
      action: 'auth.password.changed',
      entityType: 'app_user',
      entityId: userId,
      organisationId: user.organisationId,
      severity: 'CRITICAL',
    });

    return others.length;
  }

  async describeUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        organisationId: true,
        mfaEnabled: true,
        userRoles: {
          select: {
            role: {
              select: { code: true, permissions: { select: { isDenial: true, permission: { select: { code: true } } } } },
            },
          },
        },
        facilityAccess: {
          select: {
            scopeLevel: true,
            facility: { select: { id: true, name: true, code: true, lifecycleStage: true } },
          },
        },
      },
    });

    const granted = new Set<string>();
    const denied = new Set<string>();
    const roleCodes: string[] = [];

    for (const { role } of user.userRoles) {
      roleCodes.push(role.code);
      for (const entry of role.permissions) {
        if (entry.isDenial) denied.add(entry.permission.code);
        else granted.add(entry.permission.code);
      }
    }
    for (const code of denied) granted.delete(code);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organisationId: user.organisationId,
      roleCodes,
      permissions: [...granted].sort(),
      facilities: user.facilityAccess.map((access) => ({
        id: access.facility.id,
        name: access.facility.name,
        code: access.facility.code,
        lifecycleStage: access.facility.lifecycleStage,
        scopeLevel: access.scopeLevel,
      })),
      mfaEnabled: user.mfaEnabled,
      offlineDisallowed: roleCodes.some((code) => OFFLINE_DISALLOWED_ROLES.includes(code as RoleCode)),
    };
  }

  /**
   * If the user's role requires MFA and they have not enrolled, returns an
   * enrolment challenge instead of a session.
   *
   * Enforced at sign-in rather than at the point of a sensitive action, so a
   * finance officer discovers it at the start of their day and not halfway
   * through a payment run. And offered as an enrolment rather than a refusal,
   * because refusing outright would make the requirement unsatisfiable for a
   * newly created administrator.
   */
  private async mfaEnrolmentIfRequired(
    userId: string,
    organisationId: string,
  ): Promise<LoginResponse | null> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { code: true } } },
    });

    const mandatory = roles.some((r) => MFA_REQUIRED_ROLES.includes(r.role.code as RoleCode));
    if (!mandatory) return null;

    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: this.env.MFA_ISSUER,
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const enrolmentToken = randomUUID();
    // Ten minutes: enough to install an app and scan, short enough to matter.
    await this.redis.setex(
      `${this.env.REDIS_KEY_PREFIX}mfa-enrol:${enrolmentToken}`,
      600,
      JSON.stringify({ userId, secret: secret.base32 }),
    );

    await this.audit.record({
      action: 'auth.mfa.enrolment_started',
      entityType: 'app_user',
      entityId: userId,
      organisationId,
      severity: 'CRITICAL',
    });

    return {
      mfaEnrolmentRequired: true,
      enrolmentToken,
      secret: secret.base32,
      otpauthUri: totp.toString(),
      reason:
        'Your role can move money, execute agreements, or change who has access, so it requires two-factor authentication. Set up an authenticator app to continue.',
    };
  }

  private async registerFailure(userId: string, organisationId: string, currentCount: number): Promise<void> {
    const next = currentCount + 1;
    const shouldLock = next >= 10;

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil: shouldLock ? new Date(Date.now() + 30 * 60_000) : null,
      },
    });

    await this.audit.record({
      action: shouldLock ? 'auth.account.locked' : 'auth.login.failed',
      entityType: 'app_user',
      entityId: userId,
      organisationId,
      outcome: 'FAILURE',
      severity: 'CRITICAL',
      reason: shouldLock ? `Locked after ${next} consecutive failures.` : 'Incorrect password.',
    });
  }

  /**
   * Used only so that a failed login for an unknown email still produces an
   * audit row. Without it, attempts against non-existent accounts would leave
   * no trace at all — which is exactly the pattern worth seeing.
   */
  private async anyOrganisationId(): Promise<string | undefined> {
    const organisation = await this.prisma.organisation.findFirst({ select: { id: true } });
    return organisation?.id;
  }
}
