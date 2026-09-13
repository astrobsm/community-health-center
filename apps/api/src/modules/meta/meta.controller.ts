import { Controller, Get, Inject } from '@nestjs/common';

import { Public } from '../../common/decorators';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Version and health.
 *
 * The client calls `/meta/version` after every successful sync, so a field
 * device that has been offline for a fortnight learns it is too old to keep
 * writing before it captures another day of data it cannot push.
 */
@Controller({ path: 'meta', version: '1' })
export class MetaController {
  constructor(
    @Inject('Env') private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('version')
  version() {
    return {
      apiVersion: 'v1',
      /**
       * Clients older than this are refused at sync. It exists so a breaking
       * change cannot silently corrupt records captured by a stale client.
       */
      minimumClientVersion: '0.1.0',
      environment: this.env.NODE_ENV,
      displayTimezone: this.env.DISPLAY_TIMEZONE,
      aiEnabled: this.env.AI_ENABLED,
    };
  }

  /**
   * Liveness and readiness in one.
   *
   * Reports degraded rather than throwing, so an orchestrator can distinguish
   * "starting" from "broken", and returns what actually failed rather than a
   * bare boolean.
   */
  @Public()
  @Get('health')
  async health() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = { ok: true };
    } catch (error) {
      checks['database'] = { ok: false, detail: (error as Error).message };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return { status: ok ? 'ok' : 'degraded', checks, checkedAt: new Date().toISOString() };
  }
}
