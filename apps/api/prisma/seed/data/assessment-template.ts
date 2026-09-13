import type { ResponseType } from '@prisma/client';

/**
 * The field assessment instrument (spec §15).
 *
 * Seventeen sections, captured offline on a phone while standing in the
 * building being assessed. Every item supports an answer, a score, a note,
 * evidence, verification, priority, estimated cost and a recommendation —
 * those live on `assessment_response` and `assessment_finding`, so they are
 * not repeated per item here.
 *
 * Design notes that matter in the field:
 *
 *  - Questions ask what the assessor can OBSERVE, not what they can conclude.
 *    "Is the roof sound?" invites an opinion; "Is there visible water ingress
 *    in this room?" can be photographed and later verified.
 *  - `evidenceRequired` is set wherever a claim would otherwise rest on
 *    assertion alone. These are the items that become the before/after pairs
 *    in a government report.
 *  - Counts are NUMBER, not SCALE, wherever a real count exists. A scale is a
 *    judgement; a count is a fact, and the two must not be blurred.
 *  - Section weights feed the facility condition index (spec §17) and are
 *    configuration, not code — an organisation may reweight them.
 */

interface TemplateItem {
  code: string;
  question: string;
  helpText?: string;
  responseType: ResponseType;
  options?: { choices: string[] } | { min: number; max: number; labels?: Record<string, string> };
  unit?: string;
  weight?: number;
  isRequired?: boolean;
  evidenceRequired?: boolean;
}

interface TemplateSection {
  code: string;
  name: string;
  description: string;
  weight: number;
  items: TemplateItem[];
}

const CONDITION_SCALE = {
  min: 1,
  max: 5,
  labels: { '1': 'Unusable', '2': 'Poor', '3': 'Fair', '4': 'Good', '5': 'Very good' },
};

export const FIELD_ASSESSMENT_TEMPLATE: {
  code: string;
  name: string;
  description: string;
  sections: TemplateSection[];
} = {
  code: 'FIELD_ASSESSMENT_V1',
  name: 'Comprehensive facility field assessment',
  description:
    'The instrument used to establish a facility baseline. Designed for offline capture on a mobile device, with photographic evidence attached at the point of observation.',
  sections: [
    {
      code: 'FACILITY',
      name: 'Facility',
      description: 'Identity, location and basic profile of the facility.',
      weight: 0.5,
      items: [
        { code: 'FAC_NAME_CONFIRM', question: 'Is the facility name on the signboard the same as the registered name?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FAC_TYPE', question: 'What tier of facility is this understood to be locally?', responseType: 'SELECT', options: { choices: ['Health Post', 'Primary Health Centre', 'Community Health Centre', 'Cottage Hospital', 'Other'] } },
        { code: 'FAC_YEAR_BUILT', question: 'Approximate year the facility was built', responseType: 'NUMBER', unit: 'year', isRequired: false },
        { code: 'FAC_LAST_RENOVATION', question: 'Approximate year of the last significant renovation', responseType: 'NUMBER', unit: 'year', isRequired: false },
        { code: 'FAC_OPERATING_HOURS', question: 'Hours per day the facility is actually open', helpText: 'What happens in practice, not what the signboard says.', responseType: 'NUMBER', unit: 'hours' },
        { code: 'FAC_OPERATING_DAYS', question: 'Days per week the facility is actually open', responseType: 'NUMBER', unit: 'days' },
        { code: 'FAC_24_HOUR', question: 'Is any service available 24 hours?', responseType: 'BOOLEAN' },
        { code: 'FAC_GPS', question: 'Record the GPS position at the main entrance', responseType: 'TEXT', evidenceRequired: true },
        { code: 'FAC_FRONT_PHOTO', question: 'Photograph of the facility frontage', responseType: 'TEXT', evidenceRequired: true },
      ],
    },
    {
      code: 'OWNERSHIP',
      name: 'Ownership',
      description: 'Who owns the land and buildings, and what documents evidence it.',
      weight: 0.75,
      items: [
        { code: 'OWN_TYPE', question: 'Who owns the facility?', responseType: 'SELECT', options: { choices: ['Federal Government', 'State Government', 'Local Government', 'Community', 'Faith-based', 'Private', 'Unclear'] }, evidenceRequired: true },
        { code: 'OWN_LAND_DOC', question: 'Is there documentary evidence of land title or allocation?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'OWN_DOC_TYPE', question: 'What document was produced?', responseType: 'TEXT', isRequired: false },
        { code: 'OWN_CUSTODIAN', question: 'Who is the day-to-day custodian of the premises?', responseType: 'TEXT' },
        { code: 'OWN_DISPUTE', question: 'Is any ownership or boundary dispute reported?', helpText: 'Record what was stated and by whom. This is REPORTED information until verified.', responseType: 'BOOLEAN' },
        { code: 'OWN_ENCUMBRANCE', question: 'Is any existing lease, concession or management arrangement in place?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'GOVERNANCE',
      name: 'Governance',
      description: 'How the facility is managed and held to account.',
      weight: 0.75,
      items: [
        { code: 'GOV_OFFICER_IN_CHARGE', question: 'Is there a designated officer in charge?', responseType: 'BOOLEAN' },
        { code: 'GOV_OIC_PRESENT', question: 'Was the officer in charge present during this visit?', responseType: 'BOOLEAN' },
        { code: 'GOV_COMMITTEE', question: 'Is there a functioning facility health committee?', helpText: 'Functioning means it has met within the last six months and minutes exist.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'GOV_COMMITTEE_MEETINGS', question: 'Committee meetings held in the last 12 months', responseType: 'NUMBER', unit: 'meetings', isRequired: false },
        { code: 'GOV_SUPERVISION_VISITS', question: 'Supervisory visits from the LGA or state in the last 12 months', responseType: 'NUMBER', unit: 'visits', isRequired: false },
        { code: 'GOV_WRITTEN_PROTOCOLS', question: 'Are written clinical protocols or standing orders available on site?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'INFRASTRUCTURE',
      name: 'Infrastructure',
      description: 'Buildings, rooms and physical condition. Observe, photograph, and do not conclude.',
      weight: 1.5,
      items: [
        { code: 'INF_BUILDING_COUNT', question: 'Number of separate buildings on the site', responseType: 'NUMBER', unit: 'buildings' },
        { code: 'INF_ROOM_COUNT', question: 'Total number of rooms', responseType: 'NUMBER', unit: 'rooms' },
        { code: 'INF_ROOMS_USABLE', question: 'Number of rooms currently usable for their intended purpose', responseType: 'NUMBER', unit: 'rooms', evidenceRequired: true },
        { code: 'INF_ROOF_INGRESS', question: 'Is there visible water ingress or roof damage in any room?', helpText: 'Photograph each affected room separately.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'INF_WALLS', question: 'Condition of walls and plaster', responseType: 'SCALE', options: CONDITION_SCALE, evidenceRequired: true },
        { code: 'INF_FLOORS', question: 'Condition of floors', responseType: 'SCALE', options: CONDITION_SCALE },
        { code: 'INF_DOORS_WINDOWS', question: 'Condition of doors, windows and locks', responseType: 'SCALE', options: CONDITION_SCALE },
        { code: 'INF_CEILING', question: 'Condition of ceilings', responseType: 'SCALE', options: CONDITION_SCALE },
        { code: 'INF_CONSULTING_ROOMS', question: 'Number of usable consulting rooms offering visual and auditory privacy', helpText: 'Privacy is a clinical requirement, not a comfort. A curtain in a shared room does not count.', responseType: 'NUMBER', unit: 'rooms', evidenceRequired: true },
        { code: 'INF_DELIVERY_ROOM', question: 'Is there a usable delivery room?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'INF_BEDS', question: 'Number of usable beds', responseType: 'NUMBER', unit: 'beds' },
        { code: 'INF_TOILETS_STAFF', question: 'Number of functioning staff toilets', responseType: 'NUMBER', unit: 'toilets' },
        { code: 'INF_TOILETS_PATIENT', question: 'Number of functioning patient toilets', responseType: 'NUMBER', unit: 'toilets', evidenceRequired: true },
        { code: 'INF_WAITING_AREA', question: 'Is there a covered waiting area with seating?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'INF_PERIMETER', question: 'Is the site fenced or walled?', responseType: 'BOOLEAN' },
        { code: 'INF_ACCESS_ROAD', question: 'Is the access road usable by a vehicle in the rainy season?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'INF_DISABILITY_ACCESS', question: 'Can a wheelchair reach the consulting area without steps?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'UTILITIES',
      name: 'Utilities',
      description: 'Power, water, communications and waste. Availability in practice, not in principle.',
      weight: 1.25,
      items: [
        { code: 'UTL_GRID_CONNECTED', question: 'Is the facility connected to the electricity grid?', responseType: 'BOOLEAN' },
        { code: 'UTL_GRID_HOURS', question: 'Average hours of grid power per day', helpText: 'Ask staff what they actually experience. This is REPORTED unless a log exists.', responseType: 'NUMBER', unit: 'hours/day' },
        { code: 'UTL_GENERATOR', question: 'Is there a working generator?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_SOLAR', question: 'Is there a working solar installation?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_POWER_RELIABLE_LIGHTING', question: 'Can the delivery room be reliably lit at night?', helpText: 'The single most consequential power question in a maternity setting.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_WATER_SOURCE', question: 'Primary water source', responseType: 'SELECT', options: { choices: ['Borehole with pump', 'Borehole hand pump', 'Piped supply', 'Well', 'Rainwater', 'Purchased/tanker', 'None on site'] }, evidenceRequired: true },
        { code: 'UTL_WATER_RUNNING', question: 'Is there running water at the point of care?', helpText: 'A tap that runs, in the room where clinical work happens.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_HANDWASHING', question: 'Number of functioning handwashing points with soap', responseType: 'NUMBER', unit: 'points', evidenceRequired: true },
        { code: 'UTL_MOBILE_SIGNAL', question: 'Is there usable mobile network signal on site?', responseType: 'BOOLEAN' },
        { code: 'UTL_INTERNET', question: 'Is there any internet connectivity?', responseType: 'BOOLEAN' },
        { code: 'UTL_WASTE_SHARPS', question: 'Are sharps containers in use at every point of injection?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_WASTE_DISPOSAL', question: 'How is clinical waste finally disposed of?', responseType: 'SELECT', options: { choices: ['Incinerator on site', 'Burial pit on site', 'Open burning', 'Collected by contractor', 'No defined method'] }, evidenceRequired: true },
        { code: 'UTL_COLD_CHAIN', question: 'Is there a working vaccine refrigerator with a temperature log?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'EQUIPMENT',
      name: 'Equipment',
      description: 'What equipment exists, and whether it works today.',
      weight: 1.25,
      items: [
        { code: 'EQP_BP_MACHINE', question: 'Number of working blood pressure machines', responseType: 'NUMBER', unit: 'units', evidenceRequired: true },
        { code: 'EQP_THERMOMETER', question: 'Number of working thermometers', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_WEIGHING_ADULT', question: 'Number of working adult weighing scales', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_WEIGHING_INFANT', question: 'Number of working infant weighing scales', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_STETHOSCOPE', question: 'Number of working stethoscopes', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_PULSE_OXIMETER', question: 'Number of working pulse oximeters', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_DELIVERY_KIT', question: 'Number of complete, sterilisable delivery kits', responseType: 'NUMBER', unit: 'kits', evidenceRequired: true },
        { code: 'EQP_STERILISER', question: 'Is there a working autoclave or steriliser?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'EQP_EXAMINATION_COUCH', question: 'Number of usable examination couches', responseType: 'NUMBER', unit: 'units' },
        { code: 'EQP_SUCTION', question: 'Is there working suction apparatus?', responseType: 'BOOLEAN' },
        { code: 'EQP_OXYGEN', question: 'Is there oxygen available and usable?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'EQP_NON_FUNCTIONAL', question: 'Number of items of equipment present but not working', helpText: 'Broken equipment on site is both a repair opportunity and a procurement warning.', responseType: 'NUMBER', unit: 'items', evidenceRequired: true },
        { code: 'EQP_MAINTENANCE_RECORD', question: 'Is there any equipment maintenance record?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'HUMAN_RESOURCES',
      name: 'Human resources',
      description: 'Establishment, posting and qualification. Required, approved, posted and present are four different numbers.',
      weight: 1.5,
      items: [
        { code: 'HR_DOCTORS_POSTED', question: 'Doctors posted to this facility', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_NURSES_POSTED', question: 'Nurses and midwives posted', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_CHEW_POSTED', question: 'CHEWs and community health officers posted', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_LAB_POSTED', question: 'Laboratory staff posted', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_PHARMACY_POSTED', question: 'Pharmacy staff posted', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_SUPPORT_POSTED', question: 'Support staff posted (records, cleaning, security)', responseType: 'NUMBER', unit: 'staff' },
        { code: 'HR_TOTAL_PRESENT', question: 'Total staff physically present on the day of this visit', helpText: 'Count people, at the time of the visit. This is the number that most often differs from the register.', responseType: 'NUMBER', unit: 'staff', evidenceRequired: true },
        { code: 'HR_ESTABLISHMENT_DOC', question: 'Is a written establishment or staffing norm available?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'HR_LICENCES_SIGHTED', question: 'Number of clinical staff whose current practising licence was sighted', responseType: 'NUMBER', unit: 'staff', evidenceRequired: true },
        { code: 'HR_TRAINING_12M', question: 'Staff who received any formal training in the last 12 months', responseType: 'NUMBER', unit: 'staff', isRequired: false },
        { code: 'HR_VACANCY_CRITICAL', question: 'Which cadres are absent altogether?', responseType: 'MULTISELECT', options: { choices: ['Doctor', 'Nurse', 'Midwife', 'CHEW', 'Laboratory', 'Pharmacy', 'Records', 'Security', 'Cleaning'] } },
      ],
    },
    {
      code: 'ATTENDANCE',
      name: 'Attendance',
      description: 'Whether posted staff are actually at work.',
      weight: 1.0,
      items: [
        { code: 'ATT_REGISTER_EXISTS', question: 'Is an attendance register kept?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'ATT_REGISTER_CURRENT', question: 'Is the attendance register current to today?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'ATT_SIGNED_LAST_30', question: 'Days signed in the register in the last 30 days', responseType: 'NUMBER', unit: 'days', isRequired: false },
        { code: 'ATT_ROSTER_EXISTS', question: 'Is there a written duty roster?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'ATT_NIGHT_COVER', question: 'Is there staff cover overnight?', responseType: 'BOOLEAN' },
        { code: 'ATT_WEEKEND_COVER', question: 'Is there staff cover at weekends?', responseType: 'BOOLEAN' },
        { code: 'ATT_OBSERVED_PRESENT_RATIO', question: 'Staff present today as a proportion of staff rostered today', helpText: 'Record both numbers in the note. This single observation is the baseline for attendance improvement.', responseType: 'NUMBER', unit: '%', evidenceRequired: true },
      ],
    },
    {
      code: 'CLINICAL_SERVICES',
      name: 'Clinical services',
      description: 'What care is actually delivered here now.',
      weight: 1.5,
      items: [
        { code: 'CLIN_OPD', question: 'Is general outpatient care provided?', responseType: 'BOOLEAN' },
        { code: 'CLIN_ANC', question: 'Is antenatal care provided?', responseType: 'BOOLEAN' },
        { code: 'CLIN_DELIVERY', question: 'Are deliveries conducted here?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'CLIN_DELIVERY_NIGHT', question: 'Are deliveries conducted at night?', responseType: 'BOOLEAN' },
        { code: 'CLIN_IMMUNISATION', question: 'Is routine immunisation provided?', responseType: 'BOOLEAN' },
        { code: 'CLIN_FAMILY_PLANNING', question: 'Is family planning provided?', responseType: 'BOOLEAN' },
        { code: 'CLIN_CHRONIC', question: 'Is chronic disease follow-up provided?', responseType: 'BOOLEAN' },
        { code: 'CLIN_MINOR_PROCEDURES', question: 'Are minor procedures performed?', responseType: 'BOOLEAN' },
        { code: 'CLIN_EMERGENCY', question: 'Is emergency stabilisation possible?', responseType: 'BOOLEAN' },
        { code: 'CLIN_REFERRAL_PATH', question: 'Is there a defined referral facility and route?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'CLIN_REFERRAL_TRANSPORT', question: 'Is transport available for referral?', responseType: 'BOOLEAN' },
        { code: 'CLIN_RECORDS_SYSTEM', question: 'How are clinical records kept?', responseType: 'SELECT', options: { choices: ['Paper register only', 'Paper case notes', 'Mixed paper and electronic', 'Electronic', 'No systematic records'] }, evidenceRequired: true },
        { code: 'CLIN_RECORDS_RETRIEVABLE', question: 'Can a named patient\'s previous visit be retrieved within five minutes?', helpText: 'Ask for a real retrieval. Continuity of care depends on this working in practice.', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'PHARMACY',
      name: 'Pharmacy',
      description: 'Medicines: what is held, how it is stored, and how it is accounted for.',
      weight: 1.25,
      items: [
        { code: 'PHM_DEDICATED_SPACE', question: 'Is there a lockable, dedicated space for medicines?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_SHELVING', question: 'Are medicines stored off the floor on shelving?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_TEMPERATURE', question: 'Is the storage area protected from direct sun and excessive heat?', responseType: 'BOOLEAN' },
        { code: 'PHM_STOCK_CARDS', question: 'Are stock cards or a stock ledger in use?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_STOCK_CARDS_CURRENT', question: 'Do stock records match physical count for three sampled items?', helpText: 'Pick three items, count them, compare. Record all three in the note.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_TRACER_AVAILABLE', question: 'Number of tracer medicines available today', helpText: 'Use the agreed tracer list. This is the baseline for drug availability.', responseType: 'NUMBER', unit: 'items', evidenceRequired: true },
        { code: 'PHM_TRACER_CHECKED', question: 'Number of tracer medicines checked', responseType: 'NUMBER', unit: 'items' },
        { code: 'PHM_EXPIRED_PRESENT', question: 'Is any expired stock present on the shelves?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_EXPIRY_CHECK_ROUTINE', question: 'Is there a routine expiry check?', responseType: 'BOOLEAN' },
        { code: 'PHM_DISPENSING_RECORD', question: 'Is dispensing recorded against a named patient?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_PRICING_DISPLAYED', question: 'Are medicine prices displayed to patients?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'PHM_QUALIFIED_STAFF', question: 'Is a pharmacy-qualified person responsible for medicines?', responseType: 'BOOLEAN' },
      ],
    },
    {
      code: 'LABORATORY',
      name: 'Laboratory',
      description: 'Diagnostic capability that is available today, not on paper.',
      weight: 1.25,
      items: [
        { code: 'LAB_EXISTS', question: 'Is there a laboratory space?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_FUNCTIONING', question: 'Is any test being performed currently?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_TESTS_AVAILABLE', question: 'Which tests can be performed today?', responseType: 'MULTISELECT', options: { choices: ['Malaria RDT', 'Malaria microscopy', 'PCV/haematocrit', 'Full blood count', 'Blood glucose', 'Urinalysis', 'Pregnancy test', 'HIV screening', 'Hepatitis B', 'Widal', 'Stool microscopy', 'Blood grouping', 'None'] }, evidenceRequired: true },
        { code: 'LAB_MICROSCOPE', question: 'Is there a working microscope?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_CENTRIFUGE', question: 'Is there a working centrifuge?', responseType: 'BOOLEAN' },
        { code: 'LAB_REAGENTS', question: 'Are reagents in stock and unexpired?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_REGISTER', question: 'Is a laboratory register kept?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_RESULTS_TO_CLINICIAN', question: 'Do results reach the clinician in writing?', responseType: 'BOOLEAN' },
        { code: 'LAB_QC', question: 'Is any quality control performed?', responseType: 'BOOLEAN' },
        { code: 'LAB_SAFETY', question: 'Are gloves and sharps disposal available in the laboratory?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'LAB_QUALIFIED_STAFF', question: 'Is a laboratory-qualified person responsible?', responseType: 'BOOLEAN' },
      ],
    },
    {
      code: 'UTILISATION',
      name: 'Patient utilisation',
      description: 'How many people this facility currently serves. Derived from registers where they exist; REPORTED where they do not.',
      weight: 1.25,
      items: [
        { code: 'UTL_OPD_LAST_MONTH', question: 'Outpatient attendances recorded last month', helpText: 'Count from the register if one exists. If the number is given verbally, say so in the note — it is REPORTED, not VERIFIED.', responseType: 'NUMBER', unit: 'attendances', evidenceRequired: true },
        { code: 'UTL_OPD_PER_DAY', question: 'Typical outpatient attendances per day', responseType: 'NUMBER', unit: 'patients/day', evidenceRequired: true },
        { code: 'UTL_ANC_LAST_MONTH', question: 'Antenatal attendances recorded last month', responseType: 'NUMBER', unit: 'attendances' },
        { code: 'UTL_DELIVERIES_LAST_MONTH', question: 'Deliveries recorded last month', responseType: 'NUMBER', unit: 'deliveries', evidenceRequired: true },
        { code: 'UTL_DELIVERIES_LAST_YEAR', question: 'Deliveries recorded in the last 12 months', responseType: 'NUMBER', unit: 'deliveries', isRequired: false },
        { code: 'UTL_IMMUNISATION_LAST_MONTH', question: 'Immunisation contacts last month', responseType: 'NUMBER', unit: 'contacts' },
        { code: 'UTL_REFERRALS_LAST_MONTH', question: 'Referrals made last month', responseType: 'NUMBER', unit: 'referrals', isRequired: false },
        { code: 'UTL_REGISTER_LEGIBLE', question: 'Are the registers legible and complete enough to count from?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'UTL_TREND', question: 'Do staff report attendance rising, stable or falling?', responseType: 'SELECT', options: { choices: ['Rising', 'Stable', 'Falling', 'Unknown'] } },
      ],
    },
    {
      code: 'FINANCE',
      name: 'Finance',
      description: 'Revenue, controls and where the money goes. Handle with care and record the source of every figure.',
      weight: 1.25,
      items: [
        { code: 'FIN_CHARGES_PATIENTS', question: 'Are patients charged for services?', responseType: 'BOOLEAN' },
        { code: 'FIN_TARIFF_WRITTEN', question: 'Is there a written tariff?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FIN_TARIFF_DISPLAYED', question: 'Is the tariff displayed where patients can see it?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FIN_RECEIPTS_ISSUED', question: 'Are numbered receipts issued?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FIN_CASH_BOOK', question: 'Is a cash book or revenue register kept?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FIN_BANK_ACCOUNT', question: 'Does the facility have a bank account it controls?', responseType: 'BOOLEAN' },
        { code: 'FIN_REVENUE_LAST_MONTH', question: 'Revenue recorded last month', helpText: 'Only record a figure if a written record was sighted. Otherwise leave blank and note what was said.', responseType: 'CURRENCY', unit: 'NGN', isRequired: false, evidenceRequired: true },
        { code: 'FIN_REVENUE_DESTINATION', question: 'Where does collected revenue go?', responseType: 'SELECT', options: { choices: ['Retained at facility', 'Remitted to LGA', 'Remitted to state', 'Mixed', 'Unclear'] } },
        { code: 'FIN_NHIS', question: 'Does the facility receive any health insurance payments?', responseType: 'BOOLEAN' },
        { code: 'FIN_SEPARATION_OF_DUTIES', question: 'Is the person who collects money different from the person who records it?', responseType: 'BOOLEAN' },
        { code: 'FIN_EXPENDITURE_RECORD', question: 'Is expenditure recorded anywhere?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'FIN_STAFF_PAID_ON_TIME', question: 'Do staff report being paid on time?', responseType: 'BOOLEAN' },
      ],
    },
    {
      code: 'COMMUNITY',
      name: 'Community',
      description: 'Who this facility is for, and what they say about it.',
      weight: 1.0,
      items: [
        { code: 'COM_CATCHMENT_POP', question: 'Estimated catchment population', helpText: 'State the source in the note. A census figure is REPORTED, not VERIFIED.', responseType: 'NUMBER', unit: 'people' },
        { code: 'COM_COMMUNITIES_SERVED', question: 'Number of communities served', responseType: 'NUMBER', unit: 'communities' },
        { code: 'COM_FURTHEST_DISTANCE', question: 'Distance from the furthest community served', responseType: 'NUMBER', unit: 'km' },
        { code: 'COM_TRANSPORT', question: 'How do most patients arrive?', responseType: 'SELECT', options: { choices: ['On foot', 'Motorcycle', 'Shared vehicle', 'Own vehicle', 'Mixed'] } },
        { code: 'COM_COMPETING_FACILITIES', question: 'Other health facilities within 10km', responseType: 'NUMBER', unit: 'facilities' },
        { code: 'COM_PATENT_MEDICINE', question: 'Are patent medicine vendors the first point of care locally?', responseType: 'BOOLEAN' },
        { code: 'COM_AFFORDABILITY', question: 'Do community members report cost as a barrier to attending?', responseType: 'BOOLEAN' },
        { code: 'COM_TRUST', question: 'What do community members say about the facility?', helpText: 'Record verbatim where possible, and note how many people were spoken to.', responseType: 'TEXT', evidenceRequired: true },
        { code: 'COM_TOP_HEALTH_NEEDS', question: 'Health problems most commonly reported by the community', responseType: 'MULTISELECT', options: { choices: ['Malaria', 'Respiratory infection', 'Diarrhoeal disease', 'Maternal care', 'Child nutrition', 'Hypertension', 'Diabetes', 'Injury', 'Typhoid', 'Other'] } },
        { code: 'COM_PARTICIPATION', question: 'Is the community involved in facility governance in any way?', responseType: 'BOOLEAN' },
      ],
    },
    {
      code: 'REGULATORY',
      name: 'Regulatory',
      description: 'Documentation sighted. This section records evidence, and asserts no legal conclusion.',
      weight: 1.0,
      items: [
        { code: 'REG_FACILITY_REGISTRATION', question: 'Was a facility registration certificate sighted?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'REG_REGISTRATION_CURRENT', question: 'Is the registration within its validity period?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'REG_PHARMACY_PERMIT', question: 'Was a pharmacy premises registration sighted?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'REG_LAB_REGISTRATION', question: 'Was a laboratory registration sighted?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'REG_WASTE_ARRANGEMENT', question: 'Was any documented waste disposal arrangement sighted?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'REG_FIRE_SAFETY', question: 'Was a fire safety inspection record sighted?', responseType: 'BOOLEAN' },
        { code: 'REG_PRIVACY_NOTICE', question: 'Is any patient privacy notice displayed or available?', responseType: 'BOOLEAN' },
        { code: 'REG_OUTSTANDING_NOTICES', question: 'Are there any outstanding regulatory notices or directives?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'DIGITAL',
      name: 'Digital readiness',
      description: 'What the facility can support technologically, which determines how quickly the EMR can be introduced.',
      weight: 0.75,
      items: [
        { code: 'DIG_COMPUTERS', question: 'Number of working computers', responseType: 'NUMBER', unit: 'units' },
        { code: 'DIG_PRINTER', question: 'Is there a working printer?', responseType: 'BOOLEAN' },
        { code: 'DIG_SMARTPHONES', question: 'Number of staff with a personal smartphone they use for work', responseType: 'NUMBER', unit: 'staff' },
        { code: 'DIG_STAFF_COMPUTER_LITERATE', question: 'Number of staff comfortable using a computer or smartphone app', responseType: 'NUMBER', unit: 'staff' },
        { code: 'DIG_EXISTING_SYSTEM', question: 'Is any digital health system already in use?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'DIG_EXISTING_SYSTEM_NAME', question: 'Which system, and for what?', responseType: 'TEXT', isRequired: false },
        { code: 'DIG_POWER_FOR_DEVICES', question: 'Can devices be reliably charged on site?', responseType: 'BOOLEAN' },
        { code: 'DIG_DATA_REPORTING', question: 'Is data currently reported upward (e.g. DHIS2)?', responseType: 'BOOLEAN', evidenceRequired: true },
      ],
    },
    {
      code: 'RISK',
      name: 'Risk',
      description: 'What could prevent this from working. Record risks as observed, with the reasoning.',
      weight: 1.0,
      items: [
        { code: 'RSK_SECURITY', question: 'Are there security concerns affecting access or operation?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'RSK_SEASONAL_ACCESS', question: 'Does seasonal flooding or road failure cut off access?', responseType: 'BOOLEAN' },
        { code: 'RSK_STAFF_RETENTION', question: 'Is staff turnover or retention reported as a problem?', responseType: 'BOOLEAN' },
        { code: 'RSK_COMMUNITY_RESISTANCE', question: 'Is there any community resistance to the proposed arrangement?', responseType: 'BOOLEAN' },
        { code: 'RSK_POLITICAL', question: 'Are there political or institutional factors that could affect continuity?', helpText: 'Record factually and neutrally.', responseType: 'TEXT', isRequired: false },
        { code: 'RSK_STRUCTURAL', question: 'Is any building structurally unsafe for use?', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'RSK_CLINICAL_SAFETY', question: 'Was any immediate clinical safety hazard observed?', helpText: 'If yes, this becomes a P1 finding and should be raised with the officer in charge before leaving.', responseType: 'BOOLEAN', evidenceRequired: true },
        { code: 'RSK_OTHER', question: 'Any other risk observed', responseType: 'TEXT', isRequired: false },
      ],
    },
  ],
};
