-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "assess";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "clinical";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "exec";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "fin";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "people";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "plan";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "qual";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "supply";

-- CreateEnum
CREATE TYPE "core"."DataClassification" AS ENUM ('ACTUAL', 'VERIFIED', 'REPORTED', 'ESTIMATED', 'ASSUMPTION', 'PROJECTED', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "core"."SyncStatus" AS ENUM ('LOCAL_ONLY', 'PENDING', 'SYNCED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "audit"."ConflictType" AS ENUM ('CONCURRENT_EDIT', 'STALE_UPDATE', 'DELETED_REMOTELY', 'BUSINESS_RULE', 'SEALED_ENTITY', 'DUPLICATE_CANDIDATE');

-- CreateEnum
CREATE TYPE "audit"."ConflictResolution" AS ENUM ('KEEP_BOTH', 'KEEP_LOCAL', 'KEEP_SERVER', 'MERGED', 'REJECTED', 'PENDING');

-- CreateEnum
CREATE TYPE "core"."ApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "plan"."PriorityClass" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "core"."Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "core"."FacilityLifecycleStage" AS ENUM ('PRE_ASSESSMENT', 'DUE_DILIGENCE', 'FIELD_ASSESSMENT', 'BASELINE_ESTABLISHED', 'PLANNING', 'PROPOSAL', 'GOVERNMENT_REVIEW', 'AGREEMENT', 'IMPLEMENTATION', 'COMMISSIONING', 'LIVE_OPERATIONS', 'CONTINUOUS_IMPROVEMENT', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "core"."RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "clinical"."Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "core"."OwnerType" AS ENUM ('FEDERAL_GOVERNMENT', 'STATE_GOVERNMENT', 'LOCAL_GOVERNMENT', 'COMMUNITY', 'PRIVATE', 'FAITH_BASED', 'NGO', 'OTHER');

-- CreateEnum
CREATE TYPE "core"."ServiceCategory" AS ENUM ('CONSULTATION', 'LABORATORY', 'PHARMACY', 'PROCEDURE', 'MATERNITY', 'IMMUNISATION', 'PREVENTIVE', 'ADMISSION', 'IMAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "core"."UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "core"."ScopeLevel" AS ENUM ('FULL', 'DEPARTMENT', 'AGGREGATE_ONLY', 'SELF_ONLY');

-- CreateEnum
CREATE TYPE "core"."RefreshTokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "core"."MfaFactorType" AS ENUM ('TOTP', 'RECOVERY_CODE');

-- CreateEnum
CREATE TYPE "assess"."TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "assess"."ResponseType" AS ENUM ('BOOLEAN', 'SCALE', 'NUMBER', 'TEXT', 'SELECT', 'MULTISELECT', 'DATE', 'CURRENCY');

-- CreateEnum
CREATE TYPE "assess"."AssessmentType" AS ENUM ('PRE_ASSESSMENT', 'DUE_DILIGENCE', 'FIELD', 'FOLLOW_UP', 'POST_INTERVENTION');

-- CreateEnum
CREATE TYPE "assess"."AssessmentStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'SEALED');

-- CreateEnum
CREATE TYPE "assess"."EvidenceSource" AS ENUM ('PHOTOGRAPH', 'DOCUMENT', 'SCANNED_DOCUMENT', 'INTERVIEW', 'FINANCIAL_RECORD', 'SYSTEM_RECORD', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "assess"."MediaStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADING', 'AVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "assess"."EvidenceStage" AS ENUM ('BEFORE', 'DURING', 'AFTER', 'BASELINE', 'ROUTINE');

-- CreateEnum
CREATE TYPE "plan"."CapexCategory" AS ENUM ('BUILDING', 'EQUIPMENT', 'LABORATORY', 'PHARMACY', 'FURNITURE', 'ICT', 'POWER', 'WATER', 'SECURITY', 'WASTE', 'INITIAL_STOCK', 'WORKING_CAPITAL', 'TRAINING', 'CONTINGENCY');

-- CreateEnum
CREATE TYPE "plan"."ModelStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "plan"."ScenarioType" AS ENUM ('CONSERVATIVE', 'BASE', 'GROWTH', 'STRESS');

-- CreateEnum
CREATE TYPE "plan"."PartnershipStatus" AS ENUM ('PROPOSED', 'UNDER_NEGOTIATION', 'AGREED', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "plan"."PartyRole" AS ENUM ('GOVERNMENT', 'PARTNER', 'COMMUNITY', 'FUNDER', 'OTHER');

-- CreateEnum
CREATE TYPE "plan"."ObligationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'MET', 'BREACHED', 'WAIVED');

-- CreateEnum
CREATE TYPE "plan"."RevenueShareType" AS ENUM ('SURPLUS_SHARE', 'GROSS_REVENUE_SHARE', 'HYBRID');

-- CreateEnum
CREATE TYPE "plan"."WaterfallBasis" AS ENUM ('GROSS_REVENUE', 'OPERATING_SURPLUS', 'FIXED', 'RESIDUAL');

-- CreateEnum
CREATE TYPE "plan"."RecoveryEventType" AS ENUM ('INVESTMENT', 'RECOVERY', 'RETURN');

-- CreateEnum
CREATE TYPE "plan"."LetterStatus" AS ENUM ('DRAFT', 'APPROVED', 'DISPATCHED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "plan"."ContractType" AS ENUM ('MOU', 'MANAGEMENT_AGREEMENT', 'SERVICE_AGREEMENT', 'AMENDMENT');

-- CreateEnum
CREATE TYPE "plan"."ContractStatus" AS ENUM ('DRAFT', 'UNDER_LEGAL_REVIEW', 'UNDER_GOVERNMENT_REVIEW', 'AGREED', 'EXECUTED', 'TERMINATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "plan"."ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELEGATED');

-- CreateEnum
CREATE TYPE "exec"."ConditionRating" AS ENUM ('GOOD', 'FAIR', 'POOR', 'UNUSABLE', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "exec"."UtilityType" AS ENUM ('GRID_POWER', 'GENERATOR', 'SOLAR', 'BOREHOLE', 'PIPED_WATER', 'RAINWATER', 'INTERNET', 'TELEPHONE', 'WASTE_DISPOSAL', 'SEWAGE', 'COLD_CHAIN');

-- CreateEnum
CREATE TYPE "exec"."ProjectStatus" AS ENUM ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "exec"."TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "exec"."DependencyType" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateEnum
CREATE TYPE "exec"."ProcurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'QUOTING', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'INVOICED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "exec"."InvoiceMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'VARIANCE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "exec"."CommissioningStatus" AS ENUM ('NOT_RECEIVED', 'RECEIVED', 'INSTALLED', 'TESTED', 'COMMISSIONED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "exec"."MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'CALIBRATION', 'INSPECTION');

-- CreateEnum
CREATE TYPE "clinical"."PatientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DECEASED', 'MERGED');

-- CreateEnum
CREATE TYPE "clinical"."IdentifierType" AS ENUM ('FACILITY_MRN', 'NIN', 'NHIS', 'HMO', 'PHONE', 'VOTER_ID', 'OTHER');

-- CreateEnum
CREATE TYPE "clinical"."ConsentPurpose" AS ENUM ('TREATMENT', 'DATA_STORAGE', 'SMS_CONTACT', 'RESEARCH_AGGREGATE', 'PHOTOGRAPH', 'GOVERNMENT_AGGREGATE_REPORTING');

-- CreateEnum
CREATE TYPE "clinical"."EncounterType" AS ENUM ('OPD', 'ANC', 'DELIVERY', 'POSTNATAL', 'IMMUNISATION', 'FAMILY_PLANNING', 'CHRONIC_FOLLOWUP', 'EMERGENCY', 'ADMISSION', 'OUTREACH', 'TELECONSULT');

-- CreateEnum
CREATE TYPE "clinical"."EncounterStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."TriageCategory" AS ENUM ('RED', 'ORANGE', 'YELLOW', 'GREEN');

-- CreateEnum
CREATE TYPE "clinical"."NoteType" AS ENUM ('CONSULTATION', 'PROGRESS', 'PROCEDURE', 'DISCHARGE', 'REFERRAL');

-- CreateEnum
CREATE TYPE "clinical"."ClinicalRecordStatus" AS ENUM ('DRAFT', 'SIGNED', 'AMENDED');

-- CreateEnum
CREATE TYPE "clinical"."DiagnosisType" AS ENUM ('PRIMARY', 'SECONDARY', 'DIFFERENTIAL', 'PROVISIONAL', 'CONFIRMED', 'RULED_OUT');

-- CreateEnum
CREATE TYPE "clinical"."ReferralStatus" AS ENUM ('INITIATED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'ATTENDED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."PrescriptionStatus" AS ENUM ('DRAFT', 'ISSUED', 'VERIFIED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."StockCertainty" AS ENUM ('ACTUAL', 'PROVISIONAL');

-- CreateEnum
CREATE TYPE "clinical"."LabOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'IN_PROCESS', 'RESULTED', 'VERIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."ResultFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL', 'INDETERMINATE');

-- CreateEnum
CREATE TYPE "clinical"."LabResultStatus" AS ENUM ('PRELIMINARY', 'VERIFIED', 'AMENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clinical"."ChronicConditionStatus" AS ENUM ('ACTIVE', 'CONTROLLED', 'UNCONTROLLED', 'DEFAULTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "supply"."InventoryItemKind" AS ENUM ('MEDICINE', 'CONSUMABLE', 'REAGENT', 'VACCINE', 'EQUIPMENT_SPARE', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "supply"."LocationType" AS ENUM ('MAIN_STORE', 'DISPENSARY', 'LABORATORY', 'WARD', 'THEATRE', 'OUTREACH_KIT', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "supply"."BatchStatus" AS ENUM ('ACTIVE', 'NEAR_EXPIRY', 'EXPIRED', 'QUARANTINED', 'RECALLED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "supply"."StockTransactionType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'RETURN', 'WASTAGE');

-- CreateEnum
CREATE TYPE "supply"."StockCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fin"."AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'DIRECT_COST', 'EXPENSE', 'DISTRIBUTION');

-- CreateEnum
CREATE TYPE "fin"."NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "fin"."PeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "fin"."JournalStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "fin"."ChargeStatus" AS ENUM ('DRAFT', 'RAISED', 'INVOICED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fin"."InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "fin"."PayerType" AS ENUM ('SELF_PAY', 'NHIS', 'HMO', 'EMPLOYER', 'GOVERNMENT', 'WAIVER');

-- CreateEnum
CREATE TYPE "fin"."PaymentMethod" AS ENUM ('CASH', 'POS', 'BANK_TRANSFER', 'NHIS', 'HMO', 'WAIVER', 'OTHER');

-- CreateEnum
CREATE TYPE "fin"."PaymentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "fin"."BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'REVISED', 'CLOSED');

-- CreateEnum
CREATE TYPE "people"."StaffStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "people"."EmployerType" AS ENUM ('GOVERNMENT', 'PARTNER', 'LOCUM', 'VOLUNTEER', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "people"."CredentialStatus" AS ENUM ('VALID', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "people"."ShiftType" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'ON_CALL', 'OUTREACH');

-- CreateEnum
CREATE TYPE "people"."AttendanceEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "people"."AttendanceMethod" AS ENUM ('QR', 'PIN', 'BIOMETRIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "people"."LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'TAKEN');

-- CreateEnum
CREATE TYPE "people"."MetricDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER');

-- CreateEnum
CREATE TYPE "people"."IncentiveStatus" AS ENUM ('DRAFT', 'COMPUTED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "qual"."KpiDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER', 'TARGET_RANGE');

-- CreateEnum
CREATE TYPE "qual"."RagStatus" AS ENUM ('GREEN', 'AMBER', 'RED', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "qual"."RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "qual"."IncidentStatus" AS ENUM ('REPORTED', 'UNDER_INVESTIGATION', 'ACTION_TAKEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "qual"."ComplaintStatus" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "qual"."QiStatus" AS ENUM ('IDENTIFIED', 'ANALYSING', 'INTERVENING', 'MEASURING', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "qual"."ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "qual"."ComplianceState" AS ENUM ('NOT_ASSESSED', 'COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "qual"."DocumentType" AS ENUM ('PRE_ASSESSMENT_REPORT', 'DUE_DILIGENCE_REPORT', 'BASELINE_REPORT', 'NEEDS_ASSESSMENT', 'CAPITAL_PLAN', 'FIVE_YEAR_FINANCIAL_REPORT', 'BUSINESS_CASE', 'FULL_PROPOSAL', 'CHAIRMAN_BRIEF', 'LETTER', 'IMPLEMENTATION_PLAN', 'MOU', 'MANAGEMENT_AGREEMENT', 'COMMISSIONING_REPORT', 'MONTHLY_REPORT', 'QUARTERLY_REPORT', 'ANNUAL_REPORT');

-- CreateEnum
CREATE TYPE "qual"."DocumentStatus" AS ENUM ('DRAFT', 'REVIEW', 'REVISION', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "qual"."InsightType" AS ENUM ('SUMMARY', 'ANOMALY', 'FORECAST_COMMENTARY', 'DRAFT', 'RECOMMENDATION', 'ANSWER', 'DATA_GAP');

-- CreateEnum
CREATE TYPE "qual"."ReviewOutcome" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EDITED');

-- CreateEnum
CREATE TYPE "audit"."AuditActorType" AS ENUM ('USER', 'SYSTEM', 'INTEGRATION', 'AI');

-- CreateEnum
CREATE TYPE "audit"."AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "audit"."AuditSeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "audit"."OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "audit"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "audit"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "audit"."BackupType" AS ENUM ('WAL_ARCHIVE', 'LOGICAL_DUMP', 'BASE_BACKUP', 'OFFSITE_COPY');

-- CreateTable
CREATE TABLE "core"."organisation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address_line" TEXT,
    "display_timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."facility_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "facility_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."facility" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_type_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lifecycle_stage" "core"."FacilityLifecycleStage" NOT NULL DEFAULT 'PRE_ASSESSMENT',
    "baseline_date" DATE,
    "go_live_date" DATE,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."facility_location" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "ward" TEXT,
    "town" TEXT,
    "address_line" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'REPORTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "facility_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."facility_ownership" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "owner_type" "core"."OwnerType" NOT NULL,
    "owner_name" TEXT NOT NULL,
    "custodian_name" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "title_reference" TEXT,
    "notes" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'REPORTED',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "facility_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."facility_stage_transition" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "from_stage" "core"."FacilityLifecycleStage",
    "to_stage" "core"."FacilityLifecycleStage" NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_by" UUID,

    CONSTRAINT "facility_stage_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."department" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."service" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "core"."ServiceCategory" NOT NULL,
    "description" TEXT,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."service_offering" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "department_id" UUID,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "available_from" DATE,
    "unavailable_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_offering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."tariff_version" (
    "id" UUID NOT NULL,
    "service_offering_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tariff_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."app_user" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(6),
    "status" "core"."UserStatus" NOT NULL DEFAULT 'INVITED',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "permission_version" INTEGER NOT NULL DEFAULT 1,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "privacy_notice_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."role" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."user_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."role_permission" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "is_denial" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."user_facility_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "scope_level" "core"."ScopeLevel" NOT NULL DEFAULT 'FULL',
    "department_id" UUID,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_facility_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."user_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT,
    "device_label" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."refresh_token" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "status" "core"."RefreshTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_id" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."user_mfa_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "factor_type" "core"."MfaFactorType" NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "label" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."system_configuration" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "system_configuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."idempotency_record" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB,
    "entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."community" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ward" TEXT,
    "distance_km" DECIMAL(6,2),
    "travel_time_minutes" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."community_profile" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "catchment_population" INTEGER,
    "household_count" INTEGER,
    "under5_population" INTEGER,
    "women_of_childbearing_age" INTEGER,
    "primary_occupation" TEXT,
    "transport_modes" TEXT,
    "road_access" TEXT,
    "competing_facilities" TEXT,
    "stated_health_needs" TEXT,
    "affordability_notes" TEXT,
    "community_expectations" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'REPORTED',
    "source_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "community_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."community_survey" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "conducted_on" DATE,
    "respondent_count" INTEGER NOT NULL DEFAULT 0,
    "methodology" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "community_survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."community_survey_response" (
    "id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "question_code" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "respondent_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "community_survey_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_template" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "assessment_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_template_version" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "assess"."TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "change_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_section" (
    "id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "weight" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_item" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "help_text" TEXT,
    "response_type" "assess"."ResponseType" NOT NULL,
    "options" JSONB,
    "unit" TEXT,
    "sequence" INTEGER NOT NULL,
    "weight" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "scoring_rule" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."facility_assessment" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "assessment_type" "assess"."AssessmentType" NOT NULL,
    "status" "assess"."AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "completion_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "lead_assessor_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "facility_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_response" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "answer" JSONB,
    "score" DECIMAL(8,4),
    "note" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'REPORTED',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "amends_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "assessment_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_finding" (
    "id" UUID NOT NULL,
    "response_id" UUID,
    "assessment_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "core"."Severity" NOT NULL DEFAULT 'MEDIUM',
    "priority_class" "plan"."PriorityClass" NOT NULL DEFAULT 'P3',
    "priority_score" DECIMAL(8,4),
    "priority_inputs" JSONB,
    "priority_override_reason" TEXT,
    "estimated_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "cost_classification" "core"."DataClassification" NOT NULL DEFAULT 'ESTIMATED',
    "recommendation_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "assessment_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."evidence" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "source" "assess"."EvidenceSource" NOT NULL,
    "description" TEXT,
    "captured_on" TIMESTAMPTZ(6),
    "captured_by" UUID,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "verification_note" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'VERIFIED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."photograph" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'image/webp',
    "size_bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "content_hash" TEXT,
    "captured_at" TIMESTAMPTZ(6),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "caption" TEXT,
    "category" TEXT,
    "stage" "assess"."EvidenceStage" NOT NULL DEFAULT 'BASELINE',
    "paired_with_id" UUID,
    "media_status" "assess"."MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "photograph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."evidence_document" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "content_hash" TEXT,
    "document_type" TEXT,
    "ocr_text" TEXT,
    "media_status" "assess"."MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "evidence_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_evidence" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "assessment_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."finding_evidence" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "finding_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."assessment_score" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "section_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "domain_code" TEXT NOT NULL,
    "raw_score" DECIMAL(10,4) NOT NULL,
    "max_score" DECIMAL(10,4) NOT NULL,
    "weight" DECIMAL(8,4) NOT NULL,
    "normalised_score" DECIMAL(5,4) NOT NULL,
    "excluded_item_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."baseline_snapshot" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "assessment_id" UUID,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "sealed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealed_by" UUID,
    "content_hash" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baseline_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assess"."baseline_metric" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "metric_code" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "domain_code" TEXT,
    "numeric_value" DECIMAL(18,6),
    "text_value" TEXT,
    "unit" TEXT,
    "classification" "core"."DataClassification" NOT NULL,
    "source_reference" TEXT,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baseline_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."need" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "finding_id" UUID,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain_code" TEXT,
    "unlinked_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "need_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."recommendation" (
    "id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority_class" "plan"."PriorityClass" NOT NULL DEFAULT 'P3',
    "priority_score" DECIMAL(8,4),
    "priority_inputs" JSONB,
    "expected_outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."capex_plan" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "status" "core"."ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "capex_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."capex_line" (
    "id" UUID NOT NULL,
    "capex_plan_id" UUID NOT NULL,
    "recommendation_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "category" "plan"."CapexCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unit_cost_minor" BIGINT NOT NULL,
    "estimated_cost_minor" BIGINT NOT NULL,
    "approved_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "priority_class" "plan"."PriorityClass" NOT NULL DEFAULT 'P3',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ESTIMATED',
    "cost_basis" TEXT,
    "status" "core"."ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "capex_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."working_capital_plan" (
    "id" UUID NOT NULL,
    "capex_plan_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "months_of_cover" INTEGER NOT NULL DEFAULT 3,
    "opening_stock_minor" BIGINT NOT NULL DEFAULT 0,
    "staff_costs_minor" BIGINT NOT NULL DEFAULT 0,
    "utilities_minor" BIGINT NOT NULL DEFAULT 0,
    "contingency_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ESTIMATED',
    "assumptions_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "working_capital_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."financial_model" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "status" "plan"."ModelStatus" NOT NULL DEFAULT 'DRAFT',
    "horizon_months" INTEGER NOT NULL DEFAULT 60,
    "start_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "superseded_by_id" UUID,
    "change_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."model_assumption" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "numeric_value" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "rationale" TEXT,
    "source_reference" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ASSUMPTION',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "model_assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."model_scenario" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "scenario_type" "plan"."ScenarioType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assumption_overrides" JSONB,
    "break_even_month" INTEGER,
    "payback_month" INTEGER,
    "computed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "model_scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."model_projection" (
    "id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "period_index" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "patient_count" DECIMAL(12,2) NOT NULL,
    "revenue_minor" BIGINT NOT NULL,
    "collections_minor" BIGINT NOT NULL,
    "direct_cost_minor" BIGINT NOT NULL,
    "opex_minor" BIGINT NOT NULL,
    "staff_cost_minor" BIGINT NOT NULL,
    "incentive_minor" BIGINT NOT NULL,
    "depreciation_minor" BIGINT NOT NULL DEFAULT 0,
    "surplus_minor" BIGINT NOT NULL,
    "capex_minor" BIGINT NOT NULL DEFAULT 0,
    "cash_balance_minor" BIGINT NOT NULL,
    "cumulative_surplus_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'PROJECTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."partnership" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "financial_model_id" UUID,
    "name" TEXT NOT NULL,
    "status" "plan"."PartnershipStatus" NOT NULL DEFAULT 'PROPOSED',
    "commencement_date" DATE,
    "term_months" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "partnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."partnership_party" (
    "id" UUID NOT NULL,
    "partnership_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "party_role" "plan"."PartyRole" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "representative" TEXT,
    "title" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "partnership_party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."partnership_obligation" (
    "id" UUID NOT NULL,
    "partnership_id" UUID NOT NULL,
    "party_id" UUID,
    "organisation_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "due_date" DATE,
    "status" "plan"."ObligationStatus" NOT NULL DEFAULT 'PENDING',
    "evidence_note" TEXT,
    "met_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "partnership_obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."revenue_share_model" (
    "id" UUID NOT NULL,
    "partnership_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "share_type" "plan"."RevenueShareType" NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "revenue_share_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."waterfall_step" (
    "id" UUID NOT NULL,
    "revenue_share_model_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "plan"."WaterfallBasis" NOT NULL,
    "rate" DECIMAL(12,6),
    "fixed_amount_minor" BIGINT,
    "cap_minor" BIGINT,
    "floor_minor" BIGINT,
    "beneficiary_party_id" UUID,
    "account_code" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "waterfall_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."capital_recovery_event" (
    "id" UUID NOT NULL,
    "partnership_id" UUID NOT NULL,
    "party_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "event_type" "plan"."RecoveryEventType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "occurred_on" DATE NOT NULL,
    "source_payment_id" UUID,
    "description" TEXT,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "capital_recovery_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."proposal" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "status" "core"."ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_to" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."proposal_section" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "body_text" TEXT,
    "data_source_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "proposal_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."letter_template" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "letter_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."letter" (
    "id" UUID NOT NULL,
    "template_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_title" TEXT,
    "recipient_office" TEXT,
    "recipient_address" TEXT,
    "sender_name" TEXT,
    "sender_title" TEXT,
    "status" "plan"."LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "dispatched_at" TIMESTAMPTZ(6),
    "dispatch_method" TEXT,
    "enclosures" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."contract" (
    "id" UUID NOT NULL,
    "partnership_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "contract_type" "plan"."ContractType" NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "plan"."ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "executed_at" TIMESTAMPTZ(6),
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."contract_version" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "storage_key" TEXT,
    "content_hash" TEXT NOT NULL,
    "change_summary" TEXT,
    "is_executed_copy" BOOLEAN NOT NULL DEFAULT false,
    "signatories" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "contract_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan"."approval" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "proposal_id" UUID,
    "contract_id" UUID,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "approver_user_id" UUID,
    "approver_role" TEXT,
    "decision" "plan"."ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."room" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "department_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "area_sqm" DECIMAL(10,2),
    "condition" "exec"."ConditionRating" NOT NULL DEFAULT 'NOT_ASSESSED',
    "is_usable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."infrastructure_item" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "room_id" UUID,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" "exec"."ConditionRating" NOT NULL DEFAULT 'NOT_ASSESSED',
    "estimated_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ESTIMATED',
    "assessed_at" TIMESTAMPTZ(6),
    "assessed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "infrastructure_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."utility" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "utility_type" "exec"."UtilityType" NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "available_hours_per_day" DECIMAL(4,1),
    "condition" "exec"."ConditionRating" NOT NULL DEFAULT 'NOT_ASSESSED',
    "capacity_note" TEXT,
    "monthly_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'REPORTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "utility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."capital_project" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "recommendation_id" UUID,
    "capex_line_id" UUID,
    "unplanned_reason" TEXT,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "plan"."CapexCategory" NOT NULL,
    "priority_class" "plan"."PriorityClass" NOT NULL DEFAULT 'P3',
    "status" "exec"."ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_user_id" UUID,
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "completion_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "capital_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_phase" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "status" "exec"."ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_task" (
    "id" UUID NOT NULL,
    "phase_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" UUID,
    "status" "exec"."TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "weight" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "percent_complete" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "estimated_days" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_task_dependency" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "predecessor_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "dependency_type" "exec"."DependencyType" NOT NULL DEFAULT 'FS',
    "lag_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_task_dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_milestone" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "due_date" DATE,
    "achieved_date" DATE,
    "verification_note" TEXT,
    "verified_by" UUID,
    "is_payment_linked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_budget" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "budgeted_minor" BIGINT NOT NULL DEFAULT 0,
    "approved_minor" BIGINT NOT NULL DEFAULT 0,
    "committed_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_expense" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "incurred_on" DATE NOT NULL,
    "payment_id" UUID,
    "supplier_invoice_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."project_evidence" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "stage" "assess"."EvidenceStage" NOT NULL,
    "caption" TEXT,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "project_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."supplier" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "bank_name" TEXT,
    "bank_account_number_encrypted" TEXT,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."purchase_request" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "project_id" UUID,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT,
    "status" "exec"."ProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by" UUID,
    "requested_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."purchase_request_line" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "estimated_unit_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "is_capital_item" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."quotation" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "reference" TEXT,
    "received_on" DATE,
    "valid_until" DATE,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "selection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."quotation_line" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."purchase_order" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID,
    "supplier_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "project_id" UUID,
    "reference" TEXT NOT NULL,
    "status" "exec"."ProcurementStatus" NOT NULL DEFAULT 'ORDERED',
    "ordered_on" DATE NOT NULL,
    "expected_delivery" DATE,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "terms" TEXT,
    "issued_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."purchase_order_line" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity_ordered" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "is_capital_item" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."goods_receipt" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "received_by" UUID,
    "inspected_by" UUID,
    "inspection_note" TEXT,
    "delivery_note_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."goods_receipt_line" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity_received" DECIMAL(14,3) NOT NULL,
    "quantity_accepted" DECIMAL(14,3) NOT NULL,
    "quantity_rejected" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "unit_cost_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "batch_number" TEXT,
    "expiry_date" DATE,
    "is_capital_item" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."supplier_invoice" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "amount_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "match_status" "exec"."InvoiceMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "match_variance_note" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."equipment_asset" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "room_id" UUID,
    "goods_receipt_line_id" UUID,
    "asset_tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "funding_source" TEXT,
    "purchase_date" DATE,
    "cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "condition" "exec"."ConditionRating" NOT NULL DEFAULT 'NOT_ASSESSED',
    "commissioning_status" "exec"."CommissioningStatus" NOT NULL DEFAULT 'NOT_RECEIVED',
    "warranty_expires_on" DATE,
    "expected_life_years" INTEGER,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "equipment_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."asset_maintenance" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "maintenance_type" "exec"."MaintenanceType" NOT NULL,
    "scheduled_for" DATE,
    "performed_on" DATE,
    "performed_by" TEXT,
    "description" TEXT,
    "cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "outcome" TEXT,
    "next_due_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exec"."commissioning_record" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "asset_id" UUID,
    "project_id" UUID,
    "reference" TEXT NOT NULL,
    "functional_test_passed" BOOLEAN NOT NULL DEFAULT false,
    "safety_check_passed" BOOLEAN NOT NULL DEFAULT false,
    "staff_trained" BOOLEAN NOT NULL DEFAULT false,
    "consumables_available" BOOLEAN NOT NULL DEFAULT false,
    "utilities_connected" BOOLEAN NOT NULL DEFAULT false,
    "commissioned_at" TIMESTAMPTZ(6),
    "commissioned_by" UUID,
    "witnessed_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commissioning_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."patient" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "community_id" UUID,
    "mrn" TEXT NOT NULL,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "other_names" TEXT,
    "date_of_birth" DATE,
    "date_of_birth_estimated" BOOLEAN NOT NULL DEFAULT false,
    "sex" "clinical"."Sex" NOT NULL DEFAULT 'UNKNOWN',
    "marital_status" TEXT,
    "occupation" TEXT,
    "address_line" TEXT,
    "nin_encrypted" TEXT,
    "status" "clinical"."PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "allergy_summary" TEXT,
    "blood_group" TEXT,
    "deceased_date" DATE,
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."patient_identifier" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "identifier_type" "clinical"."IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "issuer" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "patient_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."patient_contact" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "contact_type" TEXT NOT NULL,
    "name" TEXT,
    "relationship" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "is_next_of_kin" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "patient_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."patient_consent" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "purpose" "clinical"."ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawal_reason" TEXT,
    "privacy_notice_version" TEXT,
    "captured_by" UUID,
    "proxy_name" TEXT,
    "proxy_relationship" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "patient_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."duplicate_candidate" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "patient_a_id" UUID NOT NULL,
    "patient_b_id" UUID NOT NULL,
    "match_score" DECIMAL(5,4) NOT NULL,
    "match_reasons" JSONB,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."encounter" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "department_id" UUID,
    "encounter_type" "clinical"."EncounterType" NOT NULL DEFAULT 'OPD',
    "status" "clinical"."EncounterStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT NOT NULL,
    "chief_complaint" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "attending_staff_id" UUID,
    "triage_category" "clinical"."TriageCategory",
    "disposition" TEXT,
    "no_diagnosis_reason" TEXT,
    "entered_retrospectively" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."triage" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "pulse" INTEGER,
    "temperature_c" DECIMAL(4,1),
    "respiratory_rate" INTEGER,
    "spo2" INTEGER,
    "weight_kg" DECIMAL(6,2),
    "height_cm" DECIMAL(6,2),
    "bmi" DECIMAL(6,2),
    "muac_cm" DECIMAL(5,2),
    "pain_score" INTEGER,
    "triage_category" "clinical"."TriageCategory",
    "out_of_range_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "triage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."clinical_note" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "note_type" "clinical"."NoteType" NOT NULL DEFAULT 'CONSULTATION',
    "presenting_complaint" TEXT,
    "history_of_presenting_complaint" TEXT,
    "past_medical_history" TEXT,
    "medication_history" TEXT,
    "allergies" TEXT,
    "family_social_history" TEXT,
    "examination_general" TEXT,
    "examination_systems" JSONB,
    "assessment" TEXT,
    "differential_diagnosis" TEXT,
    "plan" TEXT,
    "status" "clinical"."ClinicalRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "author_staff_id" UUID,
    "signed_at" TIMESTAMPTZ(6),
    "amends_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "clinical_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."nursing_note" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "observation" TEXT NOT NULL,
    "intervention" TEXT,
    "response" TEXT,
    "status" "clinical"."ClinicalRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "author_staff_id" UUID,
    "signed_at" TIMESTAMPTZ(6),
    "amends_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "nursing_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."diagnosis" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "icd10_code" TEXT,
    "local_term" TEXT,
    "description" TEXT NOT NULL,
    "diagnosis_type" "clinical"."DiagnosisType" NOT NULL DEFAULT 'PRIMARY',
    "status" "clinical"."ClinicalRecordStatus" NOT NULL DEFAULT 'SIGNED',
    "diagnosed_by" UUID,
    "diagnosed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amends_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."procedure" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "service_offering_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "indication" TEXT,
    "findings" TEXT,
    "performed_by" UUID,
    "assisted_by" TEXT,
    "performed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "complications" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."referral" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "referred_to_facility" TEXT NOT NULL,
    "referred_to_department" TEXT,
    "reason" TEXT NOT NULL,
    "urgency" "core"."Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "clinical"."ReferralStatus" NOT NULL DEFAULT 'INITIATED',
    "referred_by" UUID,
    "referred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome_note" TEXT,
    "outcome_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."appointment" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "purpose" TEXT,
    "status" "clinical"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reminder_sent_at" TIMESTAMPTZ(6),
    "attended_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."medication" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "inventory_item_id" UUID,
    "code" TEXT NOT NULL,
    "generic_name" TEXT NOT NULL,
    "brand_name" TEXT,
    "strength" TEXT,
    "dosage_form" TEXT,
    "route" TEXT,
    "atc_code" TEXT,
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "cautions" JSONB,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."prescription" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "clinical"."PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "prescribed_by" UUID,
    "prescribed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "warning_override_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."prescription_item" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "medication_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "medication_name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "route" TEXT,
    "duration_days" INTEGER,
    "quantity_prescribed" DECIMAL(12,3) NOT NULL,
    "quantity_dispensed" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "prescription_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."dispensing" (
    "id" UUID NOT NULL,
    "prescription_item_id" UUID NOT NULL,
    "inventory_batch_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "dispensed_by" UUID,
    "dispensed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "charge_id" UUID,
    "stock_certainty" "clinical"."StockCertainty" NOT NULL DEFAULT 'ACTUAL',
    "fefo_override_reason" TEXT,
    "is_returned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "dispensing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_test" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "specimen_type" TEXT,
    "method" TEXT,
    "unit" TEXT,
    "target_tat_minutes" INTEGER,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_reference_range" (
    "id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "sex" "clinical"."Sex",
    "age_min_months" INTEGER,
    "age_max_months" INTEGER,
    "low_value" DECIMAL(18,6),
    "high_value" DECIMAL(18,6),
    "critical_low" DECIMAL(18,6),
    "critical_high" DECIMAL(18,6),
    "unit" TEXT,
    "textual_range" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_reference_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_order" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "clinical"."LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "clinical_indication" TEXT,
    "urgency" "core"."Severity" NOT NULL DEFAULT 'MEDIUM',
    "ordered_by" UUID,
    "ordered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "lab_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_order_item" (
    "id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "status" "clinical"."LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "charge_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lab_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_sample" (
    "id" UUID NOT NULL,
    "lab_order_item_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "accession_number" TEXT NOT NULL,
    "sample_type" TEXT NOT NULL,
    "container" TEXT,
    "collected_by" UUID,
    "collected_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "lab_sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_result" (
    "id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "numeric_value" DECIMAL(18,6),
    "text_value" TEXT,
    "unit" TEXT,
    "flag" "clinical"."ResultFlag",
    "status" "clinical"."LabResultStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "resulted_by" UUID,
    "resulted_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "amends_id" UUID,
    "amendment_reason" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lab_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."lab_quality_control" (
    "id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "control_level" TEXT NOT NULL,
    "control_lot" TEXT,
    "expected_value" DECIMAL(18,6),
    "observed_value" DECIMAL(18,6),
    "standard_deviation" DECIMAL(18,6),
    "passed" BOOLEAN NOT NULL,
    "rule_violated" TEXT,
    "run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_by" UUID,
    "corrective_action" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lab_quality_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."maternity_record" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "gravida" INTEGER,
    "para" INTEGER,
    "lmp" DATE,
    "edd" DATE,
    "risk_factors" TEXT,
    "blood_group" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "maternity_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."anc_visit" (
    "id" UUID NOT NULL,
    "maternity_record_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "visit_number" INTEGER NOT NULL,
    "gestational_age_weeks" INTEGER,
    "fundal_height_cm" DECIMAL(5,1),
    "fetal_heart_rate" INTEGER,
    "presentation" TEXT,
    "findings" TEXT,
    "interventions" TEXT,
    "next_visit_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "anc_visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."delivery_record" (
    "id" UUID NOT NULL,
    "maternity_record_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL,
    "mode_of_delivery" TEXT,
    "outcome" TEXT,
    "live_births" INTEGER NOT NULL DEFAULT 0,
    "still_births" INTEGER NOT NULL DEFAULT 0,
    "birth_weight_grams" INTEGER,
    "apgar1_min" INTEGER,
    "apgar5_min" INTEGER,
    "complications" TEXT,
    "attended_by" UUID,
    "newborn_patient_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "delivery_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."immunisation" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "vaccine_code" TEXT NOT NULL,
    "vaccine_name" TEXT NOT NULL,
    "dose_number" INTEGER,
    "scheduled_date" DATE,
    "administered_at" TIMESTAMPTZ(6),
    "batch_number" TEXT,
    "site" TEXT,
    "administered_by" UUID,
    "adverse_event" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "immunisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."growth_measurement" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "age_months" INTEGER,
    "weight_kg" DECIMAL(6,2),
    "height_cm" DECIMAL(6,2),
    "muac_cm" DECIMAL(5,2),
    "head_circumference_cm" DECIMAL(5,2),
    "weight_for_age_z" DECIMAL(6,3),
    "height_for_age_z" DECIMAL(6,3),
    "weight_for_height_z" DECIMAL(6,3),
    "nutrition_status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "growth_measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."chronic_condition" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "condition_name" TEXT NOT NULL,
    "icd10_code" TEXT,
    "diagnosed_on" DATE,
    "status" "clinical"."ChronicConditionStatus" NOT NULL DEFAULT 'ACTIVE',
    "followup_interval_days" INTEGER,
    "next_followup_date" DATE,
    "last_seen_at" TIMESTAMPTZ(6),
    "adherence_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "chronic_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."chronic_followup" (
    "id" UUID NOT NULL,
    "chronic_condition_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "control_measure" TEXT,
    "measurement_value" DECIMAL(18,6),
    "adherence_reported" TEXT,
    "plan" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "chronic_followup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical"."patient_survey" (
    "id" UUID NOT NULL,
    "patient_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "encounter_id" UUID,
    "survey_code" TEXT NOT NULL,
    "responses" JSONB NOT NULL,
    "overall_score" DECIMAL(5,2),
    "comment" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "patient_survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."inventory_category" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."inventory_item" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "category_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "supply"."InventoryItemKind" NOT NULL DEFAULT 'CONSUMABLE',
    "unit_of_measure" TEXT NOT NULL,
    "is_tracer" BOOLEAN NOT NULL DEFAULT false,
    "requires_cold_chain" BOOLEAN NOT NULL DEFAULT false,
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."stock_location" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "room_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" "supply"."LocationType" NOT NULL DEFAULT 'MAIN_STORE',
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."inventory_batch" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "supplier_id" UUID,
    "goods_receipt_line_id" UUID,
    "batch_number" TEXT NOT NULL,
    "expiry_date" DATE,
    "quantity_received" DECIMAL(14,3) NOT NULL,
    "quantity_on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_cost_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "supply"."BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quarantine_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."stock_transaction" (
    "id" UUID NOT NULL,
    "inventory_batch_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "transaction_type" "supply"."StockTransactionType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "unit_cost_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "reason_code" TEXT,
    "reason_note" TEXT,
    "approved_by" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "stock_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."reorder_rule" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "average_daily_consumption" DECIMAL(14,4),
    "lead_time_days" INTEGER NOT NULL DEFAULT 14,
    "safety_factor" DECIMAL(6,3) NOT NULL DEFAULT 1.5,
    "computed_reorder_level" DECIMAL(14,3),
    "computed_critical_level" DECIMAL(14,3),
    "manual_reorder_level" DECIMAL(14,3),
    "manual_override_reason" TEXT,
    "last_computed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "reorder_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."stock_count" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "location_id" UUID,
    "reference" TEXT NOT NULL,
    "status" "supply"."StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "is_blind" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "counted_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."stock_count_line" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "inventory_batch_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "expected_quantity" DECIMAL(14,3) NOT NULL,
    "counted_quantity" DECIMAL(14,3) NOT NULL,
    "variance" DECIMAL(14,3) NOT NULL,
    "variance_reason" TEXT,
    "investigated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply"."stock_adjustment" (
    "id" UUID NOT NULL,
    "stock_count_line_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "inventory_batch_id" UUID NOT NULL,
    "quantity_delta" DECIMAL(14,3) NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_note" TEXT,
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "stock_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."financial_account" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" "fin"."AccountType" NOT NULL,
    "normal_balance" "fin"."NormalBalance" NOT NULL,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."financial_period" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "fin"."PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopen_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."journal_entry" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "financial_period_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "status" "fin"."JournalStatus" NOT NULL DEFAULT 'POSTED',
    "reverses_id" UUID,
    "reversal_reason" TEXT,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."journal_line" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "description" TEXT,
    "department_id" UUID,
    "project_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."charge" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "encounter_id" UUID,
    "service_offering_id" UUID,
    "tariff_version_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "service_date" DATE NOT NULL,
    "status" "fin"."ChargeStatus" NOT NULL DEFAULT 'RAISED',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "waived_by" UUID,
    "waived_at" TIMESTAMPTZ(6),
    "waiver_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "device_id" TEXT,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."invoice" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "patient_id" UUID,
    "reference" TEXT NOT NULL,
    "payer_type" "fin"."PayerType" NOT NULL DEFAULT 'SELF_PAY',
    "payer_name" TEXT,
    "status" "fin"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issued_at" TIMESTAMPTZ(6),
    "due_date" DATE,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "write_off_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."invoice_item" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "charge_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."payment" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "direction" "fin"."PaymentDirection" NOT NULL DEFAULT 'INBOUND',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "method" "fin"."PaymentMethod" NOT NULL,
    "external_reference" TEXT,
    "supplier_invoice_id" UUID,
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "offline_receipt_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."payment_allocation" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_by" UUID,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."refund" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "reason" TEXT NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."budget" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "status" "fin"."BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "revision_of_id" UUID,
    "revision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."budget_line" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "financial_account_id" UUID,
    "capex_line_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "budgeted_minor" BIGINT NOT NULL,
    "approved_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "period_start" DATE,
    "period_end" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."bank_account" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" CHAR(4) NOT NULL,
    "financial_account_id" UUID,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."bank_statement_line" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "reconciliation_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "value_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "balance_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "external_reference" TEXT,
    "matched_journal_entry_id" UUID,
    "matched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."bank_reconciliation" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "statement_closing_minor" BIGINT NOT NULL,
    "ledger_closing_minor" BIGINT NOT NULL,
    "variance_minor" BIGINT NOT NULL,
    "unmatched_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin"."daily_cash_reconciliation" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "cash_point" TEXT,
    "opening_balance_minor" BIGINT NOT NULL,
    "receipts_minor" BIGINT NOT NULL,
    "expenses_minor" BIGINT NOT NULL,
    "expected_closing_minor" BIGINT NOT NULL,
    "counted_closing_minor" BIGINT NOT NULL,
    "variance_minor" BIGINT NOT NULL,
    "variance_reason" TEXT,
    "counted_by" UUID,
    "countersigned_by" UUID,
    "sealed_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_cash_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."staff" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID,
    "staff_number" TEXT NOT NULL,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "other_names" TEXT,
    "sex" "clinical"."Sex" NOT NULL DEFAULT 'UNKNOWN',
    "date_of_birth" DATE,
    "phone" TEXT,
    "email" TEXT,
    "cadre" TEXT NOT NULL,
    "qualification" TEXT,
    "employer_type" "people"."EmployerType" NOT NULL DEFAULT 'GOVERNMENT',
    "employment_date" DATE,
    "exit_date" DATE,
    "status" "people"."StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "attendance_pin_hash" TEXT,
    "qr_token_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."staff_credential" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "credential_type" TEXT NOT NULL,
    "credential_number" TEXT,
    "issuing_body" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "status" "people"."CredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "evidence_storage_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."staff_posting" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "department_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "role_title" TEXT NOT NULL,
    "cadre" TEXT,
    "employer_type" "people"."EmployerType" NOT NULL DEFAULT 'GOVERNMENT',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "posting_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_posting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."staff_schedule" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."shift" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "shift_type" "people"."ShiftType" NOT NULL DEFAULT 'MORNING',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "department_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."attendance" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "event_type" "people"."AttendanceEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "method" "people"."AttendanceMethod" NOT NULL DEFAULT 'PIN',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "shift_id" UUID,
    "recorded_by" UUID,
    "manual_reason" TEXT,
    "corrects_id" UUID,
    "correction_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "device_created_at" TIMESTAMPTZ(6),
    "sync_status" "core"."SyncStatus" NOT NULL DEFAULT 'SYNCED',

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."leave" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "status" "people"."LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."performance_metric" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "unit" TEXT,
    "direction" "people"."MetricDirection" NOT NULL DEFAULT 'HIGHER_BETTER',
    "source_query_id" TEXT,
    "weight" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "target_value" DECIMAL(18,6),
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "performance_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."performance_metric_result" (
    "id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "target_value" DECIMAL(18,6),
    "normalised_score" DECIMAL(6,4),
    "inputs" JSONB,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_metric_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."performance_review" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "overall_score" DECIMAL(6,3),
    "strengths" TEXT,
    "development_areas" TEXT,
    "agreed_actions" TEXT,
    "reviewer_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "staff_comment" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "performance_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."staff_incentive" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "people"."IncentiveStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "pool_reference" TEXT,
    "computed_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_payment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_incentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."incentive_component" (
    "id" UUID NOT NULL,
    "staff_incentive_id" UUID NOT NULL,
    "metric_id" UUID,
    "organisation_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "metric_value" DECIMAL(18,6),
    "normalised_score" DECIMAL(6,4),
    "weight" DECIMAL(8,4) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "formula_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."kpi" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "unit" TEXT,
    "domain_code" TEXT,
    "direction" "qual"."KpiDirection" NOT NULL DEFAULT 'HIGHER_BETTER',
    "source_query_id" TEXT NOT NULL,
    "default_period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."kpi_assignment" (
    "id" UUID NOT NULL,
    "kpi_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "baseline_snapshot_id" UUID,
    "baseline_metric_id" UUID,
    "baseline_value" DECIMAL(18,6),
    "target_value" DECIMAL(18,6),
    "target_date" DATE,
    "owner_user_id" UUID,
    "amber_threshold" DECIMAL(6,4),
    "red_threshold" DECIMAL(6,4),
    "status" "core"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "kpi_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."kpi_result" (
    "id" UUID NOT NULL,
    "kpi_assignment_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "value" DECIMAL(18,6),
    "target_value" DECIMAL(18,6),
    "baseline_value" DECIMAL(18,6),
    "variance_to_target" DECIMAL(18,6),
    "change_from_baseline" DECIMAL(18,6),
    "status" "qual"."RagStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'ACTUAL',
    "sample_size" INTEGER,
    "is_suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppression_reason" TEXT,
    "inputs" JSONB,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."risk" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "project_id" UUID,
    "partnership_id" UUID,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "mitigation" TEXT,
    "contingency" TEXT,
    "owner_user_id" UUID,
    "status" "qual"."RiskStatus" NOT NULL DEFAULT 'OPEN',
    "review_date" DATE,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."incident" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "incident_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "core"."Severity" NOT NULL DEFAULT 'MEDIUM',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "reported_by" UUID,
    "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patient_affected" BOOLEAN NOT NULL DEFAULT false,
    "linked_encounter_id" UUID,
    "immediate_action" TEXT,
    "root_cause" TEXT,
    "status" "qual"."IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."complaint" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "complainant_name" TEXT,
    "complainant_contact" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "qual"."ComplaintStatus" NOT NULL DEFAULT 'RECEIVED',
    "assigned_to" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "satisfaction_rating" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."complaint_action" (
    "id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "taken_by" UUID,
    "taken_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."quality_improvement" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem_statement" TEXT NOT NULL,
    "root_cause_analysis" TEXT,
    "intervention" TEXT,
    "measurement_kpi_id" UUID,
    "baseline_value" DECIMAL(18,6),
    "target_value" DECIMAL(18,6),
    "current_value" DECIMAL(18,6),
    "status" "qual"."QiStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "owner_user_id" UUID,
    "started_on" DATE,
    "review_date" DATE,
    "review_outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "quality_improvement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."corrective_action" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "incident_id" UUID,
    "quality_improvement_id" UUID,
    "description" TEXT NOT NULL,
    "owner_user_id" UUID,
    "due_date" DATE,
    "status" "qual"."ActionStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMPTZ(6),
    "verification_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "corrective_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."compliance_requirement" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "responsible_authority" TEXT,
    "renewal_interval_months" INTEGER,
    "is_system_managed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."compliance_status" (
    "id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "state" "qual"."ComplianceState" NOT NULL DEFAULT 'NOT_ASSESSED',
    "evidence_note" TEXT,
    "evidence_storage_key" TEXT,
    "certificate_number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "responsible_user_id" UUID,
    "action_required" TEXT,
    "assessed_by" UUID,
    "assessed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "compliance_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."generated_document" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "document_type" "qual"."DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "qual"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "generated_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."document_version" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "qual"."DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "storage_key" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "content_hash" TEXT,
    "provenance" JSONB NOT NULL,
    "classification_summary" JSONB,
    "completeness_percent" DECIMAL(5,2),
    "missing_data_notes" JSONB,
    "reporting_period_start" DATE,
    "reporting_period_end" DATE,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."report_run" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "report_code" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "row_counts" JSONB,
    "duration_ms" INTEGER,
    "document_version_id" UUID,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "run_by" UUID,
    "run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qual"."ai_insight" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "insight_type" "qual"."InsightType" NOT NULL,
    "subject_type" TEXT,
    "subject_id" UUID,
    "content" TEXT NOT NULL,
    "classification" "core"."DataClassification" NOT NULL DEFAULT 'AI_GENERATED',
    "model_id" TEXT NOT NULL,
    "model_version" TEXT,
    "prompt_hash" TEXT NOT NULL,
    "context_query_ids" TEXT[],
    "context_hash" TEXT NOT NULL,
    "confidence" DECIMAL(5,4),
    "token_usage" JSONB,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_outcome" "qual"."ReviewOutcome" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "audit"."AuditActorType" NOT NULL DEFAULT 'USER',
    "on_behalf_of" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_fields" TEXT[],
    "reason" TEXT,
    "outcome" "audit"."AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "severity" "audit"."AuditSeverity" NOT NULL DEFAULT 'INFO',
    "device_id" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "session_id" UUID,
    "trace_id" TEXT NOT NULL,
    "request_id" TEXT,
    "prev_hash" BYTEA,
    "row_hash" BYTEA NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."sync_event" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "user_id" UUID,
    "device_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "records_attempted" INTEGER NOT NULL DEFAULT 0,
    "records_applied" INTEGER NOT NULL DEFAULT 0,
    "records_conflicted" INTEGER NOT NULL DEFAULT 0,
    "records_rejected" INTEGER NOT NULL DEFAULT 0,
    "bytes_transferred" INTEGER,
    "duration_ms" INTEGER,
    "network_info" JSONB,
    "cursor_before" TEXT,
    "cursor_after" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."sync_conflict" (
    "id" UUID NOT NULL,
    "sync_event_id" UUID,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "device_id" TEXT NOT NULL,
    "user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "conflict_type" "audit"."ConflictType" NOT NULL,
    "base_version" INTEGER,
    "server_version" INTEGER,
    "local_payload" JSONB NOT NULL,
    "server_payload" JSONB,
    "resolution" "audit"."ConflictResolution" NOT NULL DEFAULT 'PENDING',
    "resolution_reason" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."outbox_message" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "audit"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."notification" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "facility_id" UUID,
    "user_id" UUID,
    "channel" "audit"."NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "core"."Severity" NOT NULL DEFAULT 'LOW',
    "entity_type" TEXT,
    "entity_id" UUID,
    "status" "audit"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "escalation_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."backup_verification" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "backup_type" "audit"."BackupType" NOT NULL,
    "backup_ref" TEXT NOT NULL,
    "backup_taken_at" TIMESTAMPTZ(6) NOT NULL,
    "size_bytes" BIGINT,
    "verified_at" TIMESTAMPTZ(6),
    "verification_duration_ms" INTEGER,
    "checks" JSONB,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "restore_point_earliest" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisation_code_key" ON "core"."organisation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "facility_type_code_key" ON "core"."facility_type"("code");

-- CreateIndex
CREATE INDEX "facility_organisation_id_idx" ON "core"."facility"("organisation_id");

-- CreateIndex
CREATE INDEX "facility_organisation_id_lifecycle_stage_idx" ON "core"."facility"("organisation_id", "lifecycle_stage");

-- CreateIndex
CREATE UNIQUE INDEX "facility_organisation_id_code_key" ON "core"."facility"("organisation_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "facility_location_facility_id_key" ON "core"."facility_location"("facility_id");

-- CreateIndex
CREATE INDEX "facility_location_organisation_id_state_lga_idx" ON "core"."facility_location"("organisation_id", "state", "lga");

-- CreateIndex
CREATE INDEX "facility_ownership_facility_id_idx" ON "core"."facility_ownership"("facility_id");

-- CreateIndex
CREATE INDEX "facility_stage_transition_facility_id_occurred_at_idx" ON "core"."facility_stage_transition"("facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "department_organisation_id_facility_id_idx" ON "core"."department"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_facility_id_code_key" ON "core"."department"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "service_code_key" ON "core"."service"("code");

-- CreateIndex
CREATE INDEX "service_offering_organisation_id_facility_id_idx" ON "core"."service_offering"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_offering_facility_id_service_id_key" ON "core"."service_offering"("facility_id", "service_id");

-- CreateIndex
CREATE INDEX "tariff_version_service_offering_id_effective_from_idx" ON "core"."tariff_version"("service_offering_id", "effective_from");

-- CreateIndex
CREATE INDEX "tariff_version_facility_id_effective_from_idx" ON "core"."tariff_version"("facility_id", "effective_from");

-- CreateIndex
CREATE INDEX "app_user_organisation_id_status_idx" ON "core"."app_user"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_organisation_id_email_key" ON "core"."app_user"("organisation_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "role_organisation_id_code_key" ON "core"."role"("organisation_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "core"."permission"("code");

-- CreateIndex
CREATE INDEX "permission_module_idx" ON "core"."permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_user_id_role_id_key" ON "core"."user_role"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_id_key" ON "core"."role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "user_facility_access_facility_id_idx" ON "core"."user_facility_access"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_facility_access_user_id_facility_id_key" ON "core"."user_facility_access"("user_id", "facility_id");

-- CreateIndex
CREATE INDEX "user_session_user_id_revoked_at_idx" ON "core"."user_session"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "core"."refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "core"."refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "refresh_token_session_id_status_idx" ON "core"."refresh_token"("session_id", "status");

-- CreateIndex
CREATE INDEX "user_mfa_factor_user_id_factor_type_idx" ON "core"."user_mfa_factor"("user_id", "factor_type");

-- CreateIndex
CREATE INDEX "system_configuration_organisation_id_key_idx" ON "core"."system_configuration"("organisation_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "system_configuration_organisation_id_facility_id_key_key" ON "core"."system_configuration"("organisation_id", "facility_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_key_key" ON "core"."idempotency_record"("key");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "core"."idempotency_record"("expires_at");

-- CreateIndex
CREATE INDEX "community_organisation_id_facility_id_idx" ON "core"."community"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_facility_id_name_key" ON "core"."community"("facility_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "community_profile_community_id_key" ON "core"."community_profile"("community_id");

-- CreateIndex
CREATE INDEX "community_survey_facility_id_conducted_on_idx" ON "core"."community_survey"("facility_id", "conducted_on");

-- CreateIndex
CREATE INDEX "community_survey_response_survey_id_question_code_idx" ON "core"."community_survey_response"("survey_id", "question_code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_template_code_key" ON "assess"."assessment_template"("code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_template_version_template_id_version_number_key" ON "assess"."assessment_template_version"("template_id", "version_number");

-- CreateIndex
CREATE INDEX "assessment_section_template_version_id_sequence_idx" ON "assess"."assessment_section"("template_version_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_section_template_version_id_code_key" ON "assess"."assessment_section"("template_version_id", "code");

-- CreateIndex
CREATE INDEX "assessment_item_section_id_sequence_idx" ON "assess"."assessment_item"("section_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_item_section_id_code_key" ON "assess"."assessment_item"("section_id", "code");

-- CreateIndex
CREATE INDEX "facility_assessment_organisation_id_facility_id_assessment__idx" ON "assess"."facility_assessment"("organisation_id", "facility_id", "assessment_type");

-- CreateIndex
CREATE INDEX "facility_assessment_facility_id_status_idx" ON "assess"."facility_assessment"("facility_id", "status");

-- CreateIndex
CREATE INDEX "assessment_response_assessment_id_item_id_idx" ON "assess"."assessment_response"("assessment_id", "item_id");

-- CreateIndex
CREATE INDEX "assessment_response_facility_id_idx" ON "assess"."assessment_response"("facility_id");

-- CreateIndex
CREATE INDEX "assessment_finding_organisation_id_facility_id_priority_cla_idx" ON "assess"."assessment_finding"("organisation_id", "facility_id", "priority_class");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_finding_facility_id_reference_key" ON "assess"."assessment_finding"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "evidence_organisation_id_facility_id_source_idx" ON "assess"."evidence"("organisation_id", "facility_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_facility_id_reference_key" ON "assess"."evidence"("facility_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "photograph_evidence_id_key" ON "assess"."photograph"("evidence_id");

-- CreateIndex
CREATE INDEX "photograph_facility_id_stage_idx" ON "assess"."photograph"("facility_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_document_evidence_id_key" ON "assess"."evidence_document"("evidence_id");

-- CreateIndex
CREATE INDEX "evidence_document_facility_id_document_type_idx" ON "assess"."evidence_document"("facility_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_evidence_response_id_evidence_id_key" ON "assess"."assessment_evidence"("response_id", "evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_evidence_finding_id_evidence_id_key" ON "assess"."finding_evidence"("finding_id", "evidence_id");

-- CreateIndex
CREATE INDEX "assessment_score_facility_id_domain_code_idx" ON "assess"."assessment_score"("facility_id", "domain_code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_score_assessment_id_domain_code_key" ON "assess"."assessment_score"("assessment_id", "domain_code");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_snapshot_assessment_id_key" ON "assess"."baseline_snapshot"("assessment_id");

-- CreateIndex
CREATE INDEX "baseline_snapshot_organisation_id_facility_id_idx" ON "assess"."baseline_snapshot"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_snapshot_facility_id_sequence_key" ON "assess"."baseline_snapshot"("facility_id", "sequence");

-- CreateIndex
CREATE INDEX "baseline_metric_facility_id_metric_code_idx" ON "assess"."baseline_metric"("facility_id", "metric_code");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_metric_snapshot_id_metric_code_key" ON "assess"."baseline_metric"("snapshot_id", "metric_code");

-- CreateIndex
CREATE INDEX "need_organisation_id_facility_id_idx" ON "plan"."need"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "need_facility_id_reference_key" ON "plan"."need"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "recommendation_organisation_id_facility_id_priority_class_idx" ON "plan"."recommendation"("organisation_id", "facility_id", "priority_class");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_facility_id_reference_key" ON "plan"."recommendation"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "capex_plan_organisation_id_facility_id_idx" ON "plan"."capex_plan"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "capex_plan_facility_id_name_version_number_key" ON "plan"."capex_plan"("facility_id", "name", "version_number");

-- CreateIndex
CREATE INDEX "capex_line_capex_plan_id_category_idx" ON "plan"."capex_line"("capex_plan_id", "category");

-- CreateIndex
CREATE INDEX "capex_line_organisation_id_facility_id_idx" ON "plan"."capex_line"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "working_capital_plan_capex_plan_id_key" ON "plan"."working_capital_plan"("capex_plan_id");

-- CreateIndex
CREATE INDEX "financial_model_organisation_id_facility_id_status_idx" ON "plan"."financial_model"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_model_facility_id_name_version_number_key" ON "plan"."financial_model"("facility_id", "name", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "model_assumption_model_id_code_key" ON "plan"."model_assumption"("model_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "model_scenario_model_id_scenario_type_key" ON "plan"."model_scenario"("model_id", "scenario_type");

-- CreateIndex
CREATE INDEX "model_projection_scenario_id_period_start_idx" ON "plan"."model_projection"("scenario_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "model_projection_scenario_id_period_index_key" ON "plan"."model_projection"("scenario_id", "period_index");

-- CreateIndex
CREATE INDEX "partnership_organisation_id_facility_id_status_idx" ON "plan"."partnership"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE INDEX "partnership_party_partnership_id_party_role_idx" ON "plan"."partnership_party"("partnership_id", "party_role");

-- CreateIndex
CREATE INDEX "partnership_obligation_partnership_id_status_idx" ON "plan"."partnership_obligation"("partnership_id", "status");

-- CreateIndex
CREATE INDEX "revenue_share_model_partnership_id_effective_from_idx" ON "plan"."revenue_share_model"("partnership_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_share_model_partnership_id_version_number_key" ON "plan"."revenue_share_model"("partnership_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "waterfall_step_revenue_share_model_id_sequence_key" ON "plan"."waterfall_step"("revenue_share_model_id", "sequence");

-- CreateIndex
CREATE INDEX "capital_recovery_event_partnership_id_event_type_occurred_o_idx" ON "plan"."capital_recovery_event"("partnership_id", "event_type", "occurred_on");

-- CreateIndex
CREATE INDEX "proposal_organisation_id_facility_id_status_idx" ON "plan"."proposal"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_facility_id_reference_version_number_key" ON "plan"."proposal"("facility_id", "reference", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_section_proposal_id_sequence_key" ON "plan"."proposal_section"("proposal_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "letter_template_code_key" ON "plan"."letter_template"("code");

-- CreateIndex
CREATE INDEX "letter_facility_id_status_idx" ON "plan"."letter"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "letter_organisation_id_reference_key" ON "plan"."letter"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "contract_partnership_id_status_idx" ON "plan"."contract"("partnership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_organisation_id_reference_key" ON "plan"."contract"("organisation_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "contract_version_contract_id_version_number_key" ON "plan"."contract_version"("contract_id", "version_number");

-- CreateIndex
CREATE INDEX "approval_entity_type_entity_id_idx" ON "plan"."approval"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_organisation_id_decision_idx" ON "plan"."approval"("organisation_id", "decision");

-- CreateIndex
CREATE INDEX "room_organisation_id_facility_id_idx" ON "exec"."room"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_facility_id_code_key" ON "exec"."room"("facility_id", "code");

-- CreateIndex
CREATE INDEX "infrastructure_item_facility_id_category_idx" ON "exec"."infrastructure_item"("facility_id", "category");

-- CreateIndex
CREATE INDEX "utility_organisation_id_facility_id_idx" ON "exec"."utility"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "utility_facility_id_utility_type_key" ON "exec"."utility"("facility_id", "utility_type");

-- CreateIndex
CREATE INDEX "capital_project_organisation_id_facility_id_status_idx" ON "exec"."capital_project"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_project_facility_id_reference_key" ON "exec"."capital_project"("facility_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "project_phase_project_id_sequence_key" ON "exec"."project_phase"("project_id", "sequence");

-- CreateIndex
CREATE INDEX "project_task_phase_id_status_idx" ON "exec"."project_task"("phase_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_task_facility_id_reference_key" ON "exec"."project_task"("facility_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "project_task_dependency_task_id_predecessor_id_key" ON "exec"."project_task_dependency"("task_id", "predecessor_id");

-- CreateIndex
CREATE INDEX "project_milestone_project_id_due_date_idx" ON "exec"."project_milestone"("project_id", "due_date");

-- CreateIndex
CREATE INDEX "project_budget_project_id_idx" ON "exec"."project_budget"("project_id");

-- CreateIndex
CREATE INDEX "project_expense_project_id_incurred_on_idx" ON "exec"."project_expense"("project_id", "incurred_on");

-- CreateIndex
CREATE INDEX "project_evidence_project_id_stage_idx" ON "exec"."project_evidence"("project_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "project_evidence_project_id_evidence_id_key" ON "exec"."project_evidence"("project_id", "evidence_id");

-- CreateIndex
CREATE INDEX "supplier_organisation_id_status_idx" ON "exec"."supplier"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_organisation_id_code_key" ON "exec"."supplier"("organisation_id", "code");

-- CreateIndex
CREATE INDEX "purchase_request_facility_id_status_idx" ON "exec"."purchase_request"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_organisation_id_reference_key" ON "exec"."purchase_request"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "purchase_request_line_purchase_request_id_idx" ON "exec"."purchase_request_line"("purchase_request_id");

-- CreateIndex
CREATE INDEX "quotation_purchase_request_id_is_selected_idx" ON "exec"."quotation"("purchase_request_id", "is_selected");

-- CreateIndex
CREATE INDEX "quotation_line_quotation_id_idx" ON "exec"."quotation_line"("quotation_id");

-- CreateIndex
CREATE INDEX "purchase_order_facility_id_status_idx" ON "exec"."purchase_order"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_organisation_id_reference_key" ON "exec"."purchase_order"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "purchase_order_line_purchase_order_id_idx" ON "exec"."purchase_order_line"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipt_facility_id_received_on_idx" ON "exec"."goods_receipt"("facility_id", "received_on");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_organisation_id_reference_key" ON "exec"."goods_receipt"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "goods_receipt_line_goods_receipt_id_idx" ON "exec"."goods_receipt_line"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "supplier_invoice_facility_id_match_status_idx" ON "exec"."supplier_invoice"("facility_id", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_supplier_id_invoice_number_key" ON "exec"."supplier_invoice"("supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "equipment_asset_organisation_id_facility_id_commissioning_s_idx" ON "exec"."equipment_asset"("organisation_id", "facility_id", "commissioning_status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_asset_facility_id_asset_tag_key" ON "exec"."equipment_asset"("facility_id", "asset_tag");

-- CreateIndex
CREATE INDEX "asset_maintenance_asset_id_scheduled_for_idx" ON "exec"."asset_maintenance"("asset_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "asset_maintenance_facility_id_next_due_on_idx" ON "exec"."asset_maintenance"("facility_id", "next_due_on");

-- CreateIndex
CREATE INDEX "commissioning_record_facility_id_commissioned_at_idx" ON "exec"."commissioning_record"("facility_id", "commissioned_at");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_record_organisation_id_reference_key" ON "exec"."commissioning_record"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "patient_organisation_id_facility_id_idx" ON "clinical"."patient"("organisation_id", "facility_id");

-- CreateIndex
CREATE INDEX "patient_family_name_given_name_idx" ON "clinical"."patient"("family_name", "given_name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_facility_id_mrn_key" ON "clinical"."patient"("facility_id", "mrn");

-- CreateIndex
CREATE INDEX "patient_identifier_patient_id_identifier_type_idx" ON "clinical"."patient_identifier"("patient_id", "identifier_type");

-- CreateIndex
CREATE INDEX "patient_identifier_facility_id_identifier_type_value_idx" ON "clinical"."patient_identifier"("facility_id", "identifier_type", "value");

-- CreateIndex
CREATE INDEX "patient_contact_patient_id_idx" ON "clinical"."patient_contact"("patient_id");

-- CreateIndex
CREATE INDEX "patient_consent_patient_id_purpose_idx" ON "clinical"."patient_consent"("patient_id", "purpose");

-- CreateIndex
CREATE INDEX "duplicate_candidate_facility_id_reviewed_at_idx" ON "clinical"."duplicate_candidate"("facility_id", "reviewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidate_patient_a_id_patient_b_id_key" ON "clinical"."duplicate_candidate"("patient_a_id", "patient_b_id");

-- CreateIndex
CREATE INDEX "encounter_organisation_id_facility_id_started_at_idx" ON "clinical"."encounter"("organisation_id", "facility_id", "started_at");

-- CreateIndex
CREATE INDEX "encounter_patient_id_started_at_idx" ON "clinical"."encounter"("patient_id", "started_at");

-- CreateIndex
CREATE INDEX "encounter_facility_id_status_idx" ON "clinical"."encounter"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_facility_id_reference_key" ON "clinical"."encounter"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "triage_encounter_id_recorded_at_idx" ON "clinical"."triage"("encounter_id", "recorded_at");

-- CreateIndex
CREATE INDEX "triage_facility_id_recorded_at_idx" ON "clinical"."triage"("facility_id", "recorded_at");

-- CreateIndex
CREATE INDEX "clinical_note_encounter_id_status_idx" ON "clinical"."clinical_note"("encounter_id", "status");

-- CreateIndex
CREATE INDEX "clinical_note_facility_id_created_at_idx" ON "clinical"."clinical_note"("facility_id", "created_at");

-- CreateIndex
CREATE INDEX "nursing_note_encounter_id_idx" ON "clinical"."nursing_note"("encounter_id");

-- CreateIndex
CREATE INDEX "diagnosis_encounter_id_idx" ON "clinical"."diagnosis"("encounter_id");

-- CreateIndex
CREATE INDEX "diagnosis_facility_id_icd10_code_diagnosed_at_idx" ON "clinical"."diagnosis"("facility_id", "icd10_code", "diagnosed_at");

-- CreateIndex
CREATE INDEX "procedure_encounter_id_idx" ON "clinical"."procedure"("encounter_id");

-- CreateIndex
CREATE INDEX "procedure_facility_id_performed_at_idx" ON "clinical"."procedure"("facility_id", "performed_at");

-- CreateIndex
CREATE INDEX "referral_facility_id_status_referred_at_idx" ON "clinical"."referral"("facility_id", "status", "referred_at");

-- CreateIndex
CREATE INDEX "appointment_facility_id_scheduled_for_status_idx" ON "clinical"."appointment"("facility_id", "scheduled_for", "status");

-- CreateIndex
CREATE INDEX "appointment_patient_id_scheduled_for_idx" ON "clinical"."appointment"("patient_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "medication_inventory_item_id_key" ON "clinical"."medication"("inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_code_key" ON "clinical"."medication"("code");

-- CreateIndex
CREATE INDEX "medication_generic_name_idx" ON "clinical"."medication"("generic_name");

-- CreateIndex
CREATE INDEX "prescription_facility_id_status_prescribed_at_idx" ON "clinical"."prescription"("facility_id", "status", "prescribed_at");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_facility_id_reference_key" ON "clinical"."prescription"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "prescription_item_prescription_id_idx" ON "clinical"."prescription_item"("prescription_id");

-- CreateIndex
CREATE INDEX "dispensing_facility_id_dispensed_at_idx" ON "clinical"."dispensing"("facility_id", "dispensed_at");

-- CreateIndex
CREATE INDEX "dispensing_prescription_item_id_idx" ON "clinical"."dispensing"("prescription_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_code_key" ON "clinical"."lab_test"("code");

-- CreateIndex
CREATE INDEX "lab_test_category_idx" ON "clinical"."lab_test"("category");

-- CreateIndex
CREATE INDEX "lab_reference_range_lab_test_id_idx" ON "clinical"."lab_reference_range"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_order_facility_id_status_ordered_at_idx" ON "clinical"."lab_order"("facility_id", "status", "ordered_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_facility_id_reference_key" ON "clinical"."lab_order"("facility_id", "reference");

-- CreateIndex
CREATE INDEX "lab_order_item_lab_order_id_idx" ON "clinical"."lab_order_item"("lab_order_id");

-- CreateIndex
CREATE INDEX "lab_sample_lab_order_item_id_idx" ON "clinical"."lab_sample"("lab_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_sample_facility_id_accession_number_key" ON "clinical"."lab_sample"("facility_id", "accession_number");

-- CreateIndex
CREATE INDEX "lab_result_sample_id_idx" ON "clinical"."lab_result"("sample_id");

-- CreateIndex
CREATE INDEX "lab_result_facility_id_status_verified_at_idx" ON "clinical"."lab_result"("facility_id", "status", "verified_at");

-- CreateIndex
CREATE INDEX "lab_quality_control_facility_id_lab_test_id_run_at_idx" ON "clinical"."lab_quality_control"("facility_id", "lab_test_id", "run_at");

-- CreateIndex
CREATE INDEX "maternity_record_patient_id_idx" ON "clinical"."maternity_record"("patient_id");

-- CreateIndex
CREATE INDEX "maternity_record_facility_id_edd_idx" ON "clinical"."maternity_record"("facility_id", "edd");

-- CreateIndex
CREATE UNIQUE INDEX "anc_visit_maternity_record_id_visit_number_key" ON "clinical"."anc_visit"("maternity_record_id", "visit_number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_record_maternity_record_id_key" ON "clinical"."delivery_record"("maternity_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_record_encounter_id_key" ON "clinical"."delivery_record"("encounter_id");

-- CreateIndex
CREATE INDEX "delivery_record_facility_id_delivered_at_idx" ON "clinical"."delivery_record"("facility_id", "delivered_at");

-- CreateIndex
CREATE INDEX "immunisation_patient_id_vaccine_code_idx" ON "clinical"."immunisation"("patient_id", "vaccine_code");

-- CreateIndex
CREATE INDEX "immunisation_facility_id_scheduled_date_idx" ON "clinical"."immunisation"("facility_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "growth_measurement_patient_id_measured_at_idx" ON "clinical"."growth_measurement"("patient_id", "measured_at");

-- CreateIndex
CREATE INDEX "chronic_condition_patient_id_idx" ON "clinical"."chronic_condition"("patient_id");

-- CreateIndex
CREATE INDEX "chronic_condition_facility_id_next_followup_date_status_idx" ON "clinical"."chronic_condition"("facility_id", "next_followup_date", "status");

-- CreateIndex
CREATE INDEX "chronic_followup_chronic_condition_id_occurred_at_idx" ON "clinical"."chronic_followup"("chronic_condition_id", "occurred_at");

-- CreateIndex
CREATE INDEX "patient_survey_facility_id_collected_at_idx" ON "clinical"."patient_survey"("facility_id", "collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_category_code_key" ON "supply"."inventory_category"("code");

-- CreateIndex
CREATE INDEX "inventory_item_organisation_id_facility_id_kind_idx" ON "supply"."inventory_item"("organisation_id", "facility_id", "kind");

-- CreateIndex
CREATE INDEX "inventory_item_facility_id_is_tracer_idx" ON "supply"."inventory_item"("facility_id", "is_tracer");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_facility_id_code_key" ON "supply"."inventory_item"("facility_id", "code");

-- CreateIndex
CREATE INDEX "stock_location_organisation_id_facility_id_idx" ON "supply"."stock_location"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_location_facility_id_code_key" ON "supply"."stock_location"("facility_id", "code");

-- CreateIndex
CREATE INDEX "inventory_batch_inventory_item_id_expiry_date_status_idx" ON "supply"."inventory_batch"("inventory_item_id", "expiry_date", "status");

-- CreateIndex
CREATE INDEX "inventory_batch_facility_id_expiry_date_idx" ON "supply"."inventory_batch"("facility_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batch_inventory_item_id_batch_number_key" ON "supply"."inventory_batch"("inventory_item_id", "batch_number");

-- CreateIndex
CREATE INDEX "stock_transaction_inventory_batch_id_occurred_at_idx" ON "supply"."stock_transaction"("inventory_batch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_transaction_facility_id_occurred_at_idx" ON "supply"."stock_transaction"("facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_transaction_source_type_source_id_idx" ON "supply"."stock_transaction"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "reorder_rule_inventory_item_id_key" ON "supply"."reorder_rule"("inventory_item_id");

-- CreateIndex
CREATE INDEX "reorder_rule_facility_id_idx" ON "supply"."reorder_rule"("facility_id");

-- CreateIndex
CREATE INDEX "stock_count_facility_id_status_idx" ON "supply"."stock_count"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_organisation_id_reference_key" ON "supply"."stock_count"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "stock_count_line_stock_count_id_idx" ON "supply"."stock_count_line"("stock_count_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_stock_count_line_id_key" ON "supply"."stock_adjustment"("stock_count_line_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_facility_id_created_at_idx" ON "supply"."stock_adjustment"("facility_id", "created_at");

-- CreateIndex
CREATE INDEX "financial_account_organisation_id_account_type_idx" ON "fin"."financial_account"("organisation_id", "account_type");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_organisation_id_code_key" ON "fin"."financial_account"("organisation_id", "code");

-- CreateIndex
CREATE INDEX "financial_period_organisation_id_facility_id_status_idx" ON "fin"."financial_period"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_period_facility_id_start_date_end_date_key" ON "fin"."financial_period"("facility_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "journal_entry_facility_id_entry_date_idx" ON "fin"."journal_entry"("facility_id", "entry_date");

-- CreateIndex
CREATE INDEX "journal_entry_source_type_source_id_idx" ON "fin"."journal_entry"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_organisation_id_reference_key" ON "fin"."journal_entry"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "journal_line_journal_entry_id_idx" ON "fin"."journal_line"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_line_financial_account_id_created_at_idx" ON "fin"."journal_line"("financial_account_id", "created_at");

-- CreateIndex
CREATE INDEX "journal_line_facility_id_created_at_idx" ON "fin"."journal_line"("facility_id", "created_at");

-- CreateIndex
CREATE INDEX "charge_facility_id_service_date_idx" ON "fin"."charge"("facility_id", "service_date");

-- CreateIndex
CREATE INDEX "charge_encounter_id_idx" ON "fin"."charge"("encounter_id");

-- CreateIndex
CREATE INDEX "invoice_facility_id_status_issued_at_idx" ON "fin"."invoice"("facility_id", "status", "issued_at");

-- CreateIndex
CREATE INDEX "invoice_patient_id_idx" ON "fin"."invoice"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_organisation_id_reference_key" ON "fin"."invoice"("organisation_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_item_charge_id_key" ON "fin"."invoice_item"("charge_id");

-- CreateIndex
CREATE INDEX "invoice_item_invoice_id_idx" ON "fin"."invoice_item"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_facility_id_received_at_method_idx" ON "fin"."payment"("facility_id", "received_at", "method");

-- CreateIndex
CREATE UNIQUE INDEX "payment_organisation_id_reference_key" ON "fin"."payment"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "payment_allocation_invoice_id_idx" ON "fin"."payment_allocation"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocation_payment_id_invoice_id_key" ON "fin"."payment_allocation"("payment_id", "invoice_id");

-- CreateIndex
CREATE INDEX "refund_facility_id_refunded_at_idx" ON "fin"."refund"("facility_id", "refunded_at");

-- CreateIndex
CREATE UNIQUE INDEX "refund_organisation_id_reference_key" ON "fin"."refund"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "budget_organisation_id_facility_id_fiscal_year_idx" ON "fin"."budget"("organisation_id", "facility_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "budget_facility_id_name_fiscal_year_key" ON "fin"."budget"("facility_id", "name", "fiscal_year");

-- CreateIndex
CREATE INDEX "budget_line_budget_id_idx" ON "fin"."budget_line"("budget_id");

-- CreateIndex
CREATE INDEX "bank_account_organisation_id_facility_id_idx" ON "fin"."bank_account"("organisation_id", "facility_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_bank_account_id_value_date_idx" ON "fin"."bank_statement_line"("bank_account_id", "value_date");

-- CreateIndex
CREATE INDEX "bank_statement_line_facility_id_matched_at_idx" ON "fin"."bank_statement_line"("facility_id", "matched_at");

-- CreateIndex
CREATE INDEX "bank_reconciliation_facility_id_period_end_idx" ON "fin"."bank_reconciliation"("facility_id", "period_end");

-- CreateIndex
CREATE INDEX "daily_cash_reconciliation_organisation_id_facility_id_busin_idx" ON "fin"."daily_cash_reconciliation"("organisation_id", "facility_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_cash_reconciliation_facility_id_business_date_cash_po_key" ON "fin"."daily_cash_reconciliation"("facility_id", "business_date", "cash_point");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "people"."staff"("user_id");

-- CreateIndex
CREATE INDEX "staff_organisation_id_facility_id_status_idx" ON "people"."staff"("organisation_id", "facility_id", "status");

-- CreateIndex
CREATE INDEX "staff_facility_id_cadre_idx" ON "people"."staff"("facility_id", "cadre");

-- CreateIndex
CREATE UNIQUE INDEX "staff_facility_id_staff_number_key" ON "people"."staff"("facility_id", "staff_number");

-- CreateIndex
CREATE INDEX "staff_credential_staff_id_idx" ON "people"."staff_credential"("staff_id");

-- CreateIndex
CREATE INDEX "staff_credential_facility_id_expires_on_status_idx" ON "people"."staff_credential"("facility_id", "expires_on", "status");

-- CreateIndex
CREATE INDEX "staff_posting_staff_id_start_date_idx" ON "people"."staff_posting"("staff_id", "start_date");

-- CreateIndex
CREATE INDEX "staff_posting_facility_id_department_id_idx" ON "people"."staff_posting"("facility_id", "department_id");

-- CreateIndex
CREATE INDEX "staff_schedule_facility_id_period_start_idx" ON "people"."staff_schedule"("facility_id", "period_start");

-- CreateIndex
CREATE INDEX "shift_schedule_id_starts_at_idx" ON "people"."shift"("schedule_id", "starts_at");

-- CreateIndex
CREATE INDEX "shift_facility_id_starts_at_idx" ON "people"."shift"("facility_id", "starts_at");

-- CreateIndex
CREATE INDEX "attendance_staff_id_occurred_at_idx" ON "people"."attendance"("staff_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attendance_facility_id_occurred_at_idx" ON "people"."attendance"("facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "leave_staff_id_start_date_idx" ON "people"."leave"("staff_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_facility_id_status_start_date_idx" ON "people"."leave"("facility_id", "status", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "performance_metric_organisation_id_code_key" ON "people"."performance_metric"("organisation_id", "code");

-- CreateIndex
CREATE INDEX "performance_metric_result_facility_id_period_start_idx" ON "people"."performance_metric_result"("facility_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "performance_metric_result_metric_id_staff_id_period_start_p_key" ON "people"."performance_metric_result"("metric_id", "staff_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "performance_review_facility_id_period_end_idx" ON "people"."performance_review"("facility_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "performance_review_staff_id_period_start_period_end_key" ON "people"."performance_review"("staff_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "staff_incentive_facility_id_status_period_end_idx" ON "people"."staff_incentive"("facility_id", "status", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "staff_incentive_staff_id_period_start_period_end_key" ON "people"."staff_incentive"("staff_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "incentive_component_staff_incentive_id_idx" ON "people"."incentive_component"("staff_incentive_id");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_code_key" ON "qual"."kpi"("code");

-- CreateIndex
CREATE INDEX "kpi_domain_code_idx" ON "qual"."kpi"("domain_code");

-- CreateIndex
CREATE INDEX "kpi_assignment_organisation_id_facility_id_idx" ON "qual"."kpi_assignment"("organisation_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_assignment_kpi_id_facility_id_key" ON "qual"."kpi_assignment"("kpi_id", "facility_id");

-- CreateIndex
CREATE INDEX "kpi_result_facility_id_period_end_idx" ON "qual"."kpi_result"("facility_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_result_kpi_assignment_id_period_start_period_end_key" ON "qual"."kpi_result"("kpi_assignment_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "risk_facility_id_status_risk_score_idx" ON "qual"."risk"("facility_id", "status", "risk_score");

-- CreateIndex
CREATE UNIQUE INDEX "risk_organisation_id_reference_key" ON "qual"."risk"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "incident_facility_id_status_occurred_at_idx" ON "qual"."incident"("facility_id", "status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_organisation_id_reference_key" ON "qual"."incident"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "complaint_facility_id_status_received_at_idx" ON "qual"."complaint"("facility_id", "status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_organisation_id_reference_key" ON "qual"."complaint"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "complaint_action_complaint_id_idx" ON "qual"."complaint_action"("complaint_id");

-- CreateIndex
CREATE INDEX "quality_improvement_facility_id_status_idx" ON "qual"."quality_improvement"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quality_improvement_organisation_id_reference_key" ON "qual"."quality_improvement"("organisation_id", "reference");

-- CreateIndex
CREATE INDEX "corrective_action_facility_id_status_due_date_idx" ON "qual"."corrective_action"("facility_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_requirement_code_key" ON "qual"."compliance_requirement"("code");

-- CreateIndex
CREATE INDEX "compliance_status_facility_id_state_expires_on_idx" ON "qual"."compliance_status"("facility_id", "state", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_status_requirement_id_facility_id_key" ON "qual"."compliance_status"("requirement_id", "facility_id");

-- CreateIndex
CREATE INDEX "generated_document_facility_id_document_type_status_idx" ON "qual"."generated_document"("facility_id", "document_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "generated_document_organisation_id_reference_key" ON "qual"."generated_document"("organisation_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_document_id_version_number_key" ON "qual"."document_version"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "report_run_facility_id_report_code_run_at_idx" ON "qual"."report_run"("facility_id", "report_code", "run_at");

-- CreateIndex
CREATE INDEX "ai_insight_organisation_id_facility_id_insight_type_generat_idx" ON "qual"."ai_insight"("organisation_id", "facility_id", "insight_type", "generated_at");

-- CreateIndex
CREATE INDEX "ai_insight_subject_type_subject_id_idx" ON "qual"."ai_insight"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_log_organisation_id_facility_id_occurred_at_idx" ON "audit"."audit_log"("organisation_id", "facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit"."audit_log"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit"."audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_action_occurred_at_idx" ON "audit"."audit_log"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_severity_occurred_at_idx" ON "audit"."audit_log"("severity", "occurred_at");

-- CreateIndex
CREATE INDEX "sync_event_device_id_occurred_at_idx" ON "audit"."sync_event"("device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "sync_event_organisation_id_facility_id_occurred_at_idx" ON "audit"."sync_event"("organisation_id", "facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "sync_conflict_organisation_id_facility_id_resolution_idx" ON "audit"."sync_conflict"("organisation_id", "facility_id", "resolution");

-- CreateIndex
CREATE INDEX "sync_conflict_entity_type_entity_id_idx" ON "audit"."sync_conflict"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "outbox_message_status_available_at_idx" ON "audit"."outbox_message"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_message_topic_status_idx" ON "audit"."outbox_message"("topic", "status");

-- CreateIndex
CREATE INDEX "notification_user_id_status_created_at_idx" ON "audit"."notification"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notification_organisation_id_facility_id_category_created_a_idx" ON "audit"."notification"("organisation_id", "facility_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "backup_verification_backup_type_backup_taken_at_idx" ON "audit"."backup_verification"("backup_type", "backup_taken_at");

-- AddForeignKey
ALTER TABLE "core"."facility" ADD CONSTRAINT "facility_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."facility" ADD CONSTRAINT "facility_facility_type_id_fkey" FOREIGN KEY ("facility_type_id") REFERENCES "core"."facility_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."facility_location" ADD CONSTRAINT "facility_location_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."facility_ownership" ADD CONSTRAINT "facility_ownership_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."facility_stage_transition" ADD CONSTRAINT "facility_stage_transition_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."department" ADD CONSTRAINT "department_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."service_offering" ADD CONSTRAINT "service_offering_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."service_offering" ADD CONSTRAINT "service_offering_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "core"."service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."service_offering" ADD CONSTRAINT "service_offering_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."tariff_version" ADD CONSTRAINT "tariff_version_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "core"."service_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."app_user" ADD CONSTRAINT "app_user_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role" ADD CONSTRAINT "role_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "core"."permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_facility_access" ADD CONSTRAINT "user_facility_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_facility_access" ADD CONSTRAINT "user_facility_access_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_facility_access" ADD CONSTRAINT "user_facility_access_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."refresh_token" ADD CONSTRAINT "refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "core"."user_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_mfa_factor" ADD CONSTRAINT "user_mfa_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."system_configuration" ADD CONSTRAINT "system_configuration_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."community" ADD CONSTRAINT "community_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."community" ADD CONSTRAINT "community_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."community_profile" ADD CONSTRAINT "community_profile_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "core"."community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."community_survey" ADD CONSTRAINT "community_survey_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "core"."community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."community_survey_response" ADD CONSTRAINT "community_survey_response_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "core"."community_survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_template_version" ADD CONSTRAINT "assessment_template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assess"."assessment_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_section" ADD CONSTRAINT "assessment_section_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "assess"."assessment_template_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_item" ADD CONSTRAINT "assessment_item_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "assess"."assessment_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."facility_assessment" ADD CONSTRAINT "facility_assessment_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."facility_assessment" ADD CONSTRAINT "facility_assessment_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "assess"."assessment_template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_response" ADD CONSTRAINT "assessment_response_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assess"."facility_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_response" ADD CONSTRAINT "assessment_response_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "assess"."assessment_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_response" ADD CONSTRAINT "assessment_response_amends_id_fkey" FOREIGN KEY ("amends_id") REFERENCES "assess"."assessment_response"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_finding" ADD CONSTRAINT "assessment_finding_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "assess"."assessment_response"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."photograph" ADD CONSTRAINT "photograph_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "assess"."evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."photograph" ADD CONSTRAINT "photograph_paired_with_id_fkey" FOREIGN KEY ("paired_with_id") REFERENCES "assess"."photograph"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."evidence_document" ADD CONSTRAINT "evidence_document_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "assess"."evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_evidence" ADD CONSTRAINT "assessment_evidence_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "assess"."assessment_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_evidence" ADD CONSTRAINT "assessment_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "assess"."evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."finding_evidence" ADD CONSTRAINT "finding_evidence_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "assess"."assessment_finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."finding_evidence" ADD CONSTRAINT "finding_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "assess"."evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_score" ADD CONSTRAINT "assessment_score_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assess"."facility_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."assessment_score" ADD CONSTRAINT "assessment_score_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "assess"."assessment_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."baseline_snapshot" ADD CONSTRAINT "baseline_snapshot_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."baseline_snapshot" ADD CONSTRAINT "baseline_snapshot_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assess"."facility_assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assess"."baseline_metric" ADD CONSTRAINT "baseline_metric_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "assess"."baseline_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."need" ADD CONSTRAINT "need_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "assess"."assessment_finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."recommendation" ADD CONSTRAINT "recommendation_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "plan"."need"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capex_plan" ADD CONSTRAINT "capex_plan_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capex_line" ADD CONSTRAINT "capex_line_capex_plan_id_fkey" FOREIGN KEY ("capex_plan_id") REFERENCES "plan"."capex_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capex_line" ADD CONSTRAINT "capex_line_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "plan"."recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."working_capital_plan" ADD CONSTRAINT "working_capital_plan_capex_plan_id_fkey" FOREIGN KEY ("capex_plan_id") REFERENCES "plan"."capex_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."financial_model" ADD CONSTRAINT "financial_model_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."financial_model" ADD CONSTRAINT "financial_model_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "plan"."financial_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."model_assumption" ADD CONSTRAINT "model_assumption_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "plan"."financial_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."model_scenario" ADD CONSTRAINT "model_scenario_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "plan"."financial_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."model_projection" ADD CONSTRAINT "model_projection_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "plan"."model_scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."partnership" ADD CONSTRAINT "partnership_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."partnership" ADD CONSTRAINT "partnership_financial_model_id_fkey" FOREIGN KEY ("financial_model_id") REFERENCES "plan"."financial_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."partnership_party" ADD CONSTRAINT "partnership_party_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "plan"."partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."partnership_obligation" ADD CONSTRAINT "partnership_obligation_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "plan"."partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."partnership_obligation" ADD CONSTRAINT "partnership_obligation_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "plan"."partnership_party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."revenue_share_model" ADD CONSTRAINT "revenue_share_model_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "plan"."partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."waterfall_step" ADD CONSTRAINT "waterfall_step_revenue_share_model_id_fkey" FOREIGN KEY ("revenue_share_model_id") REFERENCES "plan"."revenue_share_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."waterfall_step" ADD CONSTRAINT "waterfall_step_beneficiary_party_id_fkey" FOREIGN KEY ("beneficiary_party_id") REFERENCES "plan"."partnership_party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capital_recovery_event" ADD CONSTRAINT "capital_recovery_event_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "plan"."partnership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capital_recovery_event" ADD CONSTRAINT "capital_recovery_event_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "plan"."partnership_party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."capital_recovery_event" ADD CONSTRAINT "capital_recovery_event_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "fin"."payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."proposal" ADD CONSTRAINT "proposal_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."proposal_section" ADD CONSTRAINT "proposal_section_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "plan"."proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."letter" ADD CONSTRAINT "letter_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "plan"."letter_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."contract" ADD CONSTRAINT "contract_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "plan"."partnership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."contract_version" ADD CONSTRAINT "contract_version_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "plan"."contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."approval" ADD CONSTRAINT "approval_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "plan"."proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan"."approval" ADD CONSTRAINT "approval_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "plan"."contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."room" ADD CONSTRAINT "room_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."room" ADD CONSTRAINT "room_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."infrastructure_item" ADD CONSTRAINT "infrastructure_item_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "exec"."room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."utility" ADD CONSTRAINT "utility_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."capital_project" ADD CONSTRAINT "capital_project_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."capital_project" ADD CONSTRAINT "capital_project_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "plan"."recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."capital_project" ADD CONSTRAINT "capital_project_capex_line_id_fkey" FOREIGN KEY ("capex_line_id") REFERENCES "plan"."capex_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_phase" ADD CONSTRAINT "project_phase_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_task" ADD CONSTRAINT "project_task_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "exec"."project_phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_task_dependency" ADD CONSTRAINT "project_task_dependency_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "exec"."project_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_task_dependency" ADD CONSTRAINT "project_task_dependency_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "exec"."project_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_milestone" ADD CONSTRAINT "project_milestone_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_budget" ADD CONSTRAINT "project_budget_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_budget" ADD CONSTRAINT "project_budget_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "fin"."budget_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_expense" ADD CONSTRAINT "project_expense_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_expense" ADD CONSTRAINT "project_expense_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "fin"."payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_evidence" ADD CONSTRAINT "project_evidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."project_evidence" ADD CONSTRAINT "project_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "assess"."evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."supplier" ADD CONSTRAINT "supplier_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "core"."organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_request" ADD CONSTRAINT "purchase_request_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_request_line" ADD CONSTRAINT "purchase_request_line_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "exec"."purchase_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_request_line" ADD CONSTRAINT "purchase_request_line_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."quotation" ADD CONSTRAINT "quotation_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "exec"."purchase_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."quotation" ADD CONSTRAINT "quotation_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "exec"."supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "exec"."quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_order" ADD CONSTRAINT "purchase_order_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "exec"."purchase_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "exec"."supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "exec"."purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."purchase_order_line" ADD CONSTRAINT "purchase_order_line_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."goods_receipt" ADD CONSTRAINT "goods_receipt_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "exec"."purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "exec"."goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "exec"."purchase_order_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "exec"."supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."supplier_invoice" ADD CONSTRAINT "supplier_invoice_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "exec"."purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."equipment_asset" ADD CONSTRAINT "equipment_asset_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."equipment_asset" ADD CONSTRAINT "equipment_asset_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "exec"."room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."equipment_asset" ADD CONSTRAINT "equipment_asset_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "exec"."goods_receipt_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "exec"."equipment_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."commissioning_record" ADD CONSTRAINT "commissioning_record_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "exec"."equipment_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exec"."commissioning_record" ADD CONSTRAINT "commissioning_record_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient" ADD CONSTRAINT "patient_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient" ADD CONSTRAINT "patient_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "core"."community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient" ADD CONSTRAINT "patient_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "clinical"."patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient_identifier" ADD CONSTRAINT "patient_identifier_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient_contact" ADD CONSTRAINT "patient_contact_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient_consent" ADD CONSTRAINT "patient_consent_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."encounter" ADD CONSTRAINT "encounter_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."encounter" ADD CONSTRAINT "encounter_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."triage" ADD CONSTRAINT "triage_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."clinical_note" ADD CONSTRAINT "clinical_note_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."clinical_note" ADD CONSTRAINT "clinical_note_amends_id_fkey" FOREIGN KEY ("amends_id") REFERENCES "clinical"."clinical_note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."nursing_note" ADD CONSTRAINT "nursing_note_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."nursing_note" ADD CONSTRAINT "nursing_note_amends_id_fkey" FOREIGN KEY ("amends_id") REFERENCES "clinical"."nursing_note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."diagnosis" ADD CONSTRAINT "diagnosis_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."diagnosis" ADD CONSTRAINT "diagnosis_amends_id_fkey" FOREIGN KEY ("amends_id") REFERENCES "clinical"."diagnosis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."procedure" ADD CONSTRAINT "procedure_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."referral" ADD CONSTRAINT "referral_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."appointment" ADD CONSTRAINT "appointment_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."medication" ADD CONSTRAINT "medication_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."prescription" ADD CONSTRAINT "prescription_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."prescription_item" ADD CONSTRAINT "prescription_item_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "clinical"."prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."prescription_item" ADD CONSTRAINT "prescription_item_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "clinical"."medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."dispensing" ADD CONSTRAINT "dispensing_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "clinical"."prescription_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."dispensing" ADD CONSTRAINT "dispensing_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "supply"."inventory_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."dispensing" ADD CONSTRAINT "dispensing_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "fin"."charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_reference_range" ADD CONSTRAINT "lab_reference_range_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "clinical"."lab_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_order" ADD CONSTRAINT "lab_order_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_order_item" ADD CONSTRAINT "lab_order_item_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "clinical"."lab_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_order_item" ADD CONSTRAINT "lab_order_item_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "clinical"."lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_order_item" ADD CONSTRAINT "lab_order_item_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "fin"."charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_sample" ADD CONSTRAINT "lab_sample_lab_order_item_id_fkey" FOREIGN KEY ("lab_order_item_id") REFERENCES "clinical"."lab_order_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_result" ADD CONSTRAINT "lab_result_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "clinical"."lab_sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_result" ADD CONSTRAINT "lab_result_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "clinical"."lab_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_result" ADD CONSTRAINT "lab_result_amends_id_fkey" FOREIGN KEY ("amends_id") REFERENCES "clinical"."lab_result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."lab_quality_control" ADD CONSTRAINT "lab_quality_control_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "clinical"."lab_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."maternity_record" ADD CONSTRAINT "maternity_record_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."anc_visit" ADD CONSTRAINT "anc_visit_maternity_record_id_fkey" FOREIGN KEY ("maternity_record_id") REFERENCES "clinical"."maternity_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."anc_visit" ADD CONSTRAINT "anc_visit_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."delivery_record" ADD CONSTRAINT "delivery_record_maternity_record_id_fkey" FOREIGN KEY ("maternity_record_id") REFERENCES "clinical"."maternity_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."delivery_record" ADD CONSTRAINT "delivery_record_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."immunisation" ADD CONSTRAINT "immunisation_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."immunisation" ADD CONSTRAINT "immunisation_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."growth_measurement" ADD CONSTRAINT "growth_measurement_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."growth_measurement" ADD CONSTRAINT "growth_measurement_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."chronic_condition" ADD CONSTRAINT "chronic_condition_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."chronic_followup" ADD CONSTRAINT "chronic_followup_chronic_condition_id_fkey" FOREIGN KEY ("chronic_condition_id") REFERENCES "clinical"."chronic_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical"."patient_survey" ADD CONSTRAINT "patient_survey_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_category" ADD CONSTRAINT "inventory_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "supply"."inventory_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_item" ADD CONSTRAINT "inventory_item_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_item" ADD CONSTRAINT "inventory_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "supply"."inventory_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_location" ADD CONSTRAINT "stock_location_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_location" ADD CONSTRAINT "stock_location_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "exec"."room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_batch" ADD CONSTRAINT "inventory_batch_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_batch" ADD CONSTRAINT "inventory_batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "exec"."supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."inventory_batch" ADD CONSTRAINT "inventory_batch_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "exec"."goods_receipt_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_transaction" ADD CONSTRAINT "stock_transaction_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "supply"."inventory_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_transaction" ADD CONSTRAINT "stock_transaction_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "supply"."stock_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_transaction" ADD CONSTRAINT "stock_transaction_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "supply"."stock_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."reorder_rule" ADD CONSTRAINT "reorder_rule_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_count" ADD CONSTRAINT "stock_count_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "supply"."stock_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_count_line" ADD CONSTRAINT "stock_count_line_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "supply"."stock_count"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_count_line" ADD CONSTRAINT "stock_count_line_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "supply"."inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_count_line" ADD CONSTRAINT "stock_count_line_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "supply"."inventory_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply"."stock_adjustment" ADD CONSTRAINT "stock_adjustment_stock_count_line_id_fkey" FOREIGN KEY ("stock_count_line_id") REFERENCES "supply"."stock_count_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."financial_account" ADD CONSTRAINT "financial_account_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fin"."financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."financial_period" ADD CONSTRAINT "financial_period_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."journal_entry" ADD CONSTRAINT "journal_entry_financial_period_id_fkey" FOREIGN KEY ("financial_period_id") REFERENCES "fin"."financial_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."journal_entry" ADD CONSTRAINT "journal_entry_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "fin"."journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."journal_line" ADD CONSTRAINT "journal_line_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "fin"."journal_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."journal_line" ADD CONSTRAINT "journal_line_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "fin"."financial_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."charge" ADD CONSTRAINT "charge_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "clinical"."encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."charge" ADD CONSTRAINT "charge_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "core"."service_offering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."charge" ADD CONSTRAINT "charge_tariff_version_id_fkey" FOREIGN KEY ("tariff_version_id") REFERENCES "core"."tariff_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."invoice" ADD CONSTRAINT "invoice_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "clinical"."patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."invoice_item" ADD CONSTRAINT "invoice_item_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin"."invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."invoice_item" ADD CONSTRAINT "invoice_item_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "fin"."charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."payment" ADD CONSTRAINT "payment_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "exec"."supplier_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "fin"."payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."payment_allocation" ADD CONSTRAINT "payment_allocation_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin"."invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."refund" ADD CONSTRAINT "refund_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "fin"."payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."budget" ADD CONSTRAINT "budget_revision_of_id_fkey" FOREIGN KEY ("revision_of_id") REFERENCES "fin"."budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."budget_line" ADD CONSTRAINT "budget_line_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "fin"."budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."budget_line" ADD CONSTRAINT "budget_line_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "fin"."financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."budget_line" ADD CONSTRAINT "budget_line_capex_line_id_fkey" FOREIGN KEY ("capex_line_id") REFERENCES "plan"."capex_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."bank_statement_line" ADD CONSTRAINT "bank_statement_line_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "fin"."bank_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."bank_statement_line" ADD CONSTRAINT "bank_statement_line_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "fin"."bank_reconciliation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin"."bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "fin"."bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff" ADD CONSTRAINT "staff_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff_credential" ADD CONSTRAINT "staff_credential_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff_posting" ADD CONSTRAINT "staff_posting_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff_posting" ADD CONSTRAINT "staff_posting_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff_schedule" ADD CONSTRAINT "staff_schedule_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."shift" ADD CONSTRAINT "shift_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "people"."staff_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."attendance" ADD CONSTRAINT "attendance_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."attendance" ADD CONSTRAINT "attendance_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "people"."attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."leave" ADD CONSTRAINT "leave_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."performance_metric_result" ADD CONSTRAINT "performance_metric_result_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "people"."performance_metric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."performance_metric_result" ADD CONSTRAINT "performance_metric_result_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."performance_review" ADD CONSTRAINT "performance_review_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."staff_incentive" ADD CONSTRAINT "staff_incentive_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "people"."staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."incentive_component" ADD CONSTRAINT "incentive_component_staff_incentive_id_fkey" FOREIGN KEY ("staff_incentive_id") REFERENCES "people"."staff_incentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."incentive_component" ADD CONSTRAINT "incentive_component_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "people"."performance_metric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."kpi_assignment" ADD CONSTRAINT "kpi_assignment_kpi_id_fkey" FOREIGN KEY ("kpi_id") REFERENCES "qual"."kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."kpi_assignment" ADD CONSTRAINT "kpi_assignment_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "core"."facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."kpi_assignment" ADD CONSTRAINT "kpi_assignment_baseline_snapshot_id_fkey" FOREIGN KEY ("baseline_snapshot_id") REFERENCES "assess"."baseline_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."kpi_result" ADD CONSTRAINT "kpi_result_kpi_assignment_id_fkey" FOREIGN KEY ("kpi_assignment_id") REFERENCES "qual"."kpi_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."risk" ADD CONSTRAINT "risk_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "exec"."capital_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."complaint_action" ADD CONSTRAINT "complaint_action_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "qual"."complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."corrective_action" ADD CONSTRAINT "corrective_action_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "qual"."incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."corrective_action" ADD CONSTRAINT "corrective_action_quality_improvement_id_fkey" FOREIGN KEY ("quality_improvement_id") REFERENCES "qual"."quality_improvement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."compliance_status" ADD CONSTRAINT "compliance_status_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "qual"."compliance_requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qual"."document_version" ADD CONSTRAINT "document_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "qual"."generated_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."sync_conflict" ADD CONSTRAINT "sync_conflict_sync_event_id_fkey" FOREIGN KEY ("sync_event_id") REFERENCES "audit"."sync_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

