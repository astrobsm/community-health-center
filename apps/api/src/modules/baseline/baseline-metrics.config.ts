import type { MetricSource } from './domain/seal';

/**
 * Which assessment items become baseline metrics (spec §12).
 *
 * This is the bridge between "what an assessor observed" and "the Day 0 figure
 * every later comparison is measured against". It is a declared mapping rather
 * than inference, because a baseline metric is a commitment — it should be
 * obvious and reviewable which question produced it.
 *
 * An item listed here that was never answered becomes a GAP, not a zero
 * (see `deriveMetrics`). That is the whole point: a baseline that quietly
 * records "0 patients/day" because nobody counted is a false fact that every
 * subsequent report inherits.
 *
 * The metric codes match the KPI codes in the seed wherever a baseline is
 * meant to be comparable to a live KPI — that correspondence is what makes
 * `baseline vs current` computable at all (doc 22 §3).
 */
export const BASELINE_METRIC_SOURCES: MetricSource[] = [
  // Utilisation — the headline figures a partnership is judged on
  {
    metricCode: 'PATIENTS_PER_DAY',
    metricName: 'Patients per day',
    domainCode: 'UTILISATION',
    unit: 'patients/day',
    itemCode: 'UTL_OPD_PER_DAY',
  },
  {
    metricCode: 'OPD_MONTHLY',
    metricName: 'Outpatient attendances per month',
    domainCode: 'UTILISATION',
    unit: 'attendances',
    itemCode: 'UTL_OPD_LAST_MONTH',
  },
  {
    metricCode: 'ANC_MONTHLY',
    metricName: 'Antenatal attendances per month',
    domainCode: 'UTILISATION',
    unit: 'attendances',
    itemCode: 'UTL_ANC_LAST_MONTH',
  },
  {
    metricCode: 'FACILITY_DELIVERIES',
    metricName: 'Deliveries per month',
    domainCode: 'MATERNAL',
    unit: 'deliveries',
    itemCode: 'UTL_DELIVERIES_LAST_MONTH',
  },
  {
    metricCode: 'IMMUNISATION_MONTHLY',
    metricName: 'Immunisation contacts per month',
    domainCode: 'CHILD_HEALTH',
    unit: 'contacts',
    itemCode: 'UTL_IMMUNISATION_LAST_MONTH',
  },

  // Infrastructure
  {
    metricCode: 'ROOMS_TOTAL',
    metricName: 'Rooms',
    domainCode: 'INFRASTRUCTURE',
    unit: 'rooms',
    itemCode: 'INF_ROOM_COUNT',
  },
  {
    metricCode: 'ROOMS_USABLE',
    metricName: 'Usable rooms',
    domainCode: 'INFRASTRUCTURE',
    unit: 'rooms',
    itemCode: 'INF_ROOMS_USABLE',
  },
  {
    metricCode: 'CONSULTING_ROOMS_PRIVATE',
    metricName: 'Consulting rooms with privacy',
    domainCode: 'INFRASTRUCTURE',
    unit: 'rooms',
    itemCode: 'INF_CONSULTING_ROOMS',
  },
  {
    metricCode: 'BEDS_USABLE',
    metricName: 'Usable beds',
    domainCode: 'INFRASTRUCTURE',
    unit: 'beds',
    itemCode: 'INF_BEDS',
  },
  {
    metricCode: 'DELIVERY_ROOM_USABLE',
    metricName: 'Usable delivery room',
    domainCode: 'INFRASTRUCTURE',
    unit: null,
    itemCode: 'INF_DELIVERY_ROOM',
  },

  // Utilities — availability in practice, not in principle
  {
    metricCode: 'GRID_POWER_HOURS',
    metricName: 'Grid power hours per day',
    domainCode: 'UTILITIES',
    unit: 'hours/day',
    itemCode: 'UTL_GRID_HOURS',
  },
  {
    metricCode: 'DELIVERY_ROOM_LIGHTING',
    metricName: 'Delivery room reliably lit at night',
    domainCode: 'UTILITIES',
    unit: null,
    itemCode: 'UTL_POWER_RELIABLE_LIGHTING',
  },
  {
    metricCode: 'RUNNING_WATER_AT_POINT_OF_CARE',
    metricName: 'Running water at the point of care',
    domainCode: 'UTILITIES',
    unit: null,
    itemCode: 'UTL_WATER_RUNNING',
  },
  {
    metricCode: 'HANDWASHING_POINTS',
    metricName: 'Functioning handwashing points',
    domainCode: 'UTILITIES',
    unit: 'points',
    itemCode: 'UTL_HANDWASHING',
  },
  {
    metricCode: 'COLD_CHAIN_WORKING',
    metricName: 'Working vaccine refrigerator with temperature log',
    domainCode: 'UTILITIES',
    unit: null,
    itemCode: 'UTL_COLD_CHAIN',
  },

  // Workforce — required, posted and present are different numbers
  {
    metricCode: 'STAFF_POSTED_TOTAL',
    metricName: 'Clinical staff posted',
    domainCode: 'HR',
    unit: 'staff',
    itemCode: 'HR_NURSES_POSTED',
  },
  {
    metricCode: 'STAFF_PRESENT_ON_VISIT',
    metricName: 'Staff present on the day of assessment',
    domainCode: 'HR',
    unit: 'staff',
    itemCode: 'HR_TOTAL_PRESENT',
  },
  {
    metricCode: 'STAFF_ATTENDANCE_RATE',
    metricName: 'Staff attendance rate',
    domainCode: 'HR',
    unit: '%',
    itemCode: 'ATT_OBSERVED_PRESENT_RATIO',
  },
  {
    metricCode: 'CREDENTIALS_SIGHTED',
    metricName: 'Clinical staff with a current licence sighted',
    domainCode: 'HR',
    unit: 'staff',
    itemCode: 'HR_LICENCES_SIGHTED',
  },

  // Pharmacy
  {
    metricCode: 'DRUG_AVAILABILITY_COUNT',
    metricName: 'Tracer medicines available',
    domainCode: 'PHARMACY',
    unit: 'items',
    itemCode: 'PHM_TRACER_AVAILABLE',
  },
  {
    metricCode: 'DRUG_AVAILABILITY_CHECKED',
    metricName: 'Tracer medicines checked',
    domainCode: 'PHARMACY',
    unit: 'items',
    itemCode: 'PHM_TRACER_CHECKED',
  },
  {
    metricCode: 'EXPIRED_STOCK_PRESENT',
    metricName: 'Expired stock present on shelves',
    domainCode: 'PHARMACY',
    unit: null,
    itemCode: 'PHM_EXPIRED_PRESENT',
  },

  // Laboratory
  {
    metricCode: 'LAB_TESTS_AVAILABLE',
    metricName: 'Tests performable today',
    domainCode: 'LABORATORY',
    unit: 'tests',
    itemCode: 'LAB_TESTS_AVAILABLE',
  },
  {
    metricCode: 'LAB_FUNCTIONING',
    metricName: 'Laboratory performing any test',
    domainCode: 'LABORATORY',
    unit: null,
    itemCode: 'LAB_FUNCTIONING',
  },

  // Equipment
  {
    metricCode: 'EQUIPMENT_NON_FUNCTIONAL',
    metricName: 'Equipment present but not working',
    domainCode: 'EQUIPMENT',
    unit: 'items',
    itemCode: 'EQP_NON_FUNCTIONAL',
  },
  {
    metricCode: 'DELIVERY_KITS',
    metricName: 'Complete delivery kits',
    domainCode: 'EQUIPMENT',
    unit: 'kits',
    itemCode: 'EQP_DELIVERY_KIT',
  },
  {
    metricCode: 'STERILISER_WORKING',
    metricName: 'Working autoclave or steriliser',
    domainCode: 'EQUIPMENT',
    unit: null,
    itemCode: 'EQP_STERILISER',
  },

  // Finance — recorded only where a written record was sighted
  {
    metricCode: 'MONTHLY_REVENUE',
    metricName: 'Revenue recorded last month',
    domainCode: 'FINANCE',
    unit: 'NGN',
    itemCode: 'FIN_REVENUE_LAST_MONTH',
  },
  {
    metricCode: 'RECEIPTS_ISSUED',
    metricName: 'Numbered receipts issued',
    domainCode: 'FINANCE',
    unit: null,
    itemCode: 'FIN_RECEIPTS_ISSUED',
  },
  {
    metricCode: 'TARIFF_DISPLAYED',
    metricName: 'Tariff displayed to patients',
    domainCode: 'FINANCE',
    unit: null,
    itemCode: 'FIN_TARIFF_DISPLAYED',
  },

  // Community
  {
    metricCode: 'CATCHMENT_POPULATION',
    metricName: 'Estimated catchment population',
    domainCode: 'COMMUNITY',
    unit: 'people',
    itemCode: 'COM_CATCHMENT_POP',
  },
  {
    metricCode: 'COMMUNITIES_SERVED',
    metricName: 'Communities served',
    domainCode: 'COMMUNITY',
    unit: 'communities',
    itemCode: 'COM_COMMUNITIES_SERVED',
  },

  // Digital readiness
  {
    metricCode: 'COMPUTERS_WORKING',
    metricName: 'Working computers',
    domainCode: 'DIGITAL',
    unit: 'units',
    itemCode: 'DIG_COMPUTERS',
  },
  {
    metricCode: 'STAFF_DIGITALLY_LITERATE',
    metricName: 'Staff comfortable using a device',
    domainCode: 'DIGITAL',
    unit: 'staff',
    itemCode: 'DIG_STAFF_COMPUTER_LITERATE',
  },
];
