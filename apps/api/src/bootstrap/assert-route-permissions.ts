import { Logger, type INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import { isPermission } from '@chc/contracts';

import { PERMISSION_KEY, PUBLIC_KEY } from '../common/decorators';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Nest's internal RequestMethod enum, by ordinal.
const METHOD_NAMES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/**
 * Boot-time assertion: every route declares either a permission or @Public().
 *
 * The PermissionsGuard already refuses an undeclared route at request time, so
 * this is belt and braces — but it is the difference between discovering the
 * omission in code review and discovering it when an unprotected endpoint is
 * called in production. The application refuses to start rather than serve one.
 *
 * Returns the inventory, which the audit-coverage test uses to enumerate every
 * mutating route and confirm each produces an audit record.
 */
export interface RouteInfo {
  controller: string;
  handler: string;
  method: string;
  path: string;
  permissions: string[];
  isPublic: boolean;
}

export function collectRoutes(app: INestApplication): RouteInfo[] {
  const modules = app.get(ModulesContainer);
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const module of modules.values()) {
    for (const controller of module.controllers.values()) {
      const instance = controller.instance as object | undefined;
      if (!instance) continue;

      const controllerPath = (Reflect.getMetadata(PATH_METADATA, controller.metatype as object) ?? '') as string;
      const controllerPublic = Boolean(Reflect.getMetadata(PUBLIC_KEY, controller.metatype as object));
      const controllerPermissions = (Reflect.getMetadata(PERMISSION_KEY, controller.metatype as object) ??
        []) as string[];

      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue; // not a route handler

        const methodOrdinal = Reflect.getMetadata('method', handler) as number | undefined;
        const method = METHOD_NAMES[methodOrdinal ?? 0] ?? 'GET';

        const permissions = ((Reflect.getMetadata(PERMISSION_KEY, handler) ?? controllerPermissions) ??
          []) as string[];
        const isPublic = Boolean(Reflect.getMetadata(PUBLIC_KEY, handler)) || controllerPublic;

        routes.push({
          controller: controller.metatype?.name ?? 'unknown',
          handler: methodName,
          method,
          path: `/${controllerPath}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/',
          permissions,
          isPublic,
        });
      }
    }
  }

  return routes;
}

export function assertRoutePermissions(app: INestApplication): RouteInfo[] {
  const logger = new Logger('RouteAudit');
  const routes = collectRoutes(app);
  const problems: string[] = [];

  for (const route of routes) {
    const label = `${route.method} ${route.path} (${route.controller}.${route.handler})`;

    if (route.isPublic) {
      if (route.permissions.length > 0) {
        problems.push(`${label} is marked @Public() but also declares a permission. Choose one.`);
      }
      continue;
    }

    if (route.permissions.length === 0) {
      problems.push(
        `${label} declares no permission. Add @RequirePermission(...), or @Public() if it genuinely needs none.`,
      );
      continue;
    }

    for (const permission of route.permissions) {
      if (!isPermission(permission)) {
        problems.push(`${label} requires "${permission}", which is not in the permission catalogue.`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: ${problems.length} route(s) are not correctly protected.\n\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nSee docs/architecture/08-rbac.md.',
    );
  }

  const publicRoutes = routes.filter((r) => r.isPublic);
  const mutating = routes.filter((r) => MUTATING_METHODS.has(r.method));

  logger.log(
    `${routes.length} route(s): ${mutating.length} mutating, ${publicRoutes.length} public. All protected.`,
  );

  // Public routes are few and each should be obvious; list them at boot so a
  // new one is visible in the logs rather than only in a diff.
  for (const route of publicRoutes) {
    logger.log(`  public: ${route.method} ${route.path}`);
  }

  return routes;
}
