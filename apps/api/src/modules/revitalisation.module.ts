import { Module } from '@nestjs/common';

import type { Env } from '../config/env';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

import { AssessmentController, FindingController } from './assessment/assessment.controller';
import { AssessmentService } from './assessment/assessment.service';
import { AuditService } from './audit/audit.service';
import { BaselineController } from './baseline/baseline.controller';
import { BaselineService } from './baseline/baseline.service';
import { CapexController } from './capex/capex.controller';
import { CapexService } from './capex/capex.service';
import { EncounterController, PatientController } from './clinical/clinical.controller';
import { EncounterService } from './clinical/encounter.service';
import { PatientService } from './clinical/patient.service';
import { ConfigService } from './config/config.service';
import { AssetService } from './project/asset.service';
import { ContractService } from './document/contract.service';
import { DocumentContextService } from './document/document-context.service';
import { ContractController, DocumentController } from './document/document.controller';
import { DocumentService } from './document/document.service';
import { EvidenceController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { StorageService } from './evidence/storage.service';
import { FacilityController } from './facility/facility.controller';
import { FacilityService } from './facility/facility.service';
import { FinancialModelController } from './financial-model/financial-model.controller';
import { FinancialModelService } from './financial-model/financial-model.service';
import { NeedController, RecommendationController } from './needs/needs.controller';
import { NeedsService } from './needs/needs.service';
import { PartnershipController } from './partnership/partnership.controller';
import { PartnershipService } from './partnership/partnership.service';
import { ProcurementController } from './procurement/procurement.controller';
import { ProcurementService } from './procurement/procurement.service';
import { AssetController, ProjectController } from './project/project.controller';
import { ProjectService } from './project/project.service';
import { ComplianceController, RiskController } from './quality/quality.controller';
import { QualityService } from './quality/quality.service';

/**
 * Mode A — the revitalisation command centre (doc 00 §3).
 *
 * Dependencies flow downward only, as the boundary checker enforces:
 *   facility  <- assessment <- baseline
 *   evidence  <- assessment, baseline
 *   needs     <- assessment (a need cites a finding)
 *   capex     <- needs
 *   partnership <- financial-model (the terms are negotiated against a model)
 *   quality   <- sits above them all (L4): risk and compliance registers
 *   project   <- capex (a project delivers a costed recommendation)
 *   procurement <- project; asset <- procurement (a receipt creates an asset)
 *   patient   <- facility; encounter <- patient (consent gates care)
 *   document  <- L4: reads from every domain module below it and writes none
 *   config    <- everything above it
 *
 * `baseline` depends on `evidence` (it must know what is still uploading) but
 * evidence knows nothing about baselines — that direction would be a cycle.
 *
 * `financial-model` deliberately depends on nothing above it. It reads its own
 * assumptions and computes; that isolation is what lets the projection be
 * tested exhaustively without a database.
 */
@Module({
  controllers: [
    FacilityController,
    AssessmentController,
    FindingController,
    EvidenceController,
    BaselineController,
    NeedController,
    RecommendationController,
    CapexController,
    RiskController,
    ComplianceController,
    FinancialModelController,
    PartnershipController,
    DocumentController,
    ContractController,
    ProjectController,
    AssetController,
    ProcurementController,
    PatientController,
    EncounterController,
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
    {
      provide: NeedsService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new NeedsService(prisma, audit),
    },
    {
      provide: CapexService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new CapexService(prisma, audit),
    },
    {
      provide: QualityService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new QualityService(prisma, audit),
    },
    {
      provide: FinancialModelService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new FinancialModelService(prisma, audit),
    },
    {
      provide: PartnershipService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new PartnershipService(prisma, audit),
    },
    {
      provide: DocumentContextService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new DocumentContextService(prisma),
    },
    {
      provide: DocumentService,
      inject: ['Env', PrismaService, DocumentContextService, StorageService, AuditService, ConfigService],
      useFactory: (
        env: Env,
        prisma: PrismaService,
        context: DocumentContextService,
        storage: StorageService,
        audit: AuditService,
        config: ConfigService,
      ) => new DocumentService(env, prisma, context, storage, audit, config),
    },
    {
      provide: ProjectService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new ProjectService(prisma, audit),
    },
    {
      provide: AssetService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new AssetService(prisma, audit),
    },
    {
      provide: ProcurementService,
      inject: [PrismaService, AuditService, ConfigService],
      useFactory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
        new ProcurementService(prisma, audit, config),
    },
    {
      provide: PatientService,
      inject: [PrismaService, AuditService, ConfigService],
      useFactory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
        new PatientService(prisma, audit, config),
    },
    {
      provide: EncounterService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new EncounterService(prisma, audit),
    },
    {
      provide: ContractService,
      inject: ['Env', PrismaService, StorageService, AuditService],
      useFactory: (env: Env, prisma: PrismaService, storage: StorageService, audit: AuditService) =>
        new ContractService(env, prisma, storage, audit),
    },
  ],
  exports: [
    FacilityService,
    AssessmentService,
    EvidenceService,
    BaselineService,
    NeedsService,
    CapexService,
    QualityService,
    FinancialModelService,
    PartnershipService,
    DocumentService,
    ContractService,
    ProjectService,
    AssetService,
    ProcurementService,
    PatientService,
    EncounterService,
    ConfigService,
  ],
})
export class RevitalisationModule {}
