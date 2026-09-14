import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateStaff, ExitStaff, RecordCredential, SuspendCredential, VerifyCredential } from '@chc/contracts';

import { PracticeBlockedError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { assessCredential, assessPractice, type Credential } from './domain/credentials';

/**
 * Staff records and the right to practise (spec §§23-24).
 *
 * The comparison this module exists to serve is REQUIRED → APPROVED → POSTED →
 * PRESENT. An establishment gap and an attendance gap are different problems
 * with different remedies, and a system that reports one number for both hides
 * whichever is the real one.
 *
 * Credential status is derived from the expiry date on every read. A licence
 * does not lapse because a job ran; it lapses because the date passed.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  async create(input: CreateStaff) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const context = tryGetContext();

    const staff = await this.prisma.staff.create({
      data: {
        id: input.id ?? randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        userId: input.userId,
        staffNumber: input.staffNumber,
        givenName: input.givenName,
        familyName: input.familyName,
        otherNames: input.otherNames,
        sex: input.sex,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        phone: input.phone,
        email: input.email,
        cadre: input.cadre,
        qualification: input.qualification,
        employerType: input.employerType,
        employmentDate: input.employmentDate ? new Date(input.employmentDate) : undefined,
        createdBy: context?.userId,
      },
      select: {
        id: true,
        staffNumber: true,
        givenName: true,
        familyName: true,
        cadre: true,
        employerType: true,
        status: true,
      },
    });

    await this.audit.record({
      action: 'hr.staff.create',
      entityType: 'staff',
      entityId: staff.id,
      facilityId: input.facilityId,
      newValue: { staffNumber: staff.staffNumber, cadre: staff.cadre, employerType: staff.employerType },
    });

    return staff;
  }

  async list(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const staff = await this.prisma.staff.findMany({
      where: { facilityId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { familyName: 'asc' }],
      select: {
        id: true,
        staffNumber: true,
        givenName: true,
        familyName: true,
        cadre: true,
        qualification: true,
        employerType: true,
        employmentDate: true,
        status: true,
        credentials: {
          select: {
            id: true,
            credentialType: true,
            credentialNumber: true,
            issuingBody: true,
            expiresOn: true,
            status: true,
            verifiedAt: true,
          },
        },
      },
    });

    const now = this.now();

    return staff.map((person) => {
      const decision = assessPractice(person.credentials.map(toCredential), now);

      return {
        id: person.id,
        staffNumber: person.staffNumber,
        givenName: person.givenName,
        familyName: person.familyName,
        cadre: person.cadre,
        qualification: person.qualification,
        employerType: person.employerType,
        employmentDate: person.employmentDate,
        status: person.status,
        // Derived on read, never stored (§10): a licence expires because a date
        // passed, not because a nightly job noticed.
        mayPractise: decision.mayPractise,
        practiceSummary: decision.summary,
        blockingCredentials: decision.blocking.map((item) => item.credentialType),
        expiringCredentials: decision.expiring.map((item) => ({
          credentialType: item.credentialType,
          daysToExpiry: item.daysToExpiry,
        })),
      };
    });
  }

  /**
   * How the establishment compares with who is actually here (spec §23).
   *
   * Counted by cadre, because "we are eight short" is useless without knowing
   * eight of what.
   */
  async establishment(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const staff = await this.prisma.staff.groupBy({
      by: ['cadre', 'status', 'employerType'],
      where: { facilityId, deletedAt: null },
      _count: { _all: true },
    });

    const byCadre = new Map<
      string,
      { cadre: string; active: number; onLeave: number; suspended: number; exited: number; byEmployer: Record<string, number> }
    >();

    for (const row of staff) {
      const entry =
        byCadre.get(row.cadre) ??
        { cadre: row.cadre, active: 0, onLeave: 0, suspended: 0, exited: 0, byEmployer: {} };

      const count = row._count._all;
      if (row.status === 'ACTIVE') entry.active += count;
      if (row.status === 'ON_LEAVE') entry.onLeave += count;
      if (row.status === 'SUSPENDED') entry.suspended += count;
      if (row.status === 'EXITED') entry.exited += count;
      if (row.status !== 'EXITED') {
        entry.byEmployer[row.employerType] = (entry.byEmployer[row.employerType] ?? 0) + count;
      }

      byCadre.set(row.cadre, entry);
    }

    return {
      // No establishment norm is asserted here. What a facility of this type
      // is *meant* to have is a government standard, and inventing one would
      // manufacture a gap (§82).
      note:
        'Counts of staff on the books, by cadre. The establishment a facility of this type should ' +
        'have is set by government standards and is not asserted by this system.',
      cadres: [...byCadre.values()].sort((a, b) => a.cadre.localeCompare(b.cadre)),
    };
  }

  async exit(input: ExitStaff) {
    const staff = await this.requireStaff(input.staffId);

    const updated = await this.prisma.staff.update({
      where: { id: staff.id },
      data: {
        status: 'EXITED',
        exitDate: new Date(input.exitDate),
        updatedBy: tryGetContext()?.userId,
        version: { increment: 1 },
      },
      select: { id: true, status: true, exitDate: true },
    });

    await this.audit.record({
      action: 'hr.staff.exit',
      entityType: 'staff',
      entityId: staff.id,
      facilityId: staff.facilityId,
      oldValue: { status: staff.status },
      newValue: { status: 'EXITED', exitDate: input.exitDate, reason: input.reason },
      severity: 'NOTICE',
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Credentials
  // ---------------------------------------------------------------------------

  async recordCredential(input: RecordCredential) {
    const staff = await this.requireStaff(input.staffId);
    const context = tryGetContext();

    const credential = await this.prisma.staffCredential.create({
      data: {
        staffId: staff.id,
        organisationId: staff.organisationId,
        facilityId: staff.facilityId,
        credentialType: input.credentialType,
        credentialNumber: input.credentialNumber,
        issuingBody: input.issuingBody,
        issuedOn: input.issuedOn ? new Date(input.issuedOn) : undefined,
        expiresOn: input.expiresOn ? new Date(input.expiresOn) : undefined,
        // Recorded is not verified. Somebody has to check it against the
        // issuing body, and until they have, the system says so.
        status: 'UNVERIFIED',
        evidenceStorageKey: input.evidenceStorageKey,
        createdBy: context?.userId,
      },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
      },
    });

    await this.audit.record({
      action: 'hr.credential.record',
      entityType: 'staff_credential',
      entityId: credential.id,
      facilityId: staff.facilityId,
      newValue: { staffId: staff.id, credentialType: input.credentialType },
    });

    return assessCredential(toCredential(credential), this.now());
  }

  /**
   * Verification is a separate act by a separate person (spec §24).
   *
   * Its whole value is that somebody looked at the register and said what they
   * saw, so the note is required and the verifier is recorded.
   */
  async verifyCredential(input: VerifyCredential) {
    const existing = await this.requireCredential(input.credentialId);
    const context = tryGetContext();

    if (existing.status === 'SUSPENDED') {
      throw new BadRequestException(
        'This credential is suspended. Verifying it would not lift the suspension; lift the suspension ' +
          'first, with a reason, and then verify.',
      );
    }

    const credential = await this.prisma.staffCredential.update({
      where: { id: existing.id },
      data: {
        status: 'VALID',
        verifiedBy: context?.userId,
        verifiedAt: this.now(),
        version: { increment: 1 },
      },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
      },
    });

    await this.audit.record({
      action: 'hr.credential.verify',
      entityType: 'staff_credential',
      entityId: credential.id,
      facilityId: existing.facilityId,
      oldValue: { status: existing.status },
      newValue: { status: 'VALID', note: input.verificationNote },
      severity: 'NOTICE',
    });

    // Assessed, not returned raw: a credential verified today may already have
    // expired, and reporting VALID for it would be false.
    return assessCredential(toCredential(credential), this.now());
  }

  async suspendCredential(input: SuspendCredential) {
    const existing = await this.requireCredential(input.credentialId);

    const credential = await this.prisma.staffCredential.update({
      where: { id: existing.id },
      data: { status: 'SUSPENDED', version: { increment: 1 } },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
      },
    });

    await this.audit.record({
      action: 'hr.credential.suspend',
      entityType: 'staff_credential',
      entityId: credential.id,
      facilityId: existing.facilityId,
      oldValue: { status: existing.status },
      newValue: { status: 'SUSPENDED', reason: input.reason },
      severity: 'WARNING',
    });

    return assessCredential(toCredential(credential), this.now());
  }

  async credentialsFor(staffId: string) {
    const staff = await this.requireStaff(staffId);

    const credentials = await this.prisma.staffCredential.findMany({
      where: { staffId: staff.id },
      orderBy: { expiresOn: 'asc' },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
      },
    });

    const now = this.now();
    const decision = assessPractice(credentials.map(toCredential), now);

    return {
      staffId: staff.id,
      name: `${staff.givenName} ${staff.familyName}`,
      credentials: credentials.map((credential) => assessCredential(toCredential(credential), now)),
      mayPractise: decision.mayPractise,
      summary: decision.summary,
    };
  }

  /**
   * Credentials expiring within the window, for the people who have to chase them.
   *
   * Computed from dates at the moment of asking, so the list is never stale.
   */
  async expiring(facilityId: string, withinDays: number) {
    this.assertFacilityVisible(facilityId);

    const credentials = await this.prisma.staffCredential.findMany({
      where: { facilityId, staff: { status: { not: 'EXITED' }, deletedAt: null } },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
        staff: { select: { id: true, givenName: true, familyName: true, cadre: true } },
      },
    });

    const now = this.now();

    return credentials
      .map((credential) => ({
        staff: credential.staff,
        assessment: assessCredential(toCredential(credential), now, withinDays),
      }))
      .filter(
        (row) =>
          row.assessment.effectiveStatus === 'EXPIRING' ||
          row.assessment.effectiveStatus === 'EXPIRED' ||
          row.assessment.effectiveStatus === 'SUSPENDED' ||
          row.assessment.effectiveStatus === 'UNVERIFIED',
      )
      .sort((a, b) => (a.assessment.daysToExpiry ?? 1e9) - (b.assessment.daysToExpiry ?? 1e9));
  }

  /**
   * Refuses to let somebody be rostered or paid when a credential they hold
   * does not permit practice.
   *
   * Called by the scheduling and incentive paths rather than being a screen of
   * its own, because a warning nobody has to act on is a warning that gets
   * clicked past.
   */
  async assertMayPractise(staffId: string): Promise<void> {
    const staff = await this.requireStaff(staffId);

    const credentials = await this.prisma.staffCredential.findMany({
      where: { staffId: staff.id },
      select: {
        id: true,
        credentialType: true,
        credentialNumber: true,
        issuingBody: true,
        expiresOn: true,
        status: true,
        verifiedAt: true,
      },
    });

    const decision = assessPractice(credentials.map(toCredential), this.now());

    if (!decision.mayPractise) {
      throw new PracticeBlockedError(
        `${staff.givenName} ${staff.familyName}`,
        decision.blocking.map((item) => item.message),
      );
    }
  }

  private async requireStaff(staffId: string) {
    const { facilityIds } = getTenantScope();

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, facilityId: { in: [...facilityIds] }, deletedAt: null },
      select: {
        id: true,
        organisationId: true,
        facilityId: true,
        givenName: true,
        familyName: true,
        status: true,
      },
    });

    if (!staff) throw new NotFoundException('No such member of staff, or they are not visible to you.');
    return staff;
  }

  private async requireCredential(credentialId: string) {
    const { facilityIds } = getTenantScope();

    const credential = await this.prisma.staffCredential.findFirst({
      where: { id: credentialId, facilityId: { in: [...facilityIds] } },
      select: { id: true, facilityId: true, status: true, credentialType: true },
    });

    if (!credential) throw new NotFoundException('No such credential, or it is not visible to you.');
    return credential;
  }
}

/** The database row as the pure domain engine wants it. */
function toCredential(row: {
  id: string;
  credentialType: string;
  credentialNumber: string | null;
  issuingBody: string | null;
  expiresOn: Date | null;
  status: string;
  verifiedAt: Date | null;
}): Credential {
  return {
    id: row.id,
    credentialType: row.credentialType,
    credentialNumber: row.credentialNumber,
    issuingBody: row.issuingBody,
    expiresOn: row.expiresOn,
    status: row.status as Credential['status'],
    verifiedAt: row.verifiedAt,
  };
}
