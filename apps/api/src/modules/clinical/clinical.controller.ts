import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  amendDiagnosisSchema,
  amendNoteSchema,
  closeEncounterSchema,
  createNoteSchema,
  mergePatientsSchema,
  openEncounterSchema,
  recordConsentSchema,
  recordDiagnosisSchema,
  recordTriageSchema,
  registerPatientSchema,
  updateNoteSchema,
  withdrawConsentSchema,
  type AmendNote,
  type CreateNote,
  type OpenEncounter,
  type RecordConsent,
  type RecordDiagnosis,
  type RecordTriage,
  type RegisterPatient,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { EncounterService } from './encounter.service';
import { PatientService } from './patient.service';

const duplicateCheckSchema = z.object({
  facilityId: z.string().uuid(),
  givenName: z.string().min(1).max(100),
  familyName: z.string().min(1).max(100),
  dateOfBirth: z.string().optional(),
  phone: z.string().max(50).optional(),
  sex: z.string().max(20).optional(),
});

@Controller({ path: 'patients', version: '1' })
export class PatientController {
  constructor(private readonly patients: PatientService) {}

  /**
   * Who this person might already be.
   *
   * Called before registering, so a clerk sees candidates while the patient is
   * still at the desk. It never blocks: registration proceeds regardless.
   */
  @Post('duplicate-check')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('patient.read')
  duplicateCheck(@Body(zodBody(duplicateCheckSchema)) body: z.infer<typeof duplicateCheckSchema>) {
    return this.patients.findDuplicates({
      facilityId: body.facilityId,
      candidate: {
        givenName: body.givenName,
        familyName: body.familyName,
        dateOfBirth: body.dateOfBirth,
        phones: body.phone ? [body.phone] : [],
        sex: body.sex,
      },
    });
  }

  @Post()
  @RequirePermission('patient.write')
  @AuditAction('patient.register')
  register(@Body(zodBody(registerPatientSchema)) body: RegisterPatient) {
    return this.patients.register(body);
  }

  @Get('search')
  @RequirePermission('patient.read')
  search(@Query('facilityId') facilityId: string, @Query('q') q: string) {
    return this.patients.search(facilityId, q);
  }

  @Get('duplicates')
  @RequirePermission('patient.read')
  duplicateQueue(@Query('facilityId') facilityId: string) {
    return this.patients.duplicateQueue(facilityId);
  }

  @Get(':id')
  @RequirePermission('patient.read')
  get(@Param('id') id: string) {
    return this.patients.get(id);
  }

  @Post('consents')
  @RequirePermission('patient.write')
  @AuditAction('patient.consent.record')
  recordConsent(@Body(zodBody(recordConsentSchema)) body: RecordConsent) {
    return this.patients.recordConsent(body);
  }

  /** Effective immediately: consent is computed on every read, never cached. */
  @Post('consents/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('patient.write')
  @AuditAction('patient.consent.withdraw')
  withdrawConsent(@Body(zodBody(withdrawConsentSchema)) body: z.infer<typeof withdrawConsentSchema>) {
    return this.patients.withdrawConsent(body);
  }

  /** Nothing is deleted: the merged record becomes a tombstone. */
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('patient.merge')
  @AuditAction('patient.merge')
  merge(@Body(zodBody(mergePatientsSchema)) body: z.infer<typeof mergePatientsSchema>) {
    return this.patients.merge(body);
  }
}

@Controller({ path: 'encounters', version: '1' })
export class EncounterController {
  constructor(private readonly encounters: EncounterService) {}

  /** Refused without the consents care requires. */
  @Post()
  @RequirePermission('encounter.write')
  @AuditAction('encounter.open')
  open(@Body(zodBody(openEncounterSchema)) body: OpenEncounter) {
    return this.encounters.open(body);
  }

  /** BMI is computed by the database; there is no field to type it into. */
  @Post('triage')
  @RequirePermission('encounter.write')
  @AuditAction('encounter.triage.record')
  recordTriage(@Body(zodBody(recordTriageSchema)) body: RecordTriage) {
    return this.encounters.recordTriage(body);
  }

  @Post('notes')
  @RequirePermission('clinical.write')
  @AuditAction('encounter.note.create')
  createNote(@Body(zodBody(createNoteSchema)) body: CreateNote) {
    return this.encounters.createNote(body);
  }

  /** A draft, by its author. A signed note is refused with 409. */
  @Post('notes/:id/update')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clinical.write')
  @AuditAction('encounter.note.update')
  updateNote(@Param('id') id: string, @Body(zodBody(updateNoteSchema)) body: Record<string, unknown>) {
    return this.encounters.updateNote(id, body);
  }

  @Post('notes/:id/sign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clinical.write')
  @AuditAction('encounter.note.sign')
  signNote(@Param('id') id: string) {
    return this.encounters.signNote(id);
  }

  /** A new version. The previous one stays readable, with its reason (spec §43). */
  @Post('notes/:id/amend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clinical.amend')
  @AuditAction('encounter.note.amend')
  amendNote(@Param('id') id: string, @Body(zodBody(amendNoteSchema)) body: AmendNote) {
    return this.encounters.amendNote(id, body);
  }

  @Post('diagnoses')
  @RequirePermission('clinical.write')
  @AuditAction('encounter.diagnosis.record')
  recordDiagnosis(@Body(zodBody(recordDiagnosisSchema)) body: RecordDiagnosis) {
    return this.encounters.recordDiagnosis(body);
  }

  /** A provisional diagnosis confirmed or ruled out is an amendment chain. */
  @Post('diagnoses/:id/amend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clinical.amend')
  @AuditAction('encounter.diagnosis.amend')
  amendDiagnosis(
    @Param('id') id: string,
    @Body(zodBody(amendDiagnosisSchema)) body: z.infer<typeof amendDiagnosisSchema>,
  ) {
    return this.encounters.amendDiagnosis(id, body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('encounter.write')
  @AuditAction('encounter.close')
  close(
    @Param('id') id: string,
    @Body(zodBody(closeEncounterSchema)) body: z.infer<typeof closeEncounterSchema>,
  ) {
    return this.encounters.close(id, body);
  }

  /** The whole history, with every amended version available beside the current one. */
  @Get('timeline/:patientId')
  @RequirePermission('clinical.read')
  timeline(@Param('patientId') patientId: string) {
    return this.encounters.timeline(patientId);
  }
}
