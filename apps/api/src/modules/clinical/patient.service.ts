import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MergePatients, RecordConsent, RegisterPatient } from '@chc/contracts';

import { ConsentRequiredError, ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';

import {
  assertWithdrawable,
  canOpenEncounter,
  consentSummary,
  ConsentError,
  effectiveConsent,
  type ConsentPurpose,
  type ConsentRecord,
} from './domain/consent';
import {
  DEFAULT_MATCH_WEIGHTS,
  formatMrn,
  mrnPrefix,
  scoreDuplicate,
  type MatchWeights,
  type MatchablePatient,
} from './domain/identity';

/**
 * Patient identity and consent (doc 13 §§2-3).
 *
 * Registration never refuses a patient because somebody similar exists. A
 * close match is surfaced, the clerk decides, and the pair is recorded for
 * review — turning a patient away at the desk is not duplicate prevention, it
 * is a denial of care.
 *
 * Consent is computed from its records on every read, so a withdrawal takes
 * effect at once rather than at the next cache expiry.
 */
@Injectable()
export class PatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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

  /**
   * Who this person might already be.
   *
   * Called before registering, so the clerk sees candidates while the patient
   * is still at the desk and can simply ask.
   */
  async findDuplicates(input: { facilityId: string; candidate: MatchablePatient }) {
    this.assertFacilityVisible(input.facilityId);

    const weights = await this.matchWeights(input.facilityId);

    // Narrowed by family-name initial and date of birth before scoring, so a
    // busy facility does not score every patient it has ever seen on every
    // registration.
    const pool = await this.prisma.patient.findMany({
      where: {
        facilityId: input.facilityId,
        deletedAt: null,
        mergedIntoId: null,
        OR: [
          { familyName: { startsWith: input.candidate.familyName.slice(0, 2), mode: 'insensitive' } },
          { givenName: { startsWith: input.candidate.givenName.slice(0, 2), mode: 'insensitive' } },
          ...(input.candidate.dateOfBirth ? [{ dateOfBirth: new Date(input.candidate.dateOfBirth) }] : []),
        ],
      },
      take: 200,
      select: {
        id: true,
        mrn: true,
        givenName: true,
        familyName: true,
        dateOfBirth: true,
        sex: true,
        identifiers: { where: { identifierType: 'PHONE' }, select: { value: true } },
      },
    });

    return pool
      .map((existing) => ({
        patient: existing,
        match: scoreDuplicate(
          input.candidate,
          {
            givenName: existing.givenName,
            familyName: existing.familyName,
            dateOfBirth: existing.dateOfBirth?.toISOString().slice(0, 10) ?? null,
            phones: existing.identifiers.map((identifier) => identifier.value),
            sex: existing.sex,
          },
          weights,
        ),
      }))
      .filter((row) => row.match.isCandidate)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 10)
      .map((row) => ({
        patientId: row.patient.id,
        mrn: row.patient.mrn,
        name: `${row.patient.givenName} ${row.patient.familyName}`,
        dateOfBirth: row.patient.dateOfBirth,
        score: row.match.score,
        reasons: row.match.reasons,
      }));
  }

  async register(input: RegisterPatient) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const facility = await this.prisma.facility.findUnique({
      where: { id: input.facilityId },
      select: { id: true, code: true },
    });

    if (!facility) throw new NotFoundException('No such facility.');

    const candidate: MatchablePatient = {
      givenName: input.givenName,
      familyName: input.familyName,
      dateOfBirth: input.dateOfBirth ?? null,
      phones: input.phone ? [input.phone] : [],
      sex: input.sex,
    };

    const duplicates = await this.findDuplicates({ facilityId: input.facilityId, candidate });
    const context = tryGetContext();

    // An age-derived date of birth is marked as an estimate, so nothing
    // downstream mistakes it for a recorded fact (§82).
    const estimated = !input.dateOfBirth && input.ageYears !== undefined;
    const dateOfBirth = input.dateOfBirth
      ? new Date(input.dateOfBirth)
      : input.ageYears !== undefined
        ? new Date(Date.UTC(this.now().getUTCFullYear() - input.ageYears, 0, 1))
        : undefined;

    const sequence = (await this.prisma.patient.count({ where: { facilityId: input.facilityId } })) + 1;
    const mrn = formatMrn(mrnPrefix(facility.code), sequence);

    const patient = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: {
          id: input.id ?? randomUUID(),
          facilityId: input.facilityId,
          organisationId,
          mrn,
          givenName: input.givenName,
          familyName: input.familyName,
          otherNames: input.otherNames,
          dateOfBirth,
          dateOfBirthEstimated: estimated,
          sex: input.sex,
          addressLine: input.addressLine,
          occupation: input.occupation,
          maritalStatus: input.maritalStatus,
          bloodGroup: input.bloodGroup,
          allergySummary: input.allergySummary,
          createdBy: context?.userId,
        },
        select: {
          id: true,
          mrn: true,
          givenName: true,
          familyName: true,
          dateOfBirth: true,
          dateOfBirthEstimated: true,
          sex: true,
          allergySummary: true,
        },
      });

      await tx.patientIdentifier.create({
        data: {
          patientId: created.id,
          organisationId,
          facilityId: input.facilityId,
          identifierType: 'FACILITY_MRN',
          value: mrn,
          isPrimary: true,
        },
      });

      if (input.phone) {
        await tx.patientIdentifier.create({
          data: {
            patientId: created.id,
            organisationId,
            facilityId: input.facilityId,
            identifierType: 'PHONE',
            value: input.phone,
          },
        });
      }

      // Recorded for review, not used to refuse. Care proceeds.
      for (const duplicate of duplicates) {
        const [a, b] = [created.id, duplicate.patientId].sort();

        await tx.duplicateCandidate.upsert({
          where: { patientAId_patientBId: { patientAId: a, patientBId: b } },
          create: {
            organisationId,
            facilityId: input.facilityId,
            patientAId: a,
            patientBId: b,
            matchScore: duplicate.score,
            matchReasons: duplicate.reasons as never,
          },
          update: {},
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'patient.register',
      entityType: 'patient',
      entityId: patient.id,
      facilityId: input.facilityId,
      newValue: { mrn, duplicateCandidates: duplicates.length, dateOfBirthEstimated: estimated },
    });

    return {
      ...patient,
      duplicateCandidates: duplicates,
      ...(duplicates.length > 0
        ? {
            note:
              `${duplicates.length} existing record(s) resemble this one and have been flagged for review. ` +
              'Registration was not blocked; if this is the same person, merge the records.',
          }
        : {}),
      ...(estimated
        ? { dateOfBirthNote: 'Derived from the age given. Recorded as an estimate, not as a recorded date.' }
        : {}),
    };
  }

  async search(facilityId: string, query: string) {
    this.assertFacilityVisible(facilityId);

    const term = query.trim();

    const patients = await this.prisma.patient.findMany({
      where: {
        facilityId,
        deletedAt: null,
        OR: [
          { mrn: { contains: term, mode: 'insensitive' } },
          { givenName: { contains: term, mode: 'insensitive' } },
          { familyName: { contains: term, mode: 'insensitive' } },
          { identifiers: { some: { value: { contains: term } } } },
        ],
      },
      take: 25,
      orderBy: { familyName: 'asc' },
      select: {
        id: true,
        mrn: true,
        givenName: true,
        familyName: true,
        dateOfBirth: true,
        dateOfBirthEstimated: true,
        sex: true,
        status: true,
        allergySummary: true,
        mergedIntoId: true,
      },
    });

    return patients.map((patient) => ({
      ...patient,
      // A merged record still answers to its old MRN — somebody holding the
      // old card must be led to the surviving record, not to a dead end.
      merged: patient.mergedIntoId !== null,
    }));
  }

  async get(patientId: string) {
    const patient = await this.load(patientId);
    const consents = await this.consentRecords(patientId);
    const now = this.now();

    return {
      ...patient,
      age: describeAge(patient.dateOfBirth, patient.dateOfBirthEstimated, now),
      consents: consentSummary(consents, now),
      careConsent: canOpenEncounter(consents, now),
      // Repeated at the top level because every prescribing screen must show
      // it without having to go looking (doc 13 §6).
      allergySummary: patient.allergySummary,
    };
  }

  // ---------------------------------------------------------------------------
  // Consent
  // ---------------------------------------------------------------------------

  async recordConsent(input: RecordConsent) {
    const { organisationId } = getTenantScope();
    const patient = await this.load(input.patientId);
    const context = tryGetContext();

    const consent = await this.prisma.patientConsent.create({
      data: {
        patientId: patient.id,
        organisationId,
        facilityId: patient.facilityId,
        purpose: input.purpose,
        granted: input.granted,
        grantedAt: this.now(),
        privacyNoticeVersion: input.privacyNoticeVersion,
        capturedBy: context?.userId,
        proxyName: input.proxyName,
        proxyRelationship: input.proxyRelationship,
      },
      select: { id: true, purpose: true, granted: true, grantedAt: true, privacyNoticeVersion: true },
    });

    await this.audit.record({
      action: 'patient.consent.record',
      entityType: 'patient_consent',
      entityId: consent.id,
      facilityId: patient.facilityId,
      newValue: {
        purpose: input.purpose,
        granted: input.granted,
        byProxy: Boolean(input.proxyName),
        privacyNoticeVersion: input.privacyNoticeVersion ?? null,
      },
      severity: 'NOTICE',
    });

    return consent;
  }

  /**
   * Withdraw a consent.
   *
   * Effective immediately: consent is computed from these records on every
   * read, so there is no window in which something withdrawn still permits
   * anything.
   */
  async withdrawConsent(input: { patientId: string; purpose: ConsentPurpose; reason?: string }) {
    const patient = await this.load(input.patientId);
    const records = await this.consentRecords(patient.id);
    const now = this.now();
    const current = effectiveConsent(records, input.purpose, now);

    try {
      assertWithdrawable(input.purpose, current.state);
    } catch (error) {
      if (error instanceof ConsentError) {
        throw error.code === 'not-withdrawable'
          ? new ConsentRequiredError(error.message)
          : new BadRequestException(error.message);
      }
      throw error;
    }

    const latest = await this.prisma.patientConsent.findFirst({
      where: { patientId: patient.id, purpose: input.purpose, withdrawnAt: null, granted: true },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });

    if (!latest) throw new BadRequestException('There is no granted consent of that purpose to withdraw.');

    await this.prisma.patientConsent.update({
      where: { id: latest.id },
      data: { withdrawnAt: now, withdrawalReason: input.reason },
    });

    await this.audit.record({
      action: 'patient.consent.withdraw',
      entityType: 'patient_consent',
      entityId: latest.id,
      facilityId: patient.facilityId,
      oldValue: { purpose: input.purpose, state: 'GRANTED' },
      newValue: { purpose: input.purpose, state: 'WITHDRAWN' },
      reason: input.reason,
      severity: 'NOTICE',
    });

    const after = effectiveConsent(await this.consentRecords(patient.id), input.purpose, now);

    return {
      purpose: input.purpose,
      state: after.state,
      withdrawnAt: now,
      note: 'Effective immediately. Nothing that depends on this consent will proceed from now on.',
    };
  }

  /** Whether an action depending on a consent may proceed, computed now. */
  async permits(patientId: string, purpose: ConsentPurpose): Promise<boolean> {
    const records = await this.consentRecords(patientId);
    return effectiveConsent(records, purpose, this.now()).state === 'GRANTED';
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Merge one record into another.
   *
   * Nothing is deleted. The merged record becomes a tombstone pointing at the
   * survivor, so somebody presenting the old card is still found, and the
   * history moves rather than disappearing.
   */
  async merge(input: MergePatients) {
    const survivor = await this.load(input.survivorId);
    const merged = await this.load(input.mergedId);
    const context = tryGetContext();

    if (survivor.id === merged.id) {
      throw new BadRequestException('A record cannot be merged into itself.');
    }

    if (merged.mergedIntoId) {
      throw new BadRequestException(
        `${merged.mrn} has already been merged. Merge into the surviving record instead.`,
      );
    }

    if ((input.reason ?? '').trim().length < 10) {
      throw new ReasonRequiredError('Merging two patient records');
    }

    const moved = await this.prisma.$transaction(async (tx) => {
      const encounters = await tx.encounter.updateMany({
        where: { patientId: merged.id },
        data: { patientId: survivor.id },
      });

      await tx.patientIdentifier.updateMany({
        where: { patientId: merged.id, identifierType: { not: 'FACILITY_MRN' } },
        data: { patientId: survivor.id },
      });

      // The merged MRN stays on the tombstone so the old card still resolves.
      await tx.patient.update({
        where: { id: merged.id },
        data: { mergedIntoId: survivor.id, status: 'MERGED', updatedBy: context?.userId },
      });

      // Any allergy known only to the merged record must travel: losing it in
      // a merge is precisely the safety failure the patient-level flag exists
      // to prevent.
      if (merged.allergySummary && merged.allergySummary !== survivor.allergySummary) {
        await tx.patient.update({
          where: { id: survivor.id },
          data: {
            allergySummary: [survivor.allergySummary, merged.allergySummary].filter(Boolean).join('; '),
            updatedBy: context?.userId,
          },
        });
      }

      await tx.duplicateCandidate.updateMany({
        where: {
          OR: [
            { patientAId: merged.id, patientBId: survivor.id },
            { patientAId: survivor.id, patientBId: merged.id },
          ],
        },
        data: { reviewedBy: context?.userId, reviewedAt: this.now(), outcome: 'MERGED' },
      });

      return encounters.count;
    });

    await this.audit.record({
      action: 'patient.merge',
      entityType: 'patient',
      entityId: merged.id,
      facilityId: merged.facilityId,
      oldValue: { mrn: merged.mrn, status: merged.status },
      newValue: { mergedInto: survivor.mrn, encountersMoved: moved },
      reason: input.reason,
      severity: 'CRITICAL',
    });

    return {
      survivor: { id: survivor.id, mrn: survivor.mrn },
      merged: { id: merged.id, mrn: merged.mrn },
      encountersMoved: moved,
      note:
        `${merged.mrn} is now a tombstone pointing at ${survivor.mrn}. Nothing was deleted, and the old ` +
        'card still finds the surviving record.',
    };
  }

  async duplicateQueue(facilityId: string) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(facilityId);

    const rows = await this.prisma.duplicateCandidate.findMany({
      where: { facilityId, organisationId, reviewedAt: null },
      orderBy: { matchScore: 'desc' },
      take: 100,
      select: { id: true, patientAId: true, patientBId: true, matchScore: true, matchReasons: true, createdAt: true },
    });

    const ids = [...new Set(rows.flatMap((row) => [row.patientAId, row.patientBId]))];

    const patients = await this.prisma.patient.findMany({
      where: { id: { in: ids } },
      select: { id: true, mrn: true, givenName: true, familyName: true, dateOfBirth: true },
    });

    const byId = new Map(patients.map((patient) => [patient.id, patient]));

    return rows.map((row) => ({
      id: row.id,
      score: Number(row.matchScore),
      reasons: row.matchReasons,
      flaggedAt: row.createdAt,
      a: byId.get(row.patientAId) ?? null,
      b: byId.get(row.patientBId) ?? null,
    }));
  }

  // ---------------------------------------------------------------------------

  private async consentRecords(patientId: string): Promise<ConsentRecord[]> {
    const rows = await this.prisma.patientConsent.findMany({
      where: { patientId },
      select: { purpose: true, granted: true, grantedAt: true, withdrawnAt: true, privacyNoticeVersion: true },
    });

    return rows.map((row) => ({
      purpose: row.purpose as ConsentPurpose,
      granted: row.granted,
      grantedAt: row.grantedAt,
      withdrawnAt: row.withdrawnAt,
      privacyNoticeVersion: row.privacyNoticeVersion,
    }));
  }

  private async matchWeights(facilityId: string): Promise<MatchWeights> {
    return this.config.json<MatchWeights>('patient.duplicateWeights', DEFAULT_MATCH_WEIGHTS, facilityId);
  }

  private async load(patientId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organisationId, deletedAt: null },
      select: {
        id: true,
        facilityId: true,
        mrn: true,
        givenName: true,
        familyName: true,
        otherNames: true,
        dateOfBirth: true,
        dateOfBirthEstimated: true,
        sex: true,
        status: true,
        allergySummary: true,
        bloodGroup: true,
        addressLine: true,
        mergedIntoId: true,
        createdAt: true,
      },
    });

    if (!patient || !facilityIds.includes(patient.facilityId)) {
      throw new NotFoundException('No such patient, or they are not visible to you.');
    }

    return patient;
  }
}

/**
 * Age, with its basis stated.
 *
 * An age derived from an estimated date of birth is itself an estimate, and
 * paediatric dosing depends on knowing which it is.
 */
function describeAge(
  dateOfBirth: Date | null,
  estimated: boolean,
  now: Date,
): { years: number; months: number; basis: 'RECORDED' | 'ESTIMATED' } | null {
  if (!dateOfBirth) return null;

  const months =
    (now.getUTCFullYear() - dateOfBirth.getUTCFullYear()) * 12 + (now.getUTCMonth() - dateOfBirth.getUTCMonth());

  const adjusted = now.getUTCDate() < dateOfBirth.getUTCDate() ? months - 1 : months;

  return {
    years: Math.floor(adjusted / 12),
    months: adjusted % 12,
    basis: estimated ? 'ESTIMATED' : 'RECORDED',
  };
}
