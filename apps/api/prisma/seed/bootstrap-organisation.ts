/**
 * Bootstrap the first organisation, facility and administrator.
 *
 * This is the one operation that cannot be done through the API, because until
 * it has run there is no user to authenticate as.
 *
 * It creates STRUCTURE ONLY: an organisation, a facility at lifecycle stage
 * PRE_ASSESSMENT, and one administrator. No patients, no financial figures,
 * no baseline. The facility starts where a real one starts — unassessed.
 *
 * Usage:
 *   ORG_NAME="..." ORG_CODE="..." \
 *   FACILITY_NAME="..." FACILITY_CODE="..." STATE="..." LGA="..." \
 *   ADMIN_EMAIL="..." ADMIN_NAME="..." ADMIN_PASSWORD="..." \
 *   npm run bootstrap:org --workspace @chc/api
 *
 * Re-running is safe: it will not overwrite an existing organisation.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is required.\n\nExample:\n  ORG_NAME="Ikem Health Partnership" ORG_CODE="IHP" \\\n` +
        `  FACILITY_NAME="Community Health Centre, Ikem" FACILITY_CODE="CHC-IKEM" \\\n` +
        `  STATE="Enugu" LGA="Isi-Uzo" \\\n` +
        `  ADMIN_EMAIL="admin@example.org" ADMIN_NAME="A. Administrator" ADMIN_PASSWORD="<at least 12 characters>" \\\n` +
        `  npm run bootstrap:org --workspace @chc/api`,
    );
  }
  return value.trim();
}

async function main(): Promise<void> {
  const orgName = required('ORG_NAME');
  const orgCode = required('ORG_CODE');
  const facilityName = required('FACILITY_NAME');
  const facilityCode = required('FACILITY_CODE');
  const state = required('STATE');
  const lga = required('LGA');
  const adminEmail = required('ADMIN_EMAIL').toLowerCase();
  const adminName = required('ADMIN_NAME');
  const adminPassword = required('ADMIN_PASSWORD');

  if (adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  }

  const existing = await prisma.organisation.findUnique({ where: { code: orgCode } });
  if (existing) {
    console.log(`Organisation "${orgCode}" already exists. Nothing was changed.`);
    return;
  }

  const facilityType = await prisma.facilityType.findUnique({ where: { code: 'CHC' } });
  if (!facilityType) {
    throw new Error('Reference data is missing. Run `npm run db:seed --workspace @chc/api` first.');
  }

  const organisation = await prisma.organisation.create({
    data: { name: orgName, code: orgCode, country: 'NG', currency: 'NGN' },
  });
  console.log(`Organisation  ${organisation.name} (${organisation.code})`);

  const facility = await prisma.facility.create({
    data: {
      organisationId: organisation.id,
      facilityTypeId: facilityType.id,
      name: facilityName,
      code: facilityCode,
      // A real facility starts unassessed. Nothing about it is known yet, and
      // the system must not pretend otherwise.
      lifecycleStage: 'PRE_ASSESSMENT',
      location: {
        create: {
          organisationId: organisation.id,
          country: 'NG',
          state,
          lga,
          // Not yet observed. It becomes VERIFIED when an assessor records a
          // GPS fix on site.
          classification: 'REPORTED',
        },
      },
    },
  });
  console.log(`Facility      ${facility.name} (${facility.code}) — ${state} / ${lga}, stage PRE_ASSESSMENT`);

  const user = await prisma.appUser.create({
    data: {
      organisationId: organisation.id,
      email: adminEmail,
      fullName: adminName,
      passwordHash: await argon2.hash(adminPassword, {
        type: argon2.argon2id,
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 4,
      }),
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
    },
  });
  console.log(`Administrator ${user.fullName} <${user.email}>`);

  console.log('\nSeeding roles and the chart of accounts for the new organisation...');
  const { execSync } = await import('node:child_process');
  execSync('npx tsx prisma/seed/index.ts', { stdio: 'inherit' });

  const orgAdminRole = await prisma.role.findUnique({
    where: { organisationId_code: { organisationId: organisation.id, code: 'ORG_ADMIN' } },
  });

  if (!orgAdminRole) {
    throw new Error('ORG_ADMIN role was not created. Check the seed output above.');
  }

  await prisma.userRole.create({ data: { userId: user.id, roleId: orgAdminRole.id } });
  await prisma.userFacilityAccess.create({
    data: {
      userId: user.id,
      facilityId: facility.id,
      organisationId: organisation.id,
      scopeLevel: 'FULL',
    },
  });

  console.log(`\nGranted ORG_ADMIN and FULL access to ${facility.name}.`);
  console.log('\nNote: the ORG_ADMIN role requires two-factor authentication.');
  console.log('Enrol an authenticator before signing in, or grant a role that does not require MFA for initial setup.');
  console.log('\nBootstrap complete. No clinical or financial records were created.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
