/**
 * Create a user with a role and facility access.
 *
 * The everyday counterpart to bootstrap-organisation: once an organisation
 * exists, this adds people to it. Used by the smoke tests to create the two
 * users that separation of duties requires, and usable operationally until the
 * user-administration UI lands.
 *
 * Usage:
 *   EMAIL=... NAME=... PASSWORD=... ROLE=PROJECT_MANAGER [FACILITY_CODE=...] \
 *   npm run create:user --workspace @chc/api
 */

import { PrismaClient } from '@prisma/client';
import { ROLE_CODES, type RoleCode } from '@chc/contracts';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

async function main(): Promise<void> {
  const email = required('EMAIL').toLowerCase();
  const fullName = required('NAME');
  const password = required('PASSWORD');
  const roleCode = required('ROLE') as RoleCode;
  const facilityCode = process.env['FACILITY_CODE']?.trim();

  if (!ROLE_CODES.includes(roleCode)) {
    throw new Error(`ROLE must be one of: ${ROLE_CODES.join(', ')}`);
  }
  if (password.length < 12) {
    throw new Error('PASSWORD must be at least 12 characters.');
  }

  const organisation = await prisma.organisation.findFirst({ select: { id: true, name: true } });
  if (!organisation) {
    throw new Error('No organisation exists. Run bootstrap:org first.');
  }

  const role = await prisma.role.findUnique({
    where: { organisationId_code: { organisationId: organisation.id, code: roleCode } },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new Error(`Role ${roleCode} is not seeded for ${organisation.name}. Run db:seed.`);
  }

  const existing = await prisma.appUser.findUnique({
    where: { organisationId_email: { organisationId: organisation.id, email } },
    select: { id: true },
  });

  if (existing) {
    console.log(`${email} already exists. Nothing was changed.`);
    return;
  }

  const user = await prisma.appUser.create({
    data: {
      organisationId: organisation.id,
      email,
      fullName,
      passwordHash: await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 4,
      }),
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true, fullName: true },
  });

  const facilities = await prisma.facility.findMany({
    where: { organisationId: organisation.id, ...(facilityCode ? { code: facilityCode } : {}) },
    select: { id: true, code: true },
  });

  for (const facility of facilities) {
    await prisma.userFacilityAccess.create({
      data: {
        userId: user.id,
        facilityId: facility.id,
        organisationId: organisation.id,
        scopeLevel: 'FULL',
      },
    });
  }

  console.log(`Created ${user.fullName} <${user.email}> as ${role.name}`);
  console.log(`Facility access: ${facilities.map((f) => f.code).join(', ') || 'none'}`);
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
