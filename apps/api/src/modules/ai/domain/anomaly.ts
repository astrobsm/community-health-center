/**
 * Anomaly detection (doc 17 §9).
 *
 * Detection is arithmetic. The language model, where it is used at all, only
 * describes what the arithmetic found — it never decides that something is
 * wrong, because a model that decides is a model somebody stops checking.
 *
 * Every anomaly here is a flag for a human. Nothing in this module triggers an
 * action, blocks a transaction or notifies a regulator. It says: this figure is
 * unlike the others, here are the records behind it, and here is what it might
 * innocently mean.
 *
 * That last part matters. A detector that only reports suspicion trains people
 * to dismiss it. Every anomaly this module raises carries at least one ordinary
 * explanation, because most of them have one.
 *
 * Pure: no I/O, the clock is injected.
 */

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Observation {
  /** Period, item, person — whatever the series is indexed by. */
  key: string;
  value: number;
  /** Records behind this observation, so a reader can go and look. */
  recordIds?: readonly string[];
}

export interface Anomaly {
  detector: string;
  key: string;
  value: number;
  /** What the rest of the series looks like. */
  expected: number;
  /** How many standard deviations out, where the detector uses them. */
  zScore: number | null;
  severity: AnomalySeverity;
  /** What was noticed, in a sentence. */
  description: string;
  /** What it might innocently be. */
  benignExplanations: string[];
  recordIds: readonly string[];
}

export interface DetectionResult {
  anomalies: Anomaly[];
  /** Null where there was not enough history to say anything. */
  mean: number | null;
  standardDeviation: number | null;
  observations: number;
  /** Said plainly when the detector could not run. */
  note?: string;
}

export interface OutlierOptions {
  /** How many standard deviations out counts. Three by convention, not by law. */
  sigma?: number;
  /** Below this many observations, the detector declines to run. */
  minimumObservations?: number;
  detector?: string;
  unit?: string;
  benignExplanations?: readonly string[];
}

/**
 * Points outside ±kσ of the rest of the series.
 *
 * The mean and standard deviation are computed EXCLUDING the point under test.
 * Including it lets a single large outlier inflate the deviation until it no
 * longer looks unusual — which is exactly the case worth catching.
 */
export function detectOutliers(
  observations: readonly Observation[],
  options: OutlierOptions = {},
): DetectionResult {
  const sigma = options.sigma ?? 3;
  const minimum = options.minimumObservations ?? 8;
  const detector = options.detector ?? 'outlier';

  const clean = observations.filter((observation) => Number.isFinite(observation.value));

  if (clean.length < minimum) {
    return {
      anomalies: [],
      mean: null,
      standardDeviation: null,
      observations: clean.length,
      note:
        `${clean.length} observation(s); ${minimum} are needed before a figure can be called unusual. ` +
        'With less, everything looks like an outlier and nothing is.',
    };
  }

  const values = clean.map((observation) => observation.value);
  const overallMean = average(values);
  const overallSd = standardDeviation(values);

  const anomalies: Anomaly[] = [];

  for (const observation of clean) {
    const others = clean.filter((candidate) => candidate !== observation).map((c) => c.value);
    const otherMean = average(others);
    const otherSd = standardDeviation(others);

    if (otherSd === 0) {
      // Every other observation is identical. A different value here is
      // certainly unusual, but a z-score would be infinite and meaningless.
      if (observation.value !== otherMean) {
        anomalies.push({
          detector,
          key: observation.key,
          value: observation.value,
          expected: round(otherMean, 4),
          zScore: null,
          severity: 'MEDIUM',
          description:
            `${observation.key} recorded ${observation.value}${options.unit ? ` ${options.unit}` : ''} ` +
            `where every other period recorded exactly ${otherMean}. Unusual, though a series that ` +
            'never varies is itself worth a look.',
          benignExplanations: [...(options.benignExplanations ?? []), 'The series may be a placeholder rather than a measurement.'],
          recordIds: observation.recordIds ?? [],
        });
      }
      continue;
    }

    const z = (observation.value - otherMean) / otherSd;

    if (Math.abs(z) < sigma) continue;

    anomalies.push({
      detector,
      key: observation.key,
      value: observation.value,
      expected: round(otherMean, 4),
      zScore: round(z, 2),
      severity: Math.abs(z) >= sigma + 2 ? 'HIGH' : Math.abs(z) >= sigma + 1 ? 'MEDIUM' : 'LOW',
      description:
        `${observation.key} recorded ${observation.value}${options.unit ? ` ${options.unit}` : ''}, ` +
        `${Math.abs(round(z, 1))} standard deviations ${z > 0 ? 'above' : 'below'} the ` +
        `${round(otherMean, 2)} of the other ${clean.length - 1} period(s).`,
      benignExplanations: [...(options.benignExplanations ?? [])],
      recordIds: observation.recordIds ?? [],
    });
  }

  return {
    anomalies: anomalies.sort((a, b) => Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0)),
    mean: round(overallMean, 4),
    standardDeviation: round(overallSd, 4),
    observations: clean.length,
  };
}

export interface ConcentrationInput {
  key: string;
  value: number;
  recordIds?: readonly string[];
}

/**
 * One party taking an unusual share of the whole.
 *
 * Used for supplier concentration and for repeated variance against one person.
 * A high share is not wrongdoing — a village may have one supplier of anything
 * — so the threshold is configurable and the explanation says so.
 */
export function detectConcentration(
  entries: readonly ConcentrationInput[],
  options: { threshold?: number; minimumEntries?: number; detector?: string; subject?: string } = {},
): DetectionResult {
  const threshold = options.threshold ?? 0.6;
  const minimumEntries = options.minimumEntries ?? 3;
  const detector = options.detector ?? 'concentration';
  const subject = options.subject ?? 'party';

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);

  if (entries.length < minimumEntries || total <= 0) {
    return {
      anomalies: [],
      mean: null,
      standardDeviation: null,
      observations: entries.length,
      note:
        entries.length < minimumEntries
          ? `${entries.length} ${subject}(s) in the period; concentration means nothing below ` +
            `${minimumEntries}. A facility with one supplier is not concentrated, it is supplied.`
          : 'The total is zero, so there are no shares to compute.',
    };
  }

  const anomalies: Anomaly[] = entries
    .filter((entry) => entry.value / total >= threshold)
    .map((entry) => ({
      detector,
      key: entry.key,
      value: round(entry.value, 2),
      expected: round(total / entries.length, 2),
      zScore: null,
      severity: entry.value / total >= 0.9 ? 'HIGH' : 'MEDIUM',
      description:
        `${entry.key} accounts for ${Math.round((entry.value / total) * 100)}% of the total across ` +
        `${entries.length} ${subject}(s).`,
      benignExplanations: [
        'A rural facility often has few realistic suppliers, and the nearest may be the only one who delivers.',
        'A single large order can dominate a short period without meaning anything.',
      ],
      recordIds: entry.recordIds ?? [],
    }));

  return {
    anomalies,
    mean: round(total / entries.length, 4),
    standardDeviation: round(standardDeviation(entries.map((entry) => entry.value)), 4),
    observations: entries.length,
  };
}

/**
 * A value outside a band derived from history.
 *
 * Distinct from the outlier detector: this one tests a single new observation
 * against a known history rather than finding the odd one out within a series.
 */
export function detectBandBreach(
  current: Observation,
  history: readonly number[],
  options: { sigma?: number; minimumHistory?: number; detector?: string; unit?: string } = {},
): DetectionResult {
  const sigma = options.sigma ?? 2;
  const minimumHistory = options.minimumHistory ?? 6;
  const detector = options.detector ?? 'band';

  if (history.length < minimumHistory) {
    return {
      anomalies: [],
      mean: null,
      standardDeviation: null,
      observations: history.length,
      note:
        `${history.length} historical period(s); ${minimumHistory} are needed to establish a band. ` +
        'Until then this measure has no normal to be outside of.',
    };
  }

  const mean = average(history);
  const sd = standardDeviation(history);
  const lower = mean - sigma * sd;
  const upper = mean + sigma * sd;

  const breached = current.value < lower || current.value > upper;

  return {
    anomalies: breached
      ? [
          {
            detector,
            key: current.key,
            value: current.value,
            expected: round(mean, 4),
            zScore: sd === 0 ? null : round((current.value - mean) / sd, 2),
            severity: 'MEDIUM',
            description:
              `${current.key} is ${current.value}${options.unit ? ` ${options.unit}` : ''}, outside the ` +
              `${round(lower, 2)} to ${round(upper, 2)} band set by the last ${history.length} period(s).`,
            benignExplanations: [
              'A band from a short history is easily broken by an ordinary busy week.',
              'A change in how something is recorded moves the figure without anything real changing.',
            ],
            recordIds: current.recordIds ?? [],
          },
        ]
      : [],
    mean: round(mean, 4),
    standardDeviation: round(sd, 4),
    observations: history.length,
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
