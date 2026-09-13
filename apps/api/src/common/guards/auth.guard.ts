import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { TokenService } from '../../modules/auth/token.service';
import { PUBLIC_KEY } from '../decorators';
import { getContext } from '../request-context';

/**
 * Verifies the access token and establishes the request context.
 *
 * FAILS CLOSED: a route is protected unless it explicitly declares @Public().
 * The default is never "allow".
 *
 * Permissions are NOT read from the token. The token carries only a permission
 * version; the effective set is resolved server-side from a cache that a role
 * change invalidates immediately — so revoking a dismissed staff member takes
 * effect on their next request, not when their token happens to expire
 * (doc 07 §2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (isPublic) return true;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('An access token is required.');
    }

    const token = header.slice('Bearer '.length).trim();

    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw new UnauthorizedException('The access token is invalid or has expired.');
    }

    // Resolves the live session, the facility scope, and the CURRENT effective
    // permission set — deliberately not the set that was true when the token
    // was minted.
    const resolved = await this.tokens.resolveSession(claims);

    getContext().assignIdentity(resolved);

    return true;
  }
}
