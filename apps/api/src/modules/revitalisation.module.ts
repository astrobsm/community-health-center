import { Module } from '@nestjs/common';

import type { Env } from '../config/env';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

import { AssessmentController, FindingController } from './assessment/assessment.controller';
import { AssessmentService } from './assessment/assessment.service';
import { AuditService } from './audit/audit.service';
import { BaselineController } from './baseline/baseline.controller';
import { BaselineService } from './baseline/baseline.service';
import { ConfigService } from './config/config.service';
import { EvidenceController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { StorageService } from './evidence/storage.service';
import { FacilityController } from './facility/facility.controller';
import { FacilityService } from './facility/facility.service';

/**
 * Mode A — the revitalisation command centre (doc 00 §3).
 *
 * Dependencies flow downward only, as the boundary checker enforces:
 *   facility  <- assessment <- baseline
 *   evidence  <- assessment, baseline
 *   config    <- everything above it
 *
 * `baseline` depends on `evidence` (it must know what is still uploading) but
 * evidence knows nothing about baselines — that direction would be a cycle.
 */
@Module({
  controllers: [
    FacilityController,
    AssessmentController,
    FindingController,
    EvidenceController,
    BaselineController,
  ],
  providers: [
    {
      provide: ConfigService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new ConfigService(prisma, audit),
    },
    {
      provide: StorageService,
      inject: ['Env'],
      useFactory: (env: Env) => new StorageService(env),
    },
    {
      provide: FacilityService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new FacilityService(prisma, audit),
    },
    {
      provide: EvidenceService,
      inject: ['Env', PrismaService, StorageService, AuditService],
      useFactory: (env: Env, prisma: PrismaService, storage: StorageService, audit: AuditService) =>
        new EvidenceService(env, prisma, storage, audit),
    },
    {
      provide: AssessmentService,
      inject: [PrismaService, AuditService, ConfigService],
      useFactory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
        new AssessmentService(prisma, audit, config),
    },
    {
      provide: BaselineService,
      inject: [PrismaService, AuditService, ConfigService, EvidenceService],
      useFactory: (
        prisma: PrismaService,
        audit: AuditService,
        config: ConfigService,
        evidence: EvidenceService,
      ) => new BaselineService(prisma, audit, config, evidence),
    },
  ],
  exports: [FacilityService, AssessmentService, EvidenceService, BaselineService, ConfigService],
})
export class RevitalisationModule {}
