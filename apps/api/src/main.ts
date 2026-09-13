import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { assertRoutePermissions } from './bootstrap/assert-route-permissions';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { corsOrigins, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Configuration is validated before anything else starts. A facility
  // discovering at 9am that a key was never set is worse than a container that
  // never came up.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: env.API_BODY_LIMIT_BYTES,
      trustProxy: true,
      genReqId: () => crypto.randomUUID(),
    }),
    { bufferLogs: true, logger: ['error', 'warn', 'log'] },
  );

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.register(helmet, {
    contentSecurityPolicy: false, // the API serves JSON; CSP belongs on the web app
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  });

  app.enableCors({
    origin: corsOrigins(env),
    credentials: false, // bearer tokens, not cookies — so CSRF is not a category here
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Device-Id', 'X-Trace-Id'],
    exposedHeaders: ['X-Trace-Id'],
    maxAge: 600,
  });

  app.useGlobalFilters(new ProblemDetailsFilter(env.API_BASE_URL));
  app.enableShutdownHooks();

  await app.init();

  // Refuses to start if any route is unprotected. See doc 06 §8.
  assertRoutePermissions(app);

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(`API listening on ${env.API_HOST}:${env.API_PORT} (${env.NODE_ENV})`);
  if (!env.AI_ENABLED) {
    logger.log('AI layer disabled. Every other feature is unaffected.');
  }
}

void bootstrap().catch((error: unknown) => {
  // Startup failures must be loud and legible, not a stack trace in a crash loop.
  console.error('\nThe API failed to start.\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
