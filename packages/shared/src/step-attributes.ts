/**
 * Step attributes (Modeler design B2, D-086), stored on BPMN flow nodes as `ph:` attributes:
 *   ph:durationMinutes   planned processing time
 *   ph:waitingMinutes    waiting time before / during the step
 *   ph:slaMinutes        service level (maximum time allowed)
 *   ph:frequencyPerMonth how often the step runs
 *   ph:costPerExecution  cost of one execution (organisation currency)
 *   ph:inputsEn / Ar, ph:outputsEn / Ar   free text, bilingual
 */
export const STEP_NUMBER_ATTRIBUTES = [
  'durationMinutes',
  'waitingMinutes',
  'slaMinutes',
  'frequencyPerMonth',
  'costPerExecution',
] as const;
export type StepNumberAttribute = (typeof STEP_NUMBER_ATTRIBUTES)[number];

export const STEP_TEXT_ATTRIBUTES = ['inputsEn', 'inputsAr', 'outputsEn', 'outputsAr'] as const;
export type StepTextAttribute = (typeof STEP_TEXT_ATTRIBUTES)[number];

/** Upper limits: ten years in minutes, a million runs a month, a trillion per execution. */
export const STEP_NUMBER_MAX: Record<StepNumberAttribute, number> = {
  durationMinutes: 5_256_000,
  waitingMinutes: 5_256_000,
  slaMinutes: 5_256_000,
  frequencyPerMonth: 1_000_000,
  costPerExecution: 1_000_000_000_000,
};
export const STEP_TEXT_MAX = 2000;

export type StepAttributes = Partial<Record<StepNumberAttribute, number>> &
  Partial<Record<StepTextAttribute, string>>;

export interface StepAttributeIssue {
  attribute: StepNumberAttribute | StepTextAttribute;
  code: 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_LARGE' | 'TOO_LONG';
}

/** Reads the step attributes from raw `ph:` attribute values (keys without the prefix). */
export function readStepAttributes(raw: Record<string, string | undefined>): {
  values: StepAttributes;
  issues: StepAttributeIssue[];
} {
  const values: StepAttributes = {};
  const issues: StepAttributeIssue[] = [];
  for (const a of STEP_NUMBER_ATTRIBUTES) {
    const v = raw[a]?.trim();
    if (!v) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) issues.push({ attribute: a, code: 'NOT_A_NUMBER' });
    else if (n < 0) issues.push({ attribute: a, code: 'NEGATIVE' });
    else if (n > STEP_NUMBER_MAX[a]) issues.push({ attribute: a, code: 'TOO_LARGE' });
    else values[a] = n;
  }
  for (const a of STEP_TEXT_ATTRIBUTES) {
    const v = raw[a];
    if (!v?.trim()) continue;
    if (v.length > STEP_TEXT_MAX) issues.push({ attribute: a, code: 'TOO_LONG' });
    else values[a] = v;
  }
  return { values, issues };
}

/** Duration bands of the "colour by duration" view. */
export const DURATION_BANDS = ['none', 'short', 'medium', 'long'] as const;
export type DurationBand = (typeof DURATION_BANDS)[number];
/** none: no time set; short: under 1 hour; medium: up to 1 working day (8 h); long: more. */
export function durationBand(minutes: number | undefined): DurationBand {
  if (minutes === undefined) return 'none';
  if (minutes < 60) return 'short';
  if (minutes <= 480) return 'medium';
  return 'long';
}

/** Minutes split into the largest whole unit (days of 24 h, hours, minutes) for display. */
export function splitMinutes(minutes: number): {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
} {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}
