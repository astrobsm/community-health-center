import type { ServiceCategory } from '@prisma/client';

/**
 * The service catalogue: what a facility *can* offer.
 *
 * Availability is a separate fact, recorded per facility in
 * `service_offering.isAvailable`, and set by the commissioning workflow rather
 * than by hand. That separation is what makes "services restored" measurable
 * (spec §66) instead of asserted.
 *
 * Prices are NOT here. A tariff belongs to a facility and a date range
 * (`tariff_version`), because a charge raised in March must forever price at
 * March's tariff.
 */
export const SERVICES: Array<{
  code: string;
  name: string;
  category: ServiceCategory;
  description?: string;
}> = [
  // Consultation
  { code: 'CONS_GEN_NEW', name: 'General consultation — new patient', category: 'CONSULTATION' },
  { code: 'CONS_GEN_FOLLOWUP', name: 'General consultation — follow-up', category: 'CONSULTATION' },
  { code: 'CONS_CHEW', name: 'CHEW consultation', category: 'CONSULTATION' },
  { code: 'CONS_EMERGENCY', name: 'Emergency assessment', category: 'CONSULTATION' },
  { code: 'CONS_CHRONIC', name: 'Chronic disease review', category: 'CONSULTATION' },

  // Maternity
  { code: 'MAT_ANC_BOOK', name: 'Antenatal booking visit', category: 'MATERNITY' },
  { code: 'MAT_ANC_FOLLOWUP', name: 'Antenatal follow-up visit', category: 'MATERNITY' },
  { code: 'MAT_DELIVERY_NORMAL', name: 'Normal delivery', category: 'MATERNITY' },
  { code: 'MAT_DELIVERY_ASSISTED', name: 'Assisted delivery', category: 'MATERNITY' },
  { code: 'MAT_POSTNATAL', name: 'Postnatal visit', category: 'MATERNITY' },
  { code: 'MAT_FAMILY_PLANNING', name: 'Family planning consultation', category: 'PREVENTIVE' },

  // Child health and prevention
  { code: 'IMM_ROUTINE', name: 'Routine immunisation', category: 'IMMUNISATION' },
  { code: 'CHILD_GROWTH', name: 'Growth monitoring', category: 'PREVENTIVE' },
  { code: 'NUTRITION_ASSESS', name: 'Nutrition assessment', category: 'PREVENTIVE' },
  { code: 'HEALTH_EDUCATION', name: 'Health education session', category: 'PREVENTIVE' },

  // Laboratory
  { code: 'LAB_MALARIA_RDT', name: 'Malaria rapid diagnostic test', category: 'LABORATORY' },
  { code: 'LAB_MALARIA_MICRO', name: 'Malaria microscopy', category: 'LABORATORY' },
  { code: 'LAB_FBC', name: 'Full blood count', category: 'LABORATORY' },
  { code: 'LAB_PCV', name: 'Packed cell volume', category: 'LABORATORY' },
  { code: 'LAB_BLOOD_GLUCOSE', name: 'Blood glucose', category: 'LABORATORY' },
  { code: 'LAB_URINALYSIS', name: 'Urinalysis', category: 'LABORATORY' },
  { code: 'LAB_PREGNANCY', name: 'Pregnancy test', category: 'LABORATORY' },
  { code: 'LAB_HIV_SCREEN', name: 'HIV screening', category: 'LABORATORY' },
  { code: 'LAB_HEPATITIS_B', name: 'Hepatitis B surface antigen', category: 'LABORATORY' },
  { code: 'LAB_WIDAL', name: 'Widal test', category: 'LABORATORY' },
  { code: 'LAB_STOOL', name: 'Stool microscopy', category: 'LABORATORY' },
  { code: 'LAB_BLOOD_GROUP', name: 'Blood grouping', category: 'LABORATORY' },

  // Pharmacy
  { code: 'PHARM_DISPENSE', name: 'Medication dispensing', category: 'PHARMACY' },

  // Procedures
  { code: 'PROC_WOUND_DRESSING', name: 'Wound dressing', category: 'PROCEDURE' },
  { code: 'PROC_SUTURING', name: 'Suturing', category: 'PROCEDURE' },
  { code: 'PROC_INJECTION', name: 'Injection administration', category: 'PROCEDURE' },
  { code: 'PROC_IV_FLUIDS', name: 'Intravenous fluid administration', category: 'PROCEDURE' },
  { code: 'PROC_INCISION_DRAINAGE', name: 'Incision and drainage', category: 'PROCEDURE' },
  { code: 'PROC_CATHETERISATION', name: 'Urinary catheterisation', category: 'PROCEDURE' },
  { code: 'PROC_NEBULISATION', name: 'Nebulisation', category: 'PROCEDURE' },

  // Admission and observation
  { code: 'ADM_OBSERVATION', name: 'Observation bed (per day)', category: 'ADMISSION' },
  { code: 'ADM_INPATIENT', name: 'Inpatient bed (per day)', category: 'ADMISSION' },

  // Other
  { code: 'OTHER_MEDICAL_REPORT', name: 'Medical report', category: 'OTHER' },
  { code: 'OTHER_AMBULANCE', name: 'Ambulance / referral transport', category: 'OTHER' },
];
