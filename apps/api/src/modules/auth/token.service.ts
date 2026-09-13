import { createHash, randomBytes, generateKeyPairSync } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import type { Permission } from '@chc/contracts';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from 'jose';

import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Identity, ScopeLevel } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';

export interface AccessClaims extends JWTPayload {
  sub: string;
  sid: string;
  org: string;
  pv: number;
  typ: 'access';
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.JWT_PRIVATE_KEY_BASE64 && this.env.JWT_PUBLIC_KEY_BASE64) {
      this.privateKey = await importPKCS8(
        Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
        'EdDSA',
      );
      this.publicKey = await importSPKI(
        Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8'),
        'EdDSA',
      );
      return;
    }

    // Development convenience only. envSchema already refuses to start in
    // production without a real keypair, so this cannot reach a live facility.
    if (this.env.NODE_ENV === 'production') {
      throw new Error('No JWT keypair configured in production.');
    }

    const pair = generateKeyPairSync('ed25519');
    this.privateKey = (await importPKCS8(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'EdDSA',
    )) as KeyLike;
    this.publicKey = (await importSPKI(
      pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      'EdDSA',
    )) as KeyLike;

    this.logger.warn(
      'No JWT keypair configured; generated an ephemeral one for development. Every restart invalidates all tokens.',
    );
  }

  /**
   * Access token: 10 minutes, EdDSA.
   *
   * It carries a permission VERSION, not the permissions themselves. That is
   * what lets a revoked role take effect on the user's next request rather
   * than whenever their token happens to expire (doc 07 §2).
   */
  async issueAccessToken(params: {
    userId: string;
    sessionId: string;
    organisationId: string;
    permissionVersion: number;
  }): Promise<string> {
    return new SignJWT({
      sid: params.sessionId,
      org: params.organisationId,
      pv: params.permissionVersion,
      typ: 'access',
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.env.JWT_KEY_ID })
      .setSubject(params.userId)
      .setIssuedAt()
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
      algorithms: ['EdDSA'],
    });

    if (payload['typ'] !== 'access') {
      throw new UnauthorizedException('Wrong token type.');
    }

    return payload as AccessClaims;
  }

  /** Only the hash is ever stored, peppered so a database leak is not enough. */
  hashRefreshToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .update(this.env.REFRESH_TOKEN_PEPPER ?? 'dev-pepper')
      .digest('hex');
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Resolves the live session into an identity.
   *
   * Every element here is read fresh: the session may have been revoked, the
   * user disabled, or their roles changed since the token was minted. A token
   * proves who you were, not what you may still do.
   */
  async resolveSession(claims: AccessClaims): Promise<Identity> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('This session has ended. Please sign in again.');
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        organisationId: true,
        status: true,
        permissionVersion: true,
        userRoles: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: {
            role: {
              select: {
                code: true,
                permissions: {
                  select: { isDenial: true, permission: { select: { code: true } } },
                },
              },
            },
          },
        },
        facilityAccess: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { facilityId: true, scopeLevel: true, departmentId: true },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active.');
    }

    if (user.permissionVersion !== claims.pv) {
      // Not an error: the user's access changed. The next request with a fresh
      // token will carry the new version. We continue with the CURRENT set,
      // which is the safe direction — never the stale one.
      this.logger.debug(`Permission version changed for user ${user.id}; using the current set.`);
    }

    const granted = new Set<Permission>();
    const denied = new Set<Permission>();
    const roleCodes: string[] = [];

    for (const { role } of user.userRoles) {
      roleCodes.push(role.code);
      for (const entry of role.permissions) {
        const code = entry.permission.code as Permission;
        if (entry.isDenial) denied.add(code);
        else granted.add(code);
      }
    }

    // An explicit denial always beats a grant (doc 08 §7).
    for (const code of denied) granted.delete(code);

    const facilityIds = user.facilityAccess.map((a) => a.facilityId);
    const scopeLevel = (user.facilityAccess[0]?.scopeLevel ?? 'FULL') as ScopeLevel;

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      userId: user.id,
      sessionId: session.id,
      organisationId: user.organisationId,
      facilityIds,
      scopeLevel,
      permissions: granted,
      roleCodes,
      departmentId: user.facilityAccess[0]?.departmentId ?? undefined,
    };
  }

  /**
   * Rotation with reuse detection.
   *
   * Presenting an already-rotated token means it was stolen — the legitimate
   * holder would have the newest one. The whole family is revoked, the event is
   * audited at CRITICAL, and both the thief and the victim are logged out.
   */
  async rotateRefreshToken(presentedToken: string, deviceId?: string) {
    const tokenHash = this.hashRefreshToken(presentedToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        sessionId: true,
        familyId: true,
        status: true,
        expiresAt: true,
        deviceId: true,
        // The organisation is carried here because /auth/refresh is
        // unauthenticated: there is no request context to infer it from, and
        // without it the reuse-detection audit row would be dropped — losing
        // precisely the event most worth recording.
        session: {
          select: {
            userId: true,
            revokedAt: true,
            user: { select: { organisationId: true } },
          },
        },
      },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.status === 'ROTATED') {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.prisma.userSession.update({
        where: { id: existing.sessionId },
        data: { revokedAt: new Date(), revokedReason: 'Refresh token reuse detected' },
      });
      await this.audit.record({
        action: 'auth.token.reuse_detected',
        entityType: 'refresh_token',
        entityId: existing.id,
        organisationId: existing.session.user.organisationId,
        outcome: 'DENIED',
        severity: 'CRITICAL',
        reason: 'A rotated refresh token was presented again, which indicates theft.',
      });

      throw new UnauthorizedException(
        'This session has been ended for your security because a previously used sign-in token was presented again. Please sign in again.',
      );
    }

    if (existing.status === 'REVOKED' || existing.expiresAt < new Date() || existing.session.revokedAt) {
      throw new UnauthorizedException('This session has ended. Please sign in again.');
    }

    if (existing.deviceId && deviceId && existing.deviceId !== deviceId) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      throw new UnauthorizedException('This token was issued to a different device.');
    }

    const nextToken = this.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { status: 'ROTATED', rotatedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          sessionId: existing.sessionId,
          tokenHash: this.hashRefreshToken(nextToken),
          familyId: existing.familyId,
          deviceId: deviceId ?? existing.deviceId,
          expiresAt,
        },
      }),
    ]);

    return { refreshToken: nextToken, sessionId: existing.sessionId, userId: existing.session.userId };
  }

  async issueRefreshToken(sessionId: string, deviceId?: string): Promise<string> {
    const token = this.generateRefreshToken();
    const familyId = randomBytes(16).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        sessionId,
        tokenHash: this.hashRefreshToken(token),
        familyId: `${familyId.slice(0, 8)}-${familyId.slice(8, 12)}-${familyId.slice(12, 16)}-${familyId.slice(16, 20)}-${familyId.slice(20, 32)}`,
        deviceId,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });

    return token;
  }
}
