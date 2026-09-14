/**
 * Project health, and the clinical-versus-financial balance (spec §§22, 42).
 *
 * Two small engines that exist for the same reason: a single headline number
 * hides the trade-off that matters, so both of these refuse to produce one
 * without also naming what is wrong.
 *
 * Pure: the clock is injected.
 */

// -----------------------------------------------------------------------------
// Project health
// -----------------------------------------------------------------------------

export interface ProjectHealthInput {
  projectId: string;
  reference: string;
  name: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  budgetMinor: number;
  spentMinor: number;
  /** Phases complete over phases planned, 0..1. Null where none are defined. */
  physicalProgress: number | null;
  openIssues: number;
}

export type HealthBand = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'NOT_ASSESSABLE';

export interface ProjectHealth {
  projectId: string;
  reference: string;
  name: string;
  band: HealthBand;
  /** 0..100, or null where the project cannot be assessed. */
  score: number | null;
  scheduleVariance: number | null;
  budgetUsedRatio: number | null;
  /** Spend against progress. Above 1 means money is running ahead of work. */
  burnRatio: number | null;
  /** Every component of the band, in words. No bare traffic light. */
  reasons: string[];
}

export function assessProjectHealth(input: ProjectHealthInput, now: Date): ProjectHealth {
  const reasons: string[] = [];

  const budgetUsedRatio =
    input.budgetMinor > 0 ? round(input.spentMinor / input.budgetMinor, 4) : null;

  if (input.budgetMinor === 0) {
    reasons.push('No budget is recorded, so spending cannot be judged against one.');
  }

  // How far through the planned window we are, by the calendar.
  const elapsedRatio =
    input.plannedStart && input.plannedEnd && input.plannedEnd > input.plannedStart
      ? round(
          clamp(
            (now.getTime() - input.plannedStart.getTime()) /
              (input.plannedEnd.getTime() - input.plannedStart.getTime()),
            0,
            2,
          ),
          4,
        )
      : null;

  const scheduleVariance =
    elapsedRatio !== null && input.physicalProgress !== null
      ? round(input.physicalProgress - Math.min(elapsedRatio, 1), 4)
      : null;

  const burnRatio =
    budgetUsedRatio !== null && input.physicalProgress !== null && input.physicalProgress > 0
      ? round(budgetUsedRatio / input.physicalProgress, 4)
      : null;

  if (input.physicalProgress === null) {
    reasons.push(
      'No phases are recorded, so physical progress is unknown. A project with money spent and no ' +
        'recorded progress is the case this figure exists to surface.',
    );
  }

  if (scheduleVariance !== null) {
    if (scheduleVariance < -0.2) {
      reasons.push(
        `Physical progress is ${Math.abs(Math.round(scheduleVariance * 100))}% behind where the plan ` +
          'says it should be by now.',
      );
    } else if (scheduleVariance < -0.05) {
      reasons.push(`Slightly behind schedule (${Math.round(scheduleVariance * 100)}%).`);
    }
  }

  if (burnRatio !== null && burnRatio > 1.25) {
    reasons.push(
      `Spending is running ahead of work: ${Math.round(budgetUsedRatio! * 100)}% of budget used for ` +
        `${Math.round(input.physicalProgress! * 100)}% of the work.`,
    );
  }

  if (budgetUsedRatio !== null && budgetUsedRatio > 1) {
    reasons.push(`Over budget by ${Math.round((budgetUsedRatio - 1) * 100)}%.`);
  }

  if (input.plannedEnd && !input.actualEnd && input.plannedEnd < now) {
    reasons.push(
      `The planned completion date of ${input.plannedEnd.toISOString().slice(0, 10)} has passed and ` +
        'the project is not recorded as complete.',
    );
  }

  if (input.openIssues > 0) {
    reasons.push(`${input.openIssues} open issue(s) recorded against the project.`);
  }

  // A project nobody has recorded progress or a budget for cannot be scored.
  // Calling that ON_TRACK would be the most dangerous answer available.
  if (input.physicalProgress === null && budgetUsedRatio === null) {
    return {
      projectId: input.projectId,
      reference: input.reference,
      name: input.name,
      band: 'NOT_ASSESSABLE',
      score: null,
      scheduleVariance,
      budgetUsedRatio,
      burnRatio,
      reasons: [
        ...reasons,
        'Neither progress nor budget is recorded, so no health can be stated. This is not a healthy project; it is an unmeasured one.',
      ],
    };
  }

  if (input.actualEnd) {
    return {
      projectId: input.projectId,
      reference: input.reference,
      name: input.name,
      band: 'ON_TRACK',
      score: 100,
      scheduleVariance,
      budgetUsedRatio,
      burnRatio,
      reasons: [`Completed on ${input.actualEnd.toISOString().slice(0, 10)}.`, ...reasons],
    };
  }

  // Start at 100 and subtract what is actually wrong, so the score is always
  // explainable by the list beside it.
  let score = 100;
  if (scheduleVariance !== null && scheduleVariance < 0) score += scheduleVariance * 100;
  if (burnRatio !== null && burnRatio > 1) score -= (burnRatio - 1) * 40;
  if (budgetUsedRatio !== null && budgetUsedRatio > 1) score -= (budgetUsedRatio - 1) * 60;
  if (input.plannedEnd && input.plannedEnd < now) score -= 15;
  score -= Math.min(input.openIssues * 5, 20);

  const bounded = round(clamp(score, 0, 100), 1);

  return {
    projectId: input.projectId,
    reference: input.reference,
    name: input.name,
    band: bounded >= 85 ? 'ON_TRACK' : bounded >= 60 ? 'AT_RISK' : 'OFF_TRACK',
    score: bounded,
    scheduleVariance,
    budgetUsedRatio,
    burnRatio,
    reasons: reasons.length > 0 ? reasons : ['Nothing adverse is recorded against this project.'],
  };
}

// -----------------------------------------------------------------------------
// The clinical-versus-financial balance (spec §42)
// -----------------------------------------------------------------------------

export interface BalanceInput {
  /** Encounters in the period. */
  encounters: number;
  /** Revenue collected, in minor units. */
  revenueMinor: number;
  /** Charges waived, in minor units — care given and not billed. */
  waivedMinor: number;
  /** Patients turned away or referred for inability to pay, where recorded. */
  refusedForPaymentCount: number | null;
  /** Consent documented, 0..1. Null where no encounter took place. */
  consentRate: number | null;
  /** Incidents per 1,000 encounters. Null where there is no denominator. */
  incidentRate: number | null;
}

export interface BalanceAssessment {
  revenuePerEncounterMinor: number | null;
  waivedShare: number | null;
  /** Warnings where money appears to be winning over care, each with its basis. */
  concerns: string[];
  /** What the figures cannot tell you, said rather than implied. */
  limits: string[];
}

/**
 * Whether the pursuit of revenue is crowding out care.
 *
 * It cannot answer that question, and says so. What it can do is surface the
 * three patterns that would show up in the records if it were happening, and
 * insist that the absence of a record is reported as an absence.
 */
export function assessBalance(input: BalanceInput): BalanceAssessment {
  const concerns: string[] = [];
  const limits: string[] = [];

  const revenuePerEncounterMinor =
    input.encounters > 0 ? Math.round(input.revenueMinor / input.encounters) : null;

  const billedTotal = input.revenueMinor + input.waivedMinor;
  const waivedShare = billedTotal > 0 ? round(input.waivedMinor / billedTotal, 4) : null;

  if (input.encounters === 0) {
    limits.push('No encounter took place in this period, so nothing here rests on a denominator.');
  }

  if (waivedShare !== null && waivedShare === 0 && input.encounters > 0) {
    // Not proof of anything, and said as such. But a facility serving a poor
    // catchment that waives nothing at all is worth a question.
    concerns.push(
      'No charge was waived in this period. In a facility serving a catchment where some patients ' +
        'cannot pay, a waiver rate of exactly zero is worth asking about — it may mean nobody was ' +
        'turned away, or it may mean nobody was offered a waiver.',
    );
  }

  if (input.refusedForPaymentCount === null) {
    limits.push(
      'Whether anybody was turned away for inability to pay is not recorded, so this cannot be ' +
        'reported. A dashboard that showed nought here would be inventing the most important number ' +
        'on the page.',
    );
  } else if (input.refusedForPaymentCount > 0) {
    concerns.push(
      `${input.refusedForPaymentCount} patient(s) are recorded as not treated for inability to pay.`,
    );
  }

  if (input.consentRate !== null && input.consentRate < 0.9) {
    concerns.push(
      `Consent was documented for ${Math.round(input.consentRate * 100)}% of encounters. Care given ` +
        'faster than it can be documented shows up here first.',
    );
  }

  if (input.incidentRate === null) {
    limits.push('No incident rate could be computed, so safety is not represented in this balance.');
  }

  limits.push(
    'These figures describe what was recorded. They cannot tell you whether a patient who should ' +
      'have come did not come, which is the failure this section is really about.',
  );

  return { revenuePerEncounterMinor, waivedShare, concerns, limits };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
