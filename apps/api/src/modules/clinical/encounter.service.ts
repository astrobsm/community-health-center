import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AmendNote, CreateNote, OpenEncounter, RecordDiagnosis, RecordTriage } from '@chc/contracts';

import { BusinessRuleError, ConsentRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { AmendmentError, assertAmendable, canEditInPlace, resolveChain } from './domain/amendment';
import { canOpenEncounter, type ConsentPurpose, type ConsentRecord } from './domain/consent';

/**
 * Encounters, notes and the amendment chain (spec §43, doc 13 §§4-7).
 *
 * The rule this module exists to hold: a signed clinical record is never
 * modified. An amendment is a new record pointing at the previous one, which
 * stays fully readable with its author, its timestamp and the reason it was
 * superseded.
 *
 * A clinician reading a record next year needs to know what the person in
 * front of the patient actually believed at the time. A record that quietly
 * changed is worse than no record: it makes every other entry suspect.
 */
@Injectable()
export class EncounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  /**
   * Open an encounter.
   *
   * Refused without the consents care requires. A facility that records
   * treatment with no consent behind it has a problem no amount of later
   * documentation fixes (spec §84).
   */
  async open(input: OpenEncounter) {
    const { organisationId, facilityIds } = getTenantScope();

    const patient = await this.prisma.patient.findFirst({
      where: { id: input.patientId, organisationId, deletedAt: null },
      select: { id: true, facilityId: true, mrn: true, mergedIntoId: true, allergySummary: true },
    });

    if (!patient || !facilityIds.includes(patient.facilityId)) {
      throw new NotFoundException('No such patient, or they are not visible to you.');
    }

    if (patient.mergedIntoId) {
      throw new BadRequestException(
        `${patient.mrn} has been merged into another record. Open the encounter on the surviving record, ` +
          'so this episode of care joins the rest of the history.',
      );
    }

    const consents = await this.consentRecords(patient.id);
    const decision = canOpenEncounter(consents, this.now());

    if (!decision.allowed) {
      await this.audit.record({
        action: 'encounter.open',
        entityType: 'encounter',
        facilityId: patient.facilityId,
        outcome: 'DENIED',
        newValue: { patientId: patient.id, missingConsent: decision.missing },
        severity: 'WARNING',
      });

      throw new ConsentRequiredError(decision.reason ?? 'Consent has not been recorded.');
    }

    const context = tryGetContext();
    const count = await this.prisma.encounter.count({ where: { facilityId: patient.facilityId } });

    const encounter = await this.prisma.encounter.create({
      data: {
        id: input.id ?? randomUUID(),
        patientId: patient.id,
        facilityId: patient.facilityId,
        organisationId,
        departmentId: input.departmentId,
        encounterType: input.encounterType,
        reference: `ENC-${String(count + 1).padStart(7, '0')}`,
        chiefComplaint: input.chiefComplaint,
        startedAt: input.startedAt ? new Date(input.startedAt) : this.now(),
        attendingStaffId: context?.userId,
        // Never inferred from a backdated timestamp: an encounter written up
        // afterwards says so on its face.
        enteredRetrospectively: input.enteredRetrospectively,
        createdBy: context?.userId,
        deviceId: input.sync?.deviceId,
        deviceCreatedAt: input.sync?.deviceCreatedAt ? new Date(input.sync.deviceCreatedAt) : undefined,
      },
      select: {
        id: true,
        reference: true,
        encounterType: true,
        status: true,
        startedAt: true,
        enteredRetrospectively: true,
      },
    });

    await this.audit.record({
      action: 'encounter.open',
      entityType: 'encounter',
      entityId: encounter.id,
      facilityId: patient.facilityId,
      newValue: { reference: encounter.reference, patientId: patient.id, type: input.encounterType },
    });

    return {
      ...encounter,
      patient: { id: patient.id, mrn: patient.mrn },
      // Carried on the response so a prescribing screen has it without asking.
      allergySummary: patient.allergySummary,
    };
  }

  /** Vitals. BMI is computed by the database from height and weight, never typed. */
  async recordTriage(input: RecordTriage) {
    const encounter = await this.loadEncounter(input.encounterId);
    const context = tryGetContext();

    if (encounter.status !== 'OPEN') {
      throw new BadRequestException(`${encounter.reference} is ${encounter.status}; vitals belong to an open encounter.`);
    }

    const triage = await this.prisma.triage.create({
      data: {
        encounterId: encounter.id,
        organisationId: encounter.organisationId,
        facilityId: encounter.facilityId,
        systolicBp: input.systolicBp,
        diastolicBp: input.diastolicBp,
        pulse: input.pulse,
        temperatureC: input.temperatureC,
        respiratoryRate: input.respiratoryRate,
        spo2: input.spo2,
        weightKg: input.weightKg,
        heightCm: input.heightCm,
        muacCm: input.muacCm,
        painScore: input.painScore,
        triageCategory: input.triageCategory,
        outOfRangeConfirmed: input.outOfRangeConfirmed,
        notes: input.notes,
        recordedBy: context?.userId,
      },
      select: {
        id: true,
        systolicBp: true,
        diastolicBp: true,
        pulse: true,
        temperatureC: true,
        weightKg: true,
        heightCm: true,
        bmi: true,
        triageCategory: true,
        recordedAt: true,
      },
    });

    if (input.triageCategory) {
      await this.prisma.encounter.update({
        where: { id: encounter.id },
        data: { triageCategory: input.triageCategory },
      });
    }

    await this.audit.record({
      action: 'encounter.triage.record',
      entityType: 'triage',
      entityId: triage.id,
      facilityId: encounter.facilityId,
      newValue: { encounter: encounter.reference, triageCategory: input.triageCategory ?? null },
    });

    return {
      ...triage,
      temperatureC: triage.temperatureC === null ? null : Number(triage.temperatureC),
      weightKg: triage.weightKg === null ? null : Number(triage.weightKg),
      heightCm: triage.heightCm === null ? null : Number(triage.heightCm),
      bmi: triage.bmi === null ? null : Number(triage.bmi),
      bmiNote: 'Computed by the database from height and weight. There is no field to type it into.',
    };
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  async createNote(input: CreateNote) {
    const encounter = await this.loadEncounter(input.encounterId);
    const context = tryGetContext();

    const note = await this.prisma.clinicalNote.create({
      data: {
        id: input.id ?? randomUUID(),
        encounterId: encounter.id,
        organisationId: encounter.organisationId,
        facilityId: encounter.facilityId,
        noteType: input.noteType,
        presentingComplaint: input.presentingComplaint,
        historyOfPresentingComplaint: input.historyOfPresentingComplaint,
        pastMedicalHistory: input.pastMedicalHistory,
        medicationHistory: input.medicationHistory,
        allergies: input.allergies,
        familySocialHistory: input.familySocialHistory,
        examinationGeneral: input.examinationGeneral,
        examinationSystems: input.examinationSystems as never,
        assessment: input.assessment,
        differentialDiagnosis: input.differentialDiagnosis,
        plan: input.plan,
        status: 'DRAFT',
        authorStaffId: context?.userId,
        createdBy: context?.userId,
        deviceId: input.sync?.deviceId,
        deviceCreatedAt: input.sync?.deviceCreatedAt ? new Date(input.sync.deviceCreatedAt) : undefined,
      },
      select: { id: true, noteType: true, status: true, createdAt: true },
    });

    // An allergy recorded in a note is promoted to the patient, because
    // burying it inside a note from 2024 is a safety failure (doc 13 §6).
    if (input.allergies && input.allergies.trim().length > 0) {
      await this.promoteAllergy(encounter.patientId, input.allergies.trim(), encounter.facilityId);
    }

    await this.audit.record({
      action: 'encounter.note.create',
      entityType: 'clinical_note',
      entityId: note.id,
      facilityId: encounter.facilityId,
      newValue: { encounter: encounter.reference, noteType: input.noteType, status: 'DRAFT' },
    });

    return { ...note, note: 'A draft. Edit it freely until you sign it; after that, changes are amendments.' };
  }

  /** A draft may be edited by its author. A signed note may not be edited at all. */
  async updateNote(noteId: string, input: Partial<Record<string, unknown>>) {
    const note = await this.loadNote(noteId);
    const context = tryGetContext();

    const decision = canEditInPlace(
      {
        id: note.id,
        status: note.status,
        authorStaffId: note.authorStaffId,
        amendsId: note.amendsId,
        amendmentReason: note.amendmentReason,
        signedAt: note.signedAt,
        createdAt: note.createdAt,
      },
      context?.userId ?? null,
    );

    if (!decision.allowed) {
      await this.audit.record({
        action: 'encounter.note.update',
        entityType: 'clinical_note',
        entityId: note.id,
        facilityId: note.facilityId,
        outcome: 'DENIED',
        newValue: { status: note.status },
        severity: 'WARNING',
      });

      throw new BusinessRuleError(
        'clinical-record-immutable',
        'A signed note cannot be changed',
        decision.reason ?? 'This note cannot be edited.',
        409,
      );
    }

    const updated = await this.prisma.clinicalNote.update({
      where: { id: note.id },
      data: input as never,
      select: { id: true, status: true, updatedAt: true },
    });

    await this.audit.record({
      action: 'encounter.note.update',
      entityType: 'clinical_note',
      entityId: note.id,
      facilityId: note.facilityId,
      newValue: { fields: Object.keys(input) },
    });

    return updated;
  }

  /** Signing makes a note immutable. */
  async signNote(noteId: string) {
    const note = await this.loadNote(noteId);
    const context = tryGetContext();

    if (note.status !== 'DRAFT') {
      throw new BadRequestException(`This note is ${note.status} and has already been signed.`);
    }

    if (note.authorStaffId && context?.userId && note.authorStaffId !== context.userId) {
      throw new BusinessRuleError(
        'segregation-of-duties',
        'Only the author may sign',
        'Signing another clinician note would attribute their clinical judgement to you.',
        403,
      );
    }

    const signedAt = this.now();

    const signed = await this.prisma.clinicalNote.update({
      where: { id: note.id },
      data: { status: 'SIGNED', signedAt },
      select: { id: true, status: true, signedAt: true },
    });

    await this.audit.record({
      action: 'encounter.note.sign',
      entityType: 'clinical_note',
      entityId: note.id,
      facilityId: note.facilityId,
      oldValue: { status: 'DRAFT' },
      newValue: { status: 'SIGNED' },
      severity: 'NOTICE',
    });

    return { ...signed, note: 'This note is now immutable. Corrections are amendments, and the original stays readable.' };
  }

  /**
   * Amend a signed note.
   *
   * Creates a new record carrying the previous content forward with the
   * changes applied, and marks the previous one AMENDED. Nothing is lost.
   */
  async amendNote(noteId: string, input: AmendNote) {
    const previous = await this.loadNote(noteId);
    const context = tryGetContext();

    try {
      assertAmendable(
        {
          id: previous.id,
          status: previous.status,
          authorStaffId: previous.authorStaffId,
          amendsId: previous.amendsId,
          amendmentReason: previous.amendmentReason,
          signedAt: previous.signedAt,
          createdAt: previous.createdAt,
        },
        input.amendmentReason,
      );
    } catch (error) {
      if (error instanceof AmendmentError) throw new BadRequestException(error.message);
      throw error;
    }

    const { amendmentReason, ...changes } = input;
    const now = this.now();

    const amendment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicalNote.create({
        data: {
          encounterId: previous.encounterId,
          organisationId: previous.organisationId,
          facilityId: previous.facilityId,
          noteType: previous.noteType,
          // Carried forward, so correcting one sentence does not mean
          // retyping a consultation or losing a field left blank.
          presentingComplaint: changes.presentingComplaint ?? previous.presentingComplaint,
          historyOfPresentingComplaint:
            changes.historyOfPresentingComplaint ?? previous.historyOfPresentingComplaint,
          pastMedicalHistory: changes.pastMedicalHistory ?? previous.pastMedicalHistory,
          medicationHistory: changes.medicationHistory ?? previous.medicationHistory,
          allergies: changes.allergies ?? previous.allergies,
          familySocialHistory: changes.familySocialHistory ?? previous.familySocialHistory,
          examinationGeneral: changes.examinationGeneral ?? previous.examinationGeneral,
          examinationSystems: (changes.examinationSystems ?? previous.examinationSystems) as never,
          assessment: changes.assessment ?? previous.assessment,
          differentialDiagnosis: changes.differentialDiagnosis ?? previous.differentialDiagnosis,
          plan: changes.plan ?? previous.plan,
          status: 'SIGNED',
          authorStaffId: context?.userId,
          signedAt: now,
          amendsId: previous.id,
          amendmentReason,
          createdBy: context?.userId,
        },
        select: { id: true, status: true, signedAt: true, amendsId: true, amendmentReason: true },
      });

      await tx.clinicalNote.update({ where: { id: previous.id }, data: { status: 'AMENDED' } });

      return created;
    });

    await this.audit.record({
      action: 'encounter.note.amend',
      entityType: 'clinical_note',
      entityId: amendment.id,
      facilityId: previous.facilityId,
      oldValue: { noteId: previous.id, status: 'SIGNED' },
      newValue: { noteId: amendment.id, supersedes: previous.id },
      reason: amendmentReason,
      severity: 'CRITICAL',
    });

    return {
      ...amendment,
      supersedes: previous.id,
      note: 'The previous version is retained in full and remains readable, with its author and this reason.',
    };
  }

  async recordDiagnosis(input: RecordDiagnosis) {
    const encounter = await this.loadEncounter(input.encounterId);
    const context = tryGetContext();

    const diagnosis = await this.prisma.diagnosis.create({
      data: {
        id: input.id ?? randomUUID(),
        encounterId: encounter.id,
        organisationId: encounter.organisationId,
        facilityId: encounter.facilityId,
        icd10Code: input.code,
        description: input.term,
        localTerm: input.notes ? `${input.term} — ${input.notes}` : input.term,
        diagnosisType: input.diagnosisType,
        diagnosedBy: context?.userId,
        createdBy: context?.userId,
      },
      select: { id: true, icd10Code: true, description: true, diagnosisType: true, diagnosedAt: true },
    });

    await this.audit.record({
      action: 'encounter.diagnosis.record',
      entityType: 'diagnosis',
      entityId: diagnosis.id,
      facilityId: encounter.facilityId,
      newValue: { encounter: encounter.reference, term: input.term, type: input.diagnosisType },
    });

    return diagnosis;
  }

  /**
   * Amend a diagnosis.
   *
   * A provisional diagnosis later confirmed or ruled out is an amendment
   * chain, not an overwrite: the clinical reasoning at the time is exactly
   * what a later clinician needs to see (doc 13 §7).
   */
  async amendDiagnosis(
    diagnosisId: string,
    input: { diagnosisType: string; code?: string; term?: string; amendmentReason: string },
  ) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const previous = await this.prisma.diagnosis.findFirst({
      where: { id: diagnosisId, organisationId },
      select: {
        id: true,
        encounterId: true,
        organisationId: true,
        facilityId: true,
        icd10Code: true,
        localTerm: true,
        description: true,
        diagnosisType: true,
        amendsId: true,
      },
    });

    if (!previous || !facilityIds.includes(previous.facilityId)) {
      throw new NotFoundException('No such diagnosis, or it is not visible to you.');
    }

    const superseded = await this.prisma.diagnosis.findFirst({
      where: { amendsId: previous.id },
      select: { id: true },
    });

    if (superseded) {
      throw new BadRequestException(
        'This diagnosis has already been superseded. Amend the current version, so the chain stays a single line.',
      );
    }

    const amendment = await this.prisma.diagnosis.create({
      data: {
        encounterId: previous.encounterId,
        organisationId: previous.organisationId,
        facilityId: previous.facilityId,
        icd10Code: input.code ?? previous.icd10Code,
        localTerm: input.term ?? previous.localTerm,
        description: input.term ?? previous.description,
        diagnosisType: input.diagnosisType as never,
        amendsId: previous.id,
        amendmentReason: input.amendmentReason,
        diagnosedBy: context?.userId,
        createdBy: context?.userId,
      },
      select: { id: true, description: true, diagnosisType: true, amendsId: true, amendmentReason: true },
    });

    await this.audit.record({
      action: 'encounter.diagnosis.amend',
      entityType: 'diagnosis',
      entityId: amendment.id,
      facilityId: previous.facilityId,
      oldValue: { diagnosisType: previous.diagnosisType, description: previous.description },
      newValue: { diagnosisType: input.diagnosisType, supersedes: previous.id },
      reason: input.amendmentReason,
      severity: 'NOTICE',
    });

    return {
      ...amendment,
      supersedes: previous.id,
      note: 'The earlier diagnosis is retained, so the reasoning at the time stays visible.',
    };
  }

  async close(encounterId: string, input: { disposition: string; noDiagnosisReason?: string }) {
    const encounter = await this.loadEncounter(encounterId);
    const context = tryGetContext();

    if (encounter.status !== 'OPEN') {
      throw new BadRequestException(`${encounter.reference} is already ${encounter.status}.`);
    }

    const diagnoses = await this.prisma.diagnosis.count({ where: { encounterId: encounter.id } });

    // An encounter that closes with no diagnosis is legitimate — a dressing
    // change, a blood-pressure check — but it must say so, or the facility's
    // diagnosis rate silently misreports what happened (§82).
    if (diagnoses === 0 && (input.noDiagnosisReason ?? '').trim().length < 5) {
      throw new BadRequestException(
        'This encounter has no diagnosis recorded. Record one, or state why there is none — otherwise the ' +
          'facility figures will show a consultation that apparently found nothing.',
      );
    }

    const drafts = await this.prisma.clinicalNote.count({
      where: { encounterId: encounter.id, status: 'DRAFT' },
    });

    const closed = await this.prisma.encounter.update({
      where: { id: encounter.id },
      data: {
        status: 'CLOSED',
        endedAt: this.now(),
        disposition: input.disposition,
        noDiagnosisReason: diagnoses === 0 ? input.noDiagnosisReason : undefined,
        updatedBy: context?.userId,
      },
      select: { id: true, reference: true, status: true, endedAt: true, disposition: true },
    });

    await this.audit.record({
      action: 'encounter.close',
      entityType: 'encounter',
      entityId: encounter.id,
      facilityId: encounter.facilityId,
      newValue: { disposition: input.disposition, diagnoses, unsignedNotes: drafts },
      reason: diagnoses === 0 ? input.noDiagnosisReason : undefined,
    });

    return {
      ...closed,
      diagnoses,
      ...(drafts > 0
        ? {
            warning:
              `${drafts} note(s) on this encounter are still drafts. An unsigned note is not part of the ` +
              'record a later clinician will rely on.',
          }
        : {}),
    };
  }

  /**
   * The patient's history, in one chronological view.
   *
   * Amendment chains are resolved so the current version is shown with every
   * prior version available beside it — never silently replaced, never hidden.
   */
  async timeline(patientId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organisationId, deletedAt: null },
      select: { id: true, facilityId: true, mrn: true, givenName: true, familyName: true, allergySummary: true },
    });

    if (!patient || !facilityIds.includes(patient.facilityId)) {
      throw new NotFoundException('No such patient, or they are not visible to you.');
    }

    const encounters = await this.prisma.encounter.findMany({
      where: { patientId: patient.id },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        reference: true,
        encounterType: true,
        status: true,
        startedAt: true,
        endedAt: true,
        chiefComplaint: true,
        disposition: true,
        triageCategory: true,
        enteredRetrospectively: true,
        noDiagnosisReason: true,
        diagnoses: {
          orderBy: { diagnosedAt: 'asc' },
          select: {
            id: true,
            icd10Code: true,
            description: true,
            diagnosisType: true,
            amendsId: true,
            amendmentReason: true,
            diagnosedAt: true,
            diagnosedBy: true,
          },
        },
        triages: {
          orderBy: { recordedAt: 'asc' },
          select: { id: true, systolicBp: true, diastolicBp: true, pulse: true, temperatureC: true, bmi: true, recordedAt: true },
        },
        clinicalNotes: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            noteType: true,
            status: true,
            authorStaffId: true,
            signedAt: true,
            amendsId: true,
            amendmentReason: true,
            createdAt: true,
            assessment: true,
            plan: true,
            presentingComplaint: true,
          },
        },
      },
    });

    return {
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        name: `${patient.givenName} ${patient.familyName}`,
        allergySummary: patient.allergySummary,
      },
      encounters: encounters.map((encounter) => {
        const chains = resolveChain(
          encounter.clinicalNotes.map((note) => ({
            ...note,
            authorStaffId: note.authorStaffId,
            amendsId: note.amendsId,
            amendmentReason: note.amendmentReason,
            signedAt: note.signedAt,
            createdAt: note.createdAt,
            status: note.status,
          })),
        );

        return {
          ...encounter,
          clinicalNotes: undefined,
          notes: chains.map((chain) => ({
            current: chain.current,
            wasAmended: chain.wasAmended,
            amendmentCount: chain.amendmentCount,
            // Every prior version, in full, beside the current one.
            priorVersions: chain.history,
          })),
          triages: encounter.triages.map((triage) => ({
            ...triage,
            temperatureC: triage.temperatureC === null ? null : Number(triage.temperatureC),
            bmi: triage.bmi === null ? null : Number(triage.bmi),
          })),
        };
      }),
      note:
        'Encounters most recent first. A note that has been amended shows the version in force, with every ' +
        'prior version and the reason it was superseded.',
    };
  }

  // ---------------------------------------------------------------------------

  private async promoteAllergy(patientId: string, allergy: string, facilityId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { allergySummary: true },
    });

    const existing = patient?.allergySummary ?? '';
    if (existing.toLowerCase().includes(allergy.toLowerCase())) return;

    await this.prisma.patient.update({
      where: { id: patientId },
      data: { allergySummary: existing ? `${existing}; ${allergy}` : allergy },
    });

    await this.audit.record({
      action: 'patient.allergy.promote',
      entityType: 'patient',
      entityId: patientId,
      facilityId,
      newValue: { allergy },
      severity: 'NOTICE',
    });
  }

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

  private async loadEncounter(encounterId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const encounter = await this.prisma.encounter.findFirst({
      where: { id: encounterId, organisationId },
      select: {
        id: true,
        patientId: true,
        facilityId: true,
        organisationId: true,
        reference: true,
        status: true,
        encounterType: true,
      },
    });

    if (!encounter || !facilityIds.includes(encounter.facilityId)) {
      throw new NotFoundException('No such encounter, or it is not visible to you.');
    }

    return encounter;
  }

  private async loadNote(noteId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const note = await this.prisma.clinicalNote.findFirst({
      where: { id: noteId, organisationId },
      select: {
        id: true,
        encounterId: true,
        organisationId: true,
        facilityId: true,
        noteType: true,
        status: true,
        authorStaffId: true,
        signedAt: true,
        amendsId: true,
        amendmentReason: true,
        createdAt: true,
        presentingComplaint: true,
        historyOfPresentingComplaint: true,
        pastMedicalHistory: true,
        medicationHistory: true,
        allergies: true,
        familySocialHistory: true,
        examinationGeneral: true,
        examinationSystems: true,
        assessment: true,
        differentialDiagnosis: true,
        plan: true,
      },
    });

    if (!note || !facilityIds.includes(note.facilityId)) {
      throw new NotFoundException('No such note, or it is not visible to you.');
    }

    return note;
  }
}
