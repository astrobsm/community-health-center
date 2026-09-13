/**
 * Seed — STRUCTURAL REFERENCE DATA ONLY.
 *
 * This script creates the things the system cannot function without and that
 * are the same for every deployment: permissions, role templates, facility
 * types, the service catalogue, the chart of accounts, assessment templates,
 * KPI definitions, and the compliance register.
 *
 * It creates NO patients, NO encounters, NO payments, NO stock, and NO
 * financial figures. Spec section 91 forbids fabricated data, and section 13
 * is explicit that illustrative numbers must never be populated as real Ikem
 * data. The guard in `assertNoFabrication()` enforces that rather than trusting
 * whoever runs this next.
 *
 * Every row is marked `isSystemManaged = true` so an organisation can extend
 * the reference data without an upgrade silently overwriting their changes.
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_TEMPLATES, ROLE_CODES, parsePermission } from '@chc/contracts';

import { CHART_OF_ACCOUNTS } from './data/chart-of-accounts';
import { COMPLIANCE_REQUIREMENTS } from './data/compliance';
import { FACILITY_TYPES } from './data/facility-types';
import { FIELD_ASSESSMENT_TEMPLATE } from './data/assessment-template';
import { KPI_DEFINITIONS } from './data/kpis';
import { SERVICES } from './data/services';

const prisma = new PrismaClient();

function assertNoFabrication(): void {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const allowFixtures = ['true', '1', 'yes'].includes((process.env['ALLOW_DEMO_FIXTURES'] ?? '').toLowerCase());

  if (nodeEnv === 'production' && allowFixtures) {
    throw new Error(
      'ALLOW_DEMO_FIXTURES is set in production. Fabricated clinical or financial records must never exist in a live facility (spec section 91).',
    );
  }

  console.log(`Seeding reference data (NODE_ENV=${nodeEnv}).`);
  console.log('No patients, encounters, payments or stock will be created.');
}

async function seedPermissions(): Promise<number> {
  for (const code of PERMISSIONS) {
    const { module, action } = parsePermission(code);
    await prisma.permission.upsert({
      where: { code },
      create: { code, module, action, description: `${action} within ${module}` },
      update: { module, action },
    });
  }
  return PERMISSIONS.length;
}

async function seedFacilityTypes(): Promise<number> {
  for (const type of FACILITY_TYPES) {
    await prisma.facilityType.upsert({
      where: { code: type.code },
      create: { ...type, isSystemManaged: true },
      update: { name: type.name, description: type.description },
    });
  }
  return FACILITY_TYPES.length;
}

async function seedServices(): Promise<number> {
  for (const service of SERVICES) {
    await prisma.service.upsert({
      where: { code: service.code },
      create: { ...service, isSystemManaged: true },
      update: { name: service.name, category: service.category },
    });
  }
  return SERVICES.length;
}

async function seedKpis(): Promise<number> {
  for (const kpi of KPI_DEFINITIONS) {
    await prisma.kpi.upsert({
      where: { code: kpi.code },
      create: { ...kpi, isSystemManaged: true },
      update: {
        name: kpi.name,
        definition: kpi.definition,
        unit: kpi.unit,
        direction: kpi.direction,
        sourceQueryId: kpi.sourceQueryId,
      },
    });
  }
  return KPI_DEFINITIONS.length;
}

async function seedComplianceRequirements(): Promise<number> {
  for (const requirement of COMPLIANCE_REQUIREMENTS) {
    await prisma.complianceRequirement.upsert({
      where: { code: requirement.code },
      create: { ...requirement, isSystemManaged: true },
      update: {
        name: requirement.name,
        description: requirement.description,
        responsibleAuthority: requirement.responsibleAuthority,
      },
    });
  }
  return COMPLIANCE_REQUIREMENTS.length;
}

async function seedAssessmentTemplate(): Promise<{ sections: number; items: number }> {
  const template = await prisma.assessmentTemplate.upsert({
    where: { code: FIELD_ASSESSMENT_TEMPLATE.code },
    create: {
      code: FIELD_ASSESSMENT_TEMPLATE.code,
      name: FIELD_ASSESSMENT_TEMPLATE.name,
      description: FIELD_ASSESSMENT_TEMPLATE.description,
      isSystemManaged: true,
    },
    update: { name: FIELD_ASSESSMENT_TEMPLATE.name },
  });

  const existing = await prisma.assessmentTemplateVersion.findFirst({
    where: { templateId: template.id, versionNumber: 1 },
  });

  if (existing) {
    // A published template version is immutable: responses captured against it
    // must stay interpretable. A change means a NEW version, never an edit.
    return { sections: 0, items: 0 };
  }

  const version = await prisma.assessmentTemplateVersion.create({
    data: {
      templateId: template.id,
      versionNumber: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      changeNote: 'Initial published version.',
    },
  });

  let sectionCount = 0;
  let itemCount = 0;

  for (const [sectionIndex, section] of FIELD_ASSESSMENT_TEMPLATE.sections.entries()) {
    const created = await prisma.assessmentSection.create({
      data: {
        templateVersionId: version.id,
        code: section.code,
        name: section.name,
        description: section.description,
        sequence: sectionIndex + 1,
        weight: section.weight,
      },
    });
    sectionCount += 1;

    for (const [itemIndex, item] of section.items.entries()) {
      await prisma.assessmentItem.create({
        data: {
          sectionId: created.id,
          code: item.code,
          question: item.question,
          helpText: item.helpText,
          responseType: item.responseType,
          options: item.options ?? undefined,
          unit: item.unit,
          sequence: itemIndex + 1,
          weight: item.weight ?? 1,
          isRequired: item.isRequired ?? true,
          evidenceRequired: item.evidenceRequired ?? false,
        },
      });
      itemCount += 1;
    }
  }

  return { sections: sectionCount, items: itemCount };
}

/**
 * Roles and the chart of accounts are organisation-scoped, so they are seeded
 * per organisation. With no organisation yet, nothing is created — which is
 * correct: a fresh install has no tenant.
 */
async function seedForOrganisation(organisationId: string, organisationName: string): Promise<void> {
  console.log(`\n  Organisation: ${organisationName}`);

  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((p) => [p.code, p.id]));

  for (const roleCode of ROLE_CODES) {
    const template = ROLE_TEMPLATES[roleCode];

    const role = await prisma.role.upsert({
      where: { organisationId_code: { organisationId, code: roleCode } },
      create: {
        organisationId,
        code: roleCode,
        name: template.name,
        description: template.description,
        isSystemManaged: true,
      },
      update: { name: template.name, description: template.description },
    });

    for (const permissionCode of template.permissions) {
      const permissionId = permissionByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(
          `Role ${roleCode} references permission "${permissionCode}", which is not in the catalogue. ` +
            'Add it to packages/contracts/src/permissions.ts.',
        );
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId },
        update: {},
      });
    }

    console.log(`    role ${roleCode.padEnd(20)} ${template.permissions.length} permission(s)`);
  }

  let accountCount = 0;
  const accountIdByCode = new Map<string, string>();

  for (const account of CHART_OF_ACCOUNTS) {
    const parentId = account.parentCode ? accountIdByCode.get(account.parentCode) : undefined;

    const created = await prisma.financialAccount.upsert({
      where: { organisationId_code: { organisationId, code: account.code } },
      create: {
        organisationId,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        normalBalance: account.normalBalance,
        isPostable: account.isPostable,
        parentId,
        isSystemManaged: true,
      },
      update: { name: account.name, parentId },
    });

    accountIdByCode.set(account.code, created.id);
    accountCount += 1;
  }

  console.log(`    chart of accounts   ${accountCount} account(s)`);
}

async function main(): Promise<void> {
  assertNoFabrication();
  console.log('');

  const permissionCount = await seedPermissions();
  console.log(`  permissions            ${permissionCount}`);

  const facilityTypeCount = await seedFacilityTypes();
  console.log(`  facility types         ${facilityTypeCount}`);

  const serviceCount = await seedServices();
  console.log(`  services               ${serviceCount}`);

  const kpiCount = await seedKpis();
  console.log(`  KPI definitions        ${kpiCount}`);

  const complianceCount = await seedComplianceRequirements();
  console.log(`  compliance register    ${complianceCount}`);

  const template = await seedAssessmentTemplate();
  if (template.sections > 0) {
    console.log(`  assessment template    ${template.sections} sections, ${template.items} items`);
  } else {
    console.log('  assessment template    already published (immutable; a change requires a new version)');
  }

  const organisations = await prisma.organisation.findMany({ select: { id: true, name: true } });

  if (organisations.length === 0) {
    console.log('\n  No organisation exists yet, so roles and the chart of accounts were not seeded.');
    console.log('  Create an organisation, then re-run this seed to populate its roles and accounts.');
  } else {
    for (const organisation of organisations) {
      await seedForOrganisation(organisation.id, organisation.name);
    }
  }

  console.log('\nSeed complete. No clinical or financial records were created.');
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
