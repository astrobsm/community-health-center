import { z } from 'zod';

import { clientSyncMetadataSchema, isoDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';

/** The electronic medical record (spec §§26-31, 43). */

// -----------------------------------------------------------------------------
// Patient
// -----------------------------------------------------------------------------

export const Sex = { MALE: 'MALE', FEMALE: 'FEMALE', OTHER: 'OTHER', UNKNOWN: 'UNKNOWN' } as const;
export type Sex = (typeof Sex)[keyof typeof Sex];

export const registerPatientSchema = z
  .object({
    id: uuidSchema.optional(),
    facilityId: uuidSchema,
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    otherNames: z.string().max(200).optional(),
    dateOfBirth: isoDateSchema.optional(),
    /**
     * Where only an age is known.
     *
     * Common where births are not registered. Recorded as an estimate so a
     * derived age never masquerades as a fact (§82).
     */
    ageYears: z.number().int().min(0).max(130).optional(),
    sex: z.nativeEnum(Sex).default('UNKNOWN'),
    phone: z.string().max(50).optional(),
    addressLine: z.string().max(500).optional(),
    occupation: z.string().max(200).optional(),
    maritalStatus: z.string().max(50).optional(),
    bloodGroup: z.string().max(10).optional(),
    /** Surfaced on every prescribing screen, not buried in a note. */
    allergySummary: z.string().max(1000).optional(),
    /**
     * Acknowledges the duplicate candidates already shown.
     *
     * Registration is never refused because a similar name exists; the clerk
     * confirms they have looked, and the pair is recorded for review.
     */
    acknowledgedDuplicates: z.boolean().default(false),
  })
  .superRefine((patient, ctx) => {
    if (!patient.dateOfBirth && patient.ageYears === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message:
          'Give a date of birth, or an age if the date is not known. Without either, nothing that depends on ' +
          'age — paediatric dosing, growth charts, screening intervals — can be computed.',
      });
    }
  });
export type RegisterPatient = z.infer<typeof registerPatientSchema>;

export const searchPatientsSchema = z.object({
  facilityId: uuidSchema,
  /** Name, MRN or phone. */
  q: z.string().min(2).max(100),
});

export const mergePatientsSchema = z.object({
  survivorId: uuidSchema,
  mergedId: uuidSchema,
  /** Mandatory: a merge moves a person's history and is not undone lightly. */
  reason: z.string().min(10).max(1000),
});
export type MergePatients = z.infer<typeof mergePatientsSchema>;

// -----------------------------------------------------------------------------
// Consent
// -----------------------------------------------------------------------------

export const ConsentPurpose = {
  TREATMENT: 'TREATMENT',
  DATA_STORAGE: 'DATA_STORAGE',
  SMS_CONTACT: 'SMS_CONTACT',
  RESEARCH_AGGREGATE: 'RESEARCH_AGGREGATE',
  PHOTOGRAPH: 'PHOTOGRAPH',
  GOVERNMENT_AGGREGATE_REPORTING: 'GOVERNMENT_AGGREGATE_REPORTING',
} as const;
export type ConsentPurpose = (typeof ConsentPurpose)[keyof typeof ConsentPurpose];

export const recordConsentSchema = z.object({
  patientId: uuidSchema,
  purpose: z.nativeEnum(ConsentPurpose),
  granted: z.boolean(),
  /** Which privacy-notice text the patient was actually shown. */
  privacyNoticeVersion: z.string().max(50).optional(),
  /** Where the patient cannot consent personally. */
  proxyName: z.string().max(200).optional(),
  proxyRelationship: z.string().max(100).optional(),
});
export type RecordConsent = z.infer<typeof recordConsentSchema>;

export const withdrawConsentSchema = z.object({
  patientId: uuidSchema,
  purpose: z.nativeEnum(ConsentPurpose),
  reason: z.string().max(1000).optional(),
});

// -----------------------------------------------------------------------------
// Encounter
// -----------------------------------------------------------------------------

export const EncounterType = {
  OPD: 'OPD',
  ANC: 'ANC',
  DELIVERY: 'DELIVERY',
  POSTNATAL: 'POSTNATAL',
  IMMUNISATION: 'IMMUNISATION',
  FAMILY_PLANNING: 'FAMILY_PLANNING',
  CHRONIC_FOLLOWUP: 'CHRONIC_FOLLOWUP',
  EMERGENCY: 'EMERGENCY',
  ADMISSION: 'ADMISSION',
  OUTREACH: 'OUTREACH',
  TELECONSULT: 'TELECONSULT',
} as const;
export type EncounterType = (typeof EncounterType)[keyof typeof EncounterType];

export const openEncounterSchema = z.object({
  id: uuidSchema.optional(),
  patientId: uuidSchema,
  encounterType: z.nativeEnum(EncounterType).default('OPD'),
  chiefComplaint: z.string().max(1000).optional(),
  departmentId: uuidSchema.optional(),
  /** Set when an encounter is written up after the fact, so it is never implied. */
  enteredRetrospectively: z.boolean().default(false),
  startedAt: isoDateTimeSchema.optional(),
  sync: clientSyncMetadataSchema.optional(),
});
export type OpenEncounter = z.infer<typeof openEncounterSchema>;

export const recordTriageSchema = z.object({
  encounterId: uuidSchema,
  systolicBp: z.number().int().min(40).max(300).optional(),
  diastolicBp: z.number().int().min(20).max(200).optional(),
  pulse: z.number().int().min(20).max(250).optional(),
  temperatureC: z.number().min(25).max(45).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  weightKg: z.number().min(0.3).max(400).optional(),
  heightCm: z.number().min(20).max(260).optional(),
  muacCm: z.number().min(5).max(60).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  triageCategory: z.enum(['RED', 'ORANGE', 'YELLOW', 'GREEN']).optional(),
  /** Acknowledges a physiologically extreme reading that is nonetheless real. */
  outOfRangeConfirmed: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
  sync: clientSyncMetadataSchema.optional(),
});
export type RecordTriage = z.infer<typeof recordTriageSchema>;

export const closeEncounterSchema = z.object({
  disposition: z.string().max(200),
  /** Required when an encounter closes with no diagnosis recorded. */
  noDiagnosisReason: z.string().max(1000).optional(),
});

// -----------------------------------------------------------------------------
// Notes, amendments and diagnoses
// -----------------------------------------------------------------------------

export const NoteType = {
  CONSULTATION: 'CONSULTATION',
  PROGRESS: 'PROGRESS',
  PROCEDURE: 'PROCEDURE',
  DISCHARGE: 'DISCHARGE',
  REFERRAL: 'REFERRAL',
} as const;
export type NoteType = (typeof NoteType)[keyof typeof NoteType];

export const clinicalNoteBodySchema = z.object({
  noteType: z.nativeEnum(NoteType).default('CONSULTATION'),
  presentingComplaint: z.string().max(4000).optional(),
  historyOfPresentingComplaint: z.string().max(8000).optional(),
  pastMedicalHistory: z.string().max(4000).optional(),
  medicationHistory: z.string().max(4000).optional(),
  allergies: z.string().max(1000).optional(),
  familySocialHistory: z.string().max(4000).optional(),
  examinationGeneral: z.string().max(4000).optional(),
  examinationSystems: z.record(z.string(), z.string().max(4000)).optional(),
  assessment: z.string().max(4000).optional(),
  differentialDiagnosis: z.string().max(4000).optional(),
  plan: z.string().max(4000).optional(),
});

export const createNoteSchema = clinicalNoteBodySchema.extend({
  id: uuidSchema.optional(),
  encounterId: uuidSchema,
  sync: clientSyncMetadataSchema.optional(),
});
export type CreateNote = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = clinicalNoteBodySchema.partial();

export const amendDiagnosisSchema = z.object({
  diagnosisType: z.nativeEnum({
    PRIMARY: 'PRIMARY',
    SECONDARY: 'SECONDARY',
    DIFFERENTIAL: 'DIFFERENTIAL',
    PROVISIONAL: 'PROVISIONAL',
    CONFIRMED: 'CONFIRMED',
    RULED_OUT: 'RULED_OUT',
  } as const),
  code: z.string().max(20).optional(),
  term: z.string().min(2).max(300).optional(),
  /**
   * Why the diagnosis changed.
   *
   * A provisional diagnosis later confirmed or ruled out is an amendment
   * chain, so the clinical reasoning is preserved — exactly what a later
   * clinician needs (doc 13 §7).
   */
  amendmentReason: z.string().min(10).max(1000),
});
export type AmendDiagnosis = z.infer<typeof amendDiagnosisSchema>;

export const amendNoteSchema = clinicalNoteBodySchema.partial().extend({
  /**
   * Why this note is being superseded.
   *
   * The whole value of an amendment to a later reader (spec §43).
   */
  amendmentReason: z.string().min(10).max(1000),
});
export type AmendNote = z.infer<typeof amendNoteSchema>;

export const DiagnosisType = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  DIFFERENTIAL: 'DIFFERENTIAL',
  PROVISIONAL: 'PROVISIONAL',
  CONFIRMED: 'CONFIRMED',
  RULED_OUT: 'RULED_OUT',
} as const;
export type DiagnosisType = (typeof DiagnosisType)[keyof typeof DiagnosisType];

export const recordDiagnosisSchema = z.object({
  id: uuidSchema.optional(),
  encounterId: uuidSchema,
  /** ICD-10, or a local synonym that resolves to one. */
  code: z.string().max(20).optional(),
  term: z.string().min(2).max(300),
  diagnosisType: z.nativeEnum(DiagnosisType).default('PROVISIONAL'),
  notes: z.string().max(2000).optional(),
  sync: clientSyncMetadataSchema.optional(),
});
export type RecordDiagnosis = z.infer<typeof recordDiagnosisSchema>;
