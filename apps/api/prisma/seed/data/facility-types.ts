/**
 * Facility classification. A table rather than an enum, because the tiers a
 * state health board recognises are a policy matter and change (spec §89).
 */
export const FACILITY_TYPES = [
  {
    code: 'HEALTH_POST',
    name: 'Health Post',
    description: 'Lowest tier; basic preventive and first-aid services, usually CHEW-staffed.',
  },
  {
    code: 'PHC',
    name: 'Primary Health Centre',
    description: 'Routine outpatient care, antenatal care, immunisation and basic laboratory work.',
  },
  {
    code: 'CHC',
    name: 'Community Health Centre',
    description:
      'Comprehensive primary care with maternity, laboratory and pharmacy; the tier Ikem belongs to.',
  },
  {
    code: 'COTTAGE_HOSPITAL',
    name: 'Cottage Hospital',
    description: 'Inpatient beds and minor surgical capability.',
  },
  {
    code: 'GENERAL_HOSPITAL',
    name: 'General Hospital',
    description: 'Secondary referral facility with specialist services.',
  },
  {
    code: 'SPECIALIST_HOSPITAL',
    name: 'Specialist Hospital',
    description: 'Tertiary referral facility.',
  },
] as const;
