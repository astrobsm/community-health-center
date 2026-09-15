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
import { FinanceService } from './finance/finance.service';
import { FinanceController } from './finance/finance.controller';
import { InventoryController, PharmacyController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { PharmacyService } from './inventory/pharmacy.service';
import { LaboratoryController } from './laboratory/laboratory.controller';
import { LaboratoryService } from './laboratory/laboratory.service';
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
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { InsightService } from './ai/insight.service';
import {
  AnthropicProvider,
  DeterministicNarrator,
  UngroundedProbeProvider,
  type LlmProvider,
} from './ai/llm-provider';
import { AnalyticsController, LineageController } from './analytics/analytics.controller';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { ComparisonService } from './analytics/comparison.service';
import { DashboardService } from './analytics/dashboard.service';
import { DataQualityService } from './analytics/data-quality.service';
import { LineageService } from './analytics/lineage.service';
import { KpiController } from './kpi/kpi.controller';
import { KpiService } from './kpi/kpi.service';
import { AttendanceService } from './people/attendance.service';
import {
  AttendanceController,
  CredentialController,
  IncentiveController,
  PerformanceController,
  StaffController,
} from './people/people.controller';
import { PerformanceService } from './people/performance.service';
import { StaffService } from './people/staff.service';
import {
  ComplaintController,
  IncidentController,
  QualityCycleController,
} from './quality/incident.controller';
import { IncidentService } from './quality/incident.service';
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
 *   finance   <- nothing above it: one door to the ledger, called by the rest
 *   inventory, pharmacy, laboratory <- finance (every movement posts)
 *   billing   <- finance: charges, invoices, payments and waivers. finance
 *                must never import billing — that edge is broken deliberately
 *   document  <- L4: reads from every domain module below it and writes none
 *   people    <- staff, credentials, attendance, performance, incentives (L3)
 *   kpi       <- L4: computes from every domain below it, writes only results
 *   analytics <- L5: dashboards, lineage, drill-down, benchmarking, data
 *                quality and search. Reads everything; writes nothing but the
 *                audit trail of who looked at what.
 *   ai        <- L5: grounded generation over the analytics layer. Writes only
 *                ai_insight, and the database role it reads with holds no
 *                write permission on anything else.
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
    InventoryController,
    PharmacyController,
    LaboratoryController,
    FinanceController,
    StaffController,
    CredentialController,
    AttendanceController,
    PerformanceController,
    IncentiveController,
    IncidentController,
    ComplaintController,
    QualityCycleController,
    KpiController,
    AnalyticsController,
    LineageController,
    BillingController,
    AiController,
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
      provide: FinanceService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new FinanceService(prisma, audit),
    },
    {
      provide: InventoryService,
      inject: [PrismaService, AuditService, FinanceService],
      useFactory: (prisma: PrismaService, audit: AuditService, finance: FinanceService) =>
        new InventoryService(prisma, audit, finance),
    },
    {
      provide: PharmacyService,
      inject: [PrismaService, AuditService, FinanceService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        audit: AuditService,
        finance: FinanceService,
        config: ConfigService,
      ) => new PharmacyService(prisma, audit, finance, config),
    },
    {
      provide: LaboratoryService,
      inject: [PrismaService, AuditService, FinanceService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        audit: AuditService,
        finance: FinanceService,
        config: ConfigService,
      ) => new LaboratoryService(prisma, audit, finance, config),
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
      provide: StaffService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new StaffService(prisma, audit),
    },
    {
      provide: AttendanceService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new AttendanceService(prisma, audit),
    },
    {
      provide: PerformanceService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new PerformanceService(prisma, audit),
    },
    {
      provide: IncidentService,
      inject: [PrismaService, AuditService],
      useFactory: (prisma: PrismaService, audit: AuditService) => new IncidentService(prisma, audit),
    },
    {
      provide: KpiService,
      inject: [PrismaService, AuditService, ConfigService],
      useFactory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
        new KpiService(prisma, audit, config),
    },
    {
      // The provider is configuration (doc 17 section 10). The default needs
      // no key and no network, and states no figure the queries did not return.
      provide: 'LlmProvider',
      inject: ['Env'],
      useFactory: (env: Env): LlmProvider => {
        if (env.AI_PROVIDER === 'anthropic') {
          return new AnthropicProvider({
            apiKey: env.AI_API_KEY ?? '',
            modelId: env.AI_MODEL_ID,
            baseUrl: env.AI_BASE_URL,
            timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
          });
        }

        // Exists to prove the grounding check rejects, and refused in
        // production by the environment schema.
        if (env.AI_PROVIDER === 'ungrounded-probe') return new UngroundedProbeProvider();

        return new DeterministicNarrator();
      },
    },
    {
      provide: AiService,
      inject: ['Env', PrismaService, AuditService, 'LlmProvider'],
      useFactory: (env: Env, prisma: PrismaService, audit: AuditService, provider: LlmProvider) =>
        new AiService(env, prisma, audit, provider),
    },
    {
      provide: InsightService,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => new InsightService(prisma, config),
    },
    {
      provide: BillingService,
      inject: [PrismaService, AuditService, FinanceService],
      useFactory: (prisma: PrismaService, audit: AuditService, finance: FinanceService) =>
        new BillingService(prisma, audit, finance),
    },
    {
      provide: DashboardService,
      inject: [PrismaService, AuditService, ConfigService],
      useFactory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
        new DashboardService(prisma, audit, config),
    },
    {
      provide: LineageService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new LineageService(prisma),
    },
    {
      provide: ComparisonService,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => new ComparisonService(prisma, config),
    },
    {
      provide: DataQualityService,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => new DataQualityService(prisma, config),
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
    FinanceService,
    InventoryService,
    PharmacyService,
    LaboratoryService,
    StaffService,
    AttendanceService,
    PerformanceService,
    IncidentService,
    KpiService,
    DashboardService,
    LineageService,
    ComparisonService,
    DataQualityService,
    BillingService,
    AiService,
    InsightService,
    ConfigService,
  ],
})
export class RevitalisationModule {}
