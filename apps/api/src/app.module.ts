import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import Redis from 'ioredis';

import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { loadEnv, type Env } from './config/env';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { AuditService } from './modules/audit/audit.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { PasswordService } from './modules/auth/password.service';
import { TokenService } from './modules/auth/token.service';
import { MetaController } from './modules/meta/meta.controller';
import { RevitalisationModule } from './modules/revitalisation.module';

export const ENV = Symbol('ENV');

/**
 * Platform layer (L1/L2 in doc 05): configuration, database, cache, audit.
 * Global, because every domain module depends on all of it and wiring that
 * per-module would be noise rather than clarity.
 */
@Global()
@Module({
  providers: [
    { provide: 'Env', useFactory: (): Env => loadEnv() },
    {
      provide: Redis,
      inject: ['Env'],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_KEY_PREFIX, lazyConnect: false }),
    },
    PrismaService,
    AuditService,
  ],
  exports: ['Env', Redis, PrismaService, AuditService],
})
export class PlatformModule {}

@Module({
  controllers: [AuthController],
  providers: [
    { provide: PasswordService, inject: ['Env'], useFactory: (env: Env) => new PasswordService(env) },
    {
      provide: TokenService,
      inject: ['Env', PrismaService, AuditService],
      useFactory: (env: Env, prisma: PrismaService, audit: AuditService) => new TokenService(env, prisma, audit),
    },
    {
      provide: AuthService,
      inject: ['Env', PrismaService, PasswordService, TokenService, AuditService, Redis],
      useFactory: (
        env: Env,
        prisma: PrismaService,
        passwords: PasswordService,
        tokens: TokenService,
        audit: AuditService,
        redis: Redis,
      ) => new AuthService(env, prisma, passwords, tokens, audit, redis),
    },
  ],
  exports: [TokenService, AuthService, PasswordService],
})
export class AuthModule {}

@Module({
  imports: [PlatformModule, AuthModule, RevitalisationModule],
  controllers: [MetaController],
  providers: [
    /**
     * The global pipeline, applied to every request in this order.
     * It FAILS CLOSED: a route is authenticated and permission-checked unless
     * it explicitly declares otherwise (doc 02 §1).
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // First in, last out: the request context exists before anything else can
    // need it, including for requests that fail authentication.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
