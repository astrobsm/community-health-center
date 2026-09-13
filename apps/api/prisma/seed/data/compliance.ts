/**
 * Compliance register (spec §83).
 *
 * IMPORTANT: these rows record WHAT must be checked and WHO the responsible
 * authority is. They deliberately assert NO legal conclusion — no row says
 * that a requirement applies, or that meeting it makes anything lawful. The
 * facility records its own status and evidence against each item, and that
 * status is a fact about documentation, not a legal opinion.
 *
 * Nothing here is a substitute for qualified legal and regulatory advice.
 */
export const COMPLIANCE_REQUIREMENTS: Array<{
  code: string;
  name: string;
  description: string;
  responsibleAuthority: string;
  renewalIntervalMonths?: number;
}> = [
  {
    code: 'FACILITY_REGISTRATION',
    name: 'Health facility registration',
    description:
      'Registration of the facility with the relevant state health authority. Record the registration reference, issue date and expiry, and attach the certificate as evidence.',
    responsibleAuthority: 'State Ministry of Health / State Primary Health Care Development Agency',
    renewalIntervalMonths: 12,
  },
  {
    code: 'PREMISES_LICENCE',
    name: 'Premises licence / operating permit',
    description: 'Permit to operate the premises as a health facility.',
    responsibleAuthority: 'State health authority or Local Government Area',
    renewalIntervalMonths: 12,
  },
  {
    code: 'PHARMACY_PREMISES',
    name: 'Pharmacy premises registration',
    description:
      'Registration required to hold and dispense medicines on the premises, together with the supervising professional of record.',
    responsibleAuthority: 'Pharmacy Council of Nigeria',
    renewalIntervalMonths: 12,
  },
  {
    code: 'LABORATORY_REGISTRATION',
    name: 'Medical laboratory registration',
    description: 'Registration of the laboratory and its supervising scientist.',
    responsibleAuthority: 'Medical Laboratory Science Council of Nigeria',
    renewalIntervalMonths: 12,
  },
  {
    code: 'PROFESSIONAL_LICENCES',
    name: 'Professional practising licences',
    description:
      'Current practising licences for every clinical staff member, tracked individually in staff credentials and summarised here.',
    responsibleAuthority: 'Respective professional regulatory councils',
    renewalIntervalMonths: 12,
  },
  {
    code: 'WASTE_MANAGEMENT',
    name: 'Healthcare waste management arrangements',
    description:
      'Documented arrangements for segregation, storage, transport and final disposal of sharps, infectious and general waste, including the disposal contractor where applicable.',
    responsibleAuthority: 'State environmental protection agency',
    renewalIntervalMonths: 12,
  },
  {
    code: 'FIRE_SAFETY',
    name: 'Fire safety inspection',
    description: 'Fire safety inspection, extinguisher servicing records and evacuation arrangements.',
    responsibleAuthority: 'State fire service',
    renewalIntervalMonths: 12,
  },
  {
    code: 'WATER_QUALITY',
    name: 'Water quality testing',
    description: 'Periodic potability testing of the facility water source, with results retained as evidence.',
    responsibleAuthority: 'State water authority or accredited laboratory',
    renewalIntervalMonths: 6,
  },
  {
    code: 'DATA_PROTECTION',
    name: 'Data protection compliance',
    description:
      'Obligations arising under applicable Nigerian data-protection law, including the processing register, privacy notice, consent records, retention schedule and breach procedure. Record the facility\'s documented position and evidence; this register does not determine what the law requires.',
    responsibleAuthority: 'Nigeria Data Protection Commission',
    renewalIntervalMonths: 12,
  },
  {
    code: 'TAX_REGISTRATION',
    name: 'Tax registration and filings',
    description: 'Tax identification and evidence of current filings and remittances, including staff deductions.',
    responsibleAuthority: 'Federal Inland Revenue Service / State Internal Revenue Service',
    renewalIntervalMonths: 12,
  },
  {
    code: 'NHIS_ACCREDITATION',
    name: 'Health insurance scheme accreditation',
    description:
      'Accreditation to provide services under national or state health insurance arrangements, where the facility participates.',
    responsibleAuthority: 'National Health Insurance Authority / State health insurance agency',
    renewalIntervalMonths: 24,
  },
  {
    code: 'RADIATION_SAFETY',
    name: 'Radiation safety authorisation',
    description: 'Authorisation and periodic inspection where the facility operates X-ray or other radiation-emitting equipment. Mark NOT_APPLICABLE where no such equipment is held.',
    responsibleAuthority: 'Nigerian Nuclear Regulatory Authority',
    renewalIntervalMonths: 12,
  },
  {
    code: 'INFECTION_PREVENTION',
    name: 'Infection prevention and control programme',
    description:
      'Documented IPC protocols, hand hygiene provision, sterilisation records and staff training evidence.',
    responsibleAuthority: 'Facility clinical governance / state health authority',
    renewalIntervalMonths: 12,
  },
  {
    code: 'COLD_CHAIN',
    name: 'Cold chain integrity',
    description:
      'Temperature monitoring records and contingency arrangements for vaccines and other cold-chain items.',
    responsibleAuthority: 'State Primary Health Care Development Agency',
    renewalIntervalMonths: 3,
  },
  {
    code: 'BUILDING_APPROVAL',
    name: 'Building and structural approval',
    description: 'Approvals for construction, alteration or change of use of the facility buildings.',
    responsibleAuthority: 'Local planning authority',
  },
  {
    code: 'PARTNERSHIP_AUTHORISATION',
    name: 'Partnership authorisation',
    description:
      'Evidence of the approvals required for the management arrangement itself — council resolution, ministry consent, or equivalent. The specific approvals required are a legal question for qualified advisers; this register records what has been obtained.',
    responsibleAuthority: 'Local Government Council / State Ministry of Health',
  },
];
