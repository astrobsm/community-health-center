/**
 * Predictive analytics (spec §54, doc 17 §8).
 *
 * Forecasting here is statistics, not a language model. The model is used only
 * to explain a result that was computed deterministically, and it never sees
 * the forecast before the arithmetic is done.
 *
 * Two rules the whole module is built around.
 *
 * **No point estimate without an interval.** A bare number invites a facility
 * to plan as though the future were known. Every forecast this module produces
 * carries an 80% and a 95% interval, and the interval widens with the horizon
 * because uncertainty does.
 *
 * **Below the minimum history, it refuses.** Extrapolating a trend from three
 * weeks of data produces a confident line through noise, and somebody orders
 * stock against it. The refusal says how much history exists and how much is
 * needed, and shows the observed series instead.
 *
 * Pure: no I/O, the clock is injected.
 */

export interface SeriesPoint {
  /** Period label — a date, a week, a month. Carried through to the output. */
  period: string;
  value: number;
}

export type ForecastMethod = 'SEASONAL_NAIVE' | 'HOLT_WINTERS' | 'DRIFT' | 'MEAN';

export interface ForecastPoint {
  period: string;
  /** The central estimate. Never presented without the intervals beside it. */
  point: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

export interface ForecastRefusal {
  forecast: null;
  sufficient: false;
  observed: readonly SeriesPoint[];
  pointsAvailable: number;
  pointsRequired: number;
  reason: string;
}

export interface ForecastResult {
  forecast: ForecastPoint[];
  sufficient: true;
  observed: readonly SeriesPoint[];
  method: ForecastMethod;
  /** Standard deviation of the residuals the method left behind. */
  residualStandardDeviation: number;
  pointsAvailable: number;
  pointsRequired: number;
  /** PROJECTED, always. A forecast is never an actual. */
  classification: 'PROJECTED';
  /** How it was computed, in words a manager can weigh. */
  basis: string;
  /** What would make it better, and what it cannot do. */
  caveats: string[];
}

export type Forecast = ForecastResult | ForecastRefusal;

export interface ForecastOptions {
  /** Periods per season: 7 for daily-with-weekly, 12 for monthly-with-annual. */
  seasonLength?: number;
  /** Periods ahead. */
  horizon?: number;
  /** Below this many observations, refuse. */
  minimumPoints?: number;
  /** Labels for the periods ahead. Generated as "+1", "+2" when absent. */
  futurePeriods?: readonly string[];
}

/** 80% and 95% two-sided normal quantiles. */
const Z80 = 1.2815515655446004;
const Z95 = 1.959963984540054;

export function forecast(series: readonly SeriesPoint[], options: ForecastOptions = {}): Forecast {
  const seasonLength = options.seasonLength ?? 7;
  const horizon = options.horizon ?? 4;
  const minimumPoints = options.minimumPoints ?? 8;

  const clean = series.filter((point) => Number.isFinite(point.value));

  if (clean.length < minimumPoints) {
    return {
      forecast: null,
      sufficient: false,
      observed: clean,
      pointsAvailable: clean.length,
      pointsRequired: minimumPoints,
      reason:
        `Insufficient history for a reliable forecast. ${clean.length} period(s) of data available; ` +
        `${minimumPoints} required. The observed series is shown instead. Extrapolating from this ` +
        'much data would produce a confident line through noise, and somebody would order against it.',
    };
  }

  const values = clean.map((point) => point.value);

  // Holt-Winters needs two full seasons to separate the season from the trend.
  // With less, seasonal-naive is the honest fallback: it claims no trend it
  // cannot see.
  const seasonal = seasonLength > 1 && clean.length >= seasonLength * 2;
  const method: ForecastMethod = seasonal ? 'HOLT_WINTERS' : clean.length >= 4 ? 'DRIFT' : 'MEAN';

  const { fitted, project } = seasonal
    ? holtWinters(values, seasonLength)
    : method === 'DRIFT'
      ? drift(values)
      : mean(values);

  const residuals = values.map((value, index) => value - fitted[index]).filter(Number.isFinite);
  const sigma = standardDeviation(residuals);

  const labels =
    options.futurePeriods ??
    Array.from({ length: horizon }, (_, index) => `+${index + 1}`);

  const points: ForecastPoint[] = [];

  for (let step = 1; step <= horizon; step += 1) {
    const point = project(step);
    // The interval widens with the square root of the horizon: forecasting
    // four periods out is not four times as uncertain, but it is not the same
    // as forecasting one.
    const spread = sigma * Math.sqrt(step);

    points.push({
      period: labels[step - 1] ?? `+${step}`,
      point: round(point, 2),
      lower80: round(point - Z80 * spread, 2),
      upper80: round(point + Z80 * spread, 2),
      lower95: round(point - Z95 * spread, 2),
      upper95: round(point + Z95 * spread, 2),
    });
  }

  const caveats = [
    'This is a projection from past figures, not a measurement. It assumes the period ahead resembles ' +
      'the period behind, which an outbreak, a road closure or a strike would break.',
    `The interval is derived from how far this method's own fit missed the observed data ` +
      `(standard deviation ${round(sigma, 2)}). It does not account for anything the data has never seen.`,
  ];

  if (!seasonal && seasonLength > 1) {
    caveats.push(
      `Less than two full seasons of history (${clean.length} periods against ${seasonLength * 2} ` +
        'needed), so no seasonal pattern was fitted. A weekly or annual cycle in this measure is not ' +
        'reflected here.',
    );
  }

  return {
    forecast: points,
    sufficient: true,
    observed: clean,
    method,
    residualStandardDeviation: round(sigma, 4),
    pointsAvailable: clean.length,
    pointsRequired: minimumPoints,
    classification: 'PROJECTED',
    basis:
      method === 'HOLT_WINTERS'
        ? `Holt-Winters additive, season length ${seasonLength}, fitted over ${clean.length} periods.`
        : method === 'DRIFT'
          ? `Linear drift through ${clean.length} observed periods.`
          : `Mean of ${clean.length} observed periods; too few to claim a trend.`,
    caveats,
  };
}

// -----------------------------------------------------------------------------
// The methods
// -----------------------------------------------------------------------------

interface Fitted {
  fitted: number[];
  project: (step: number) => number;
}

function mean(values: readonly number[]): Fitted {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { fitted: values.map(() => average), project: () => average };
}

/** A straight line from the first observation to the last. */
function drift(values: readonly number[]): Fitted {
  const first = values[0];
  const last = values[values.length - 1];
  const slope = (last - first) / (values.length - 1);

  return {
    fitted: values.map((_, index) => first + slope * index),
    project: (step) => last + slope * step,
  };
}

/**
 * Additive Holt-Winters.
 *
 * Fixed smoothing parameters rather than an optimiser: a facility forecasting
 * eight weeks of attendance gains nothing from a fitted alpha, and an optimiser
 * that overfits short noisy series is worse than one that does not try.
 */
function holtWinters(values: readonly number[], seasonLength: number): Fitted {
  const alpha = 0.3;
  const beta = 0.1;
  const gamma = 0.3;

  const seasons = Math.floor(values.length / seasonLength);

  // Initial level and trend from the first two seasons.
  const firstSeason = values.slice(0, seasonLength);
  const secondSeason = values.slice(seasonLength, seasonLength * 2);
  const firstAverage = average(firstSeason);
  const secondAverage = average(secondSeason);

  let level = firstAverage;
  let trend = (secondAverage - firstAverage) / seasonLength;

  const seasonal: number[] = [];
  for (let index = 0; index < seasonLength; index += 1) {
    let total = 0;
    let count = 0;
    for (let season = 0; season < seasons; season += 1) {
      const position = season * seasonLength + index;
      if (position < values.length) {
        total += values[position] - average(values.slice(season * seasonLength, (season + 1) * seasonLength));
        count += 1;
      }
    }
    seasonal.push(count > 0 ? total / count : 0);
  }

  const fitted: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const seasonIndex = index % seasonLength;
    const prediction = level + trend + seasonal[seasonIndex];
    fitted.push(prediction);

    const previousLevel = level;
    level = alpha * (values[index] - seasonal[seasonIndex]) + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    seasonal[seasonIndex] = gamma * (values[index] - level) + (1 - gamma) * seasonal[seasonIndex];
  }

  const finalLevel = level;
  const finalTrend = trend;
  const finalSeasonal = [...seasonal];
  const length = values.length;

  return {
    fitted,
    project: (step) => finalLevel + finalTrend * step + finalSeasonal[(length + step - 1) % seasonLength],
  };
}

// -----------------------------------------------------------------------------
// Stock depletion — a different shape of question
// -----------------------------------------------------------------------------

export interface DepletionInput {
  itemCode: string;
  itemName: string;
  quantityOnHand: number;
  /** Units consumed over the observation window. */
  consumedInWindow: number;
  windowDays: number;
  /** Supplier lead time, where the facility knows it. */
  leadTimeDays: number | null;
}

export interface Depletion {
  itemCode: string;
  itemName: string;
  quantityOnHand: number;
  dailyConsumption: number | null;
  daysToStockOut: number | null;
  /** True when the stock will run out before a reorder could arrive. */
  reorderNow: boolean | null;
  classification: 'PROJECTED';
  note: string;
}

export function projectDepletion(input: DepletionInput): Depletion {
  if (input.windowDays <= 0) {
    throw new RangeError('A consumption window must cover at least one day.');
  }

  if (input.consumedInWindow <= 0) {
    return {
      itemCode: input.itemCode,
      itemName: input.itemName,
      quantityOnHand: input.quantityOnHand,
      dailyConsumption: 0,
      daysToStockOut: null,
      reorderNow: null,
      classification: 'PROJECTED',
      note:
        'Nothing was issued in the observation window, so there is no consumption rate to project ' +
        'from. That may mean the item is not used, or that it has been unavailable and nobody could ' +
        'issue it — this figure cannot tell the two apart.',
    };
  }

  const dailyConsumption = input.consumedInWindow / input.windowDays;
  const daysToStockOut = Math.floor(input.quantityOnHand / dailyConsumption);

  return {
    itemCode: input.itemCode,
    itemName: input.itemName,
    quantityOnHand: input.quantityOnHand,
    dailyConsumption: round(dailyConsumption, 3),
    daysToStockOut,
    reorderNow: input.leadTimeDays === null ? null : daysToStockOut <= input.leadTimeDays,
    classification: 'PROJECTED',
    note:
      `At ${round(dailyConsumption, 2)} unit(s) a day — the rate over the last ${input.windowDays} ` +
      `day(s) — the ${input.quantityOnHand} on hand last about ${daysToStockOut} day(s). ` +
      (input.leadTimeDays === null
        ? 'No lead time is recorded for this item, so whether that is enough to reorder cannot be said.'
        : `The recorded lead time is ${input.leadTimeDays} day(s).`),
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
