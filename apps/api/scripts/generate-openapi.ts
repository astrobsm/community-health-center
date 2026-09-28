/**
 * Emit the API's route surface as OpenAPI 3.1, from the router itself.
 *
 * The per-release Definition of Done asks for "OpenAPI regenerated and
 * committed" and twelve releases shipped without it, while the README claimed a
 * documentation endpoint that does not exist. This closes both: the document is
 * generated from the live route table, so it cannot drift from the code, and it
 * is committed rather than served, so reading it needs no running server.
 *
 * What it describes, and what it does not:
 *
 *   It describes every route, its HTTP method, and the permission a caller must
 *   hold — which is the first thing an integrator needs and the thing most
 *   easily got wrong.
 *
 *   It does NOT describe request and response bodies. Those are Zod schemas in
 *   `packages/contracts`, which both tiers import and validate against; the same
 *   schema that validates on a phone in a village validates at sync time on the
 *   server. Restating them here in a second notation would create two
 *   definitions that can disagree, and the one in this file would be the one
 *   nobody runs. The document says so, in the place a reader will look.
 *
 * Usage:  npm run openapi --workspace @chc/api
 */

import 'reflect-metadata';

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from '../src/app.module';
import { collectRoutes, type RouteInfo } from '../src/bootstrap/assert-route-permissions';

const OUT_JSON = resolve(import.meta.dirname, '../../../docs/api/openapi.json');
const OUT_MD = resolve(import.meta.dirname, '../../../docs/api/routes.md');

const DESCRIPTION = [
  'The route surface of the Community Health Centre platform API, generated from the router at build',
  'time so it cannot drift from the code.',
  '',
  'Every route carries the permission a caller must hold. A route with no permission does not exist:',
  'the application refuses to start if one is found, and the permissions guard refuses the request',
  'even if it did (doc 06 §8).',
  '',
  'Request and response bodies are deliberately not restated here. They are Zod schemas in',
  '`packages/contracts`, imported and validated by both the API and the client, so the same schema',
  'that validates a record captured offline in a village validates it at sync time on the server.',
  'Duplicating them in this document would create a second definition that can disagree with the',
  'first — and this would be the copy nobody executes.',
  '',
  'Errors are RFC 9457 Problem Details. The `type` field carries the machine-readable code; there is',
  'no separate `code` field.',
].join('\n');

function operationId(route: RouteInfo): string {
  return `${route.controller.replace(/Controller$/, '')}_${route.handler}`;
}

/** `:id` in Nest, `{id}` in OpenAPI. */
function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: converted, params };
}

async function main(): Promise<void> {
  // The environment is validated when the app is constructed, so the generator
  // needs the required variables to be *present* — it never connects to
  // anything. A placeholder keeps this runnable in CI and on a laptop with
  // Docker closed, which is the point of committing the document rather than
  // serving it.
  process.env['DATABASE_URL'] ??= 'postgresql://openapi:generator@127.0.0.1:1/unused';
  process.env['NODE_ENV'] ??= 'development';

  // Created, but neither initialised nor listened on. `app.init()` would run
  // the module lifecycle hooks, and the first of those opens a database
  // connection — so a documentation generator that called it could not run in
  // CI, or on a laptop with Docker closed. Route metadata is available as soon
  // as the dependency graph is built.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const routes = collectRoutes(app).sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );

  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const { path, params } = toOpenApiPath(`/api/v1${route.path}`);
    paths[path] ??= {};

    paths[path][route.method.toLowerCase()] = {
      operationId: operationId(route),
      tags: [route.controller.replace(/Controller$/, '')],
      summary: `${route.controller}.${route.handler}`,
      description: route.isPublic
        ? 'Public: no authentication required.'
        : `Requires: ${route.permissions.join(', ') || '(none declared — the application would refuse to start)'}`,
      ...(params.length > 0
        ? {
            parameters: params.map((name) => ({
              name,
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            })),
          }
        : {}),
      security: route.isPublic ? [] : [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'Success. The body is the contract named in packages/contracts.' },
        '400': { description: 'Validation failed. RFC 9457 Problem Details with field-level errors.' },
        '401': { description: 'No access token, or it has expired.' },
        '403': { description: 'Authenticated, but the required permission is not held.' },
        '404': { description: 'No such record, or it is not visible within the caller’s tenant scope.' },
        '409': { description: 'A business rule refused the operation. The `type` field names which.' },
      },
      ...(route.permissions.length > 0
        ? { 'x-permissions': route.permissions }
        : {}),
    };
  }

  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Community Health Centre Platform API',
      version: '1.0.0',
      description: DESCRIPTION,
      license: { name: 'Proprietary' },
    },
    servers: [
      { url: 'http://127.0.0.1:3000', description: 'Local development' },
      { url: 'http://127.0.0.1:3100', description: 'Local demo (scripts/run-local.sh)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Ed25519-signed access token from POST /api/v1/auth/login. Ten minutes by default; ' +
            'refresh with POST /api/v1/auth/refresh.',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };

  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  // A markdown inventory beside it, because the question people actually ask is
  // "which permission do I need for this route" and nobody wants to read JSON
  // to answer it.
  const byTag = new Map<string, RouteInfo[]>();
  for (const route of routes) {
    const tag = route.controller.replace(/Controller$/, '');
    byTag.set(tag, [...(byTag.get(tag) ?? []), route]);
  }

  const mutating = routes.filter((route) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method));
  const publicRoutes = routes.filter((route) => route.isPublic);

  const lines: string[] = [
    '# API routes and the permission each requires',
    '',
    '*Generated from the router by `npm run openapi --workspace @chc/api`. Do not edit by hand.*',
    '',
    `${routes.length} routes — ${mutating.length} mutating, ${publicRoutes.length} public.`,
    '',
    'Every route declares a permission or is explicitly public. The application refuses to start if one',
    'declares neither, so this table cannot be incomplete while the API runs.',
    '',
    'Request and response bodies are the Zod schemas in `packages/contracts`, which both tiers import.',
    'They are not restated here: a second definition is a definition that can disagree.',
    '',
  ];

  for (const tag of [...byTag.keys()].sort()) {
    lines.push(`## ${tag}`, '', '| Method | Path | Permission |', '|---|---|---|');
    for (const route of byTag.get(tag)!) {
      lines.push(
        `| ${route.method} | \`/api/v1${route.path}\` | ${
          route.isPublic ? '*public*' : route.permissions.map((p) => `\`${p}\``).join(', ')
        } |`,
      );
    }
    lines.push('');
  }

  await writeFile(OUT_MD, lines.join('\n'), 'utf8');

  process.stdout.write(
    `${routes.length} routes written to docs/api/openapi.json and docs/api/routes.md\n`,
  );

  // Exited explicitly. Constructing the app opens handles — a Redis client
  // among them — and closing it would run the shutdown hooks, which expect the
  // database this generator deliberately never touched. The documents are
  // written; nothing is lost by leaving.
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
