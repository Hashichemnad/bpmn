import { z } from 'zod';

/**
 * Workflow forms (D-146): a ProcessHub form schema rendered with Ant Design in the browser and used
 * on the server to validate submitted data. Labels, help texts and options are bilingual.
 */

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'amount',
  'date',
  'boolean',
  'select',
  'radio',
  'multiselect',
  'user',
  'department',
  'file',
  'info',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_MAX_FIELDS = 60;
export const FORM_TEXT_MAX = 10_000;
export const FORM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/;
/** Names the engine uses itself; form fields cannot overwrite them. */
export const RESERVED_VARIABLES = [
  'decision',
  'comment',
  'initiator',
  'case',
  'process',
  'today',
  'now',
];

const text = (max: number) => z.string().trim().max(max).default('');

export const formOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  labelEn: text(200),
  labelAr: text(200),
});
export type FormOption = z.infer<typeof formOptionSchema>;

export const formFieldSchema = z
  .object({
    key: z.string().regex(FORM_KEY_RE),
    type: z.enum(FORM_FIELD_TYPES),
    labelEn: text(200),
    labelAr: text(200),
    helpEn: text(500),
    helpAr: text(500),
    required: z.boolean().default(false),
    /** Shows the current value of the case variable without letting this step change it. */
    readOnly: z.boolean().default(false),
    min: z.number().finite().nullable().default(null),
    max: z.number().finite().nullable().default(null),
    maxLength: z.number().int().min(1).max(FORM_TEXT_MAX).nullable().default(null),
    /** Currency of `amount` fields (ISO 4217). */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('AED'),
    options: z.array(formOptionSchema).max(100).default([]),
    defaultValue: z
      .union([z.string().max(1000), z.number(), z.boolean()])
      .nullable()
      .default(null),
  })
  .refine((f) => !['select', 'radio', 'multiselect'].includes(f.type) || f.options.length > 0, {
    message: 'OPTIONS_REQUIRED',
    path: ['options'],
  })
  .refine((f) => !RESERVED_VARIABLES.includes(f.key), { message: 'RESERVED_KEY', path: ['key'] });
export type FormField = z.infer<typeof formFieldSchema>;
export type FormFieldInput = z.input<typeof formFieldSchema>;

export const formSchema = z
  .object({ fields: z.array(formFieldSchema).max(FORM_MAX_FIELDS).default([]) })
  .refine((f) => new Set(f.fields.map((x) => x.key)).size === f.fields.length, {
    message: 'DUPLICATE_KEY',
    path: ['fields'],
  });
export type FormSchema = z.infer<typeof formSchema>;
export type FormSchemaInput = z.input<typeof formSchema>;

export type FormErrorCode =
  'REQUIRED' | 'TYPE' | 'MIN' | 'MAX' | 'MAX_LENGTH' | 'OPTION' | 'UNKNOWN_FIELD';
export interface FormError {
  key: string;
  code: FormErrorCode;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fields that carry a value (not info texts, not read-only). */
export const inputFields = (form: FormSchema) =>
  form.fields.filter((f) => f.type !== 'info' && !f.readOnly);

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Validates and normalises submitted form data on the server: unknown keys are rejected, types coerced
 * (numbers from numeric strings), limits enforced. Read-only and info fields are ignored.
 * `draft: true` skips the required check (saving a task without completing it).
 */
export function validateFormData(
  form: FormSchema,
  data: Record<string, unknown>,
  opts: { draft?: boolean } = {},
): { values: Record<string, unknown>; errors: FormError[] } {
  const errors: FormError[] = [];
  const values: Record<string, unknown> = {};
  const fields = inputFields(form);
  const known = new Set(form.fields.map((f) => f.key));
  for (const k of Object.keys(data ?? {}))
    if (!known.has(k)) errors.push({ key: k, code: 'UNKNOWN_FIELD' });
  for (const f of fields) {
    let v = data?.[f.key];
    if (isEmpty(v)) {
      if (f.required && !opts.draft && f.type !== 'boolean')
        errors.push({ key: f.key, code: 'REQUIRED' });
      if (f.type === 'boolean')
        values[f.key] = v === undefined || v === null || v === '' ? false : v;
      else values[f.key] = f.type === 'multiselect' || f.type === 'file' ? [] : null;
      if (f.type === 'boolean' && f.required && !opts.draft && values[f.key] !== true)
        errors.push({ key: f.key, code: 'REQUIRED' });
      continue;
    }
    switch (f.type) {
      case 'text':
      case 'textarea': {
        if (typeof v !== 'string') {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        v = v.trim();
        const max = f.maxLength ?? (f.type === 'text' ? 500 : FORM_TEXT_MAX);
        if ((v as string).length > max) errors.push({ key: f.key, code: 'MAX_LENGTH' });
        if (f.required && !opts.draft && !(v as string))
          errors.push({ key: f.key, code: 'REQUIRED' });
        values[f.key] = v;
        break;
      }
      case 'number':
      case 'amount': {
        const n =
          typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
        if (!Number.isFinite(n)) {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        if (f.min !== null && n < f.min) errors.push({ key: f.key, code: 'MIN' });
        if (f.max !== null && n > f.max) errors.push({ key: f.key, code: 'MAX' });
        values[f.key] = n;
        break;
      }
      case 'date': {
        if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(v))) {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        values[f.key] = v;
        break;
      }
      case 'boolean':
        if (typeof v !== 'boolean') {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        if (f.required && !opts.draft && v !== true) errors.push({ key: f.key, code: 'REQUIRED' });
        values[f.key] = v;
        break;
      case 'select':
      case 'radio':
        if (typeof v !== 'string' || !f.options.some((o) => o.value === v)) {
          errors.push({ key: f.key, code: 'OPTION' });
          continue;
        }
        values[f.key] = v;
        break;
      case 'multiselect':
        if (
          !Array.isArray(v) ||
          v.some((x) => typeof x !== 'string' || !f.options.some((o) => o.value === x))
        ) {
          errors.push({ key: f.key, code: 'OPTION' });
          continue;
        }
        values[f.key] = [...new Set(v as string[])];
        break;
      case 'user':
      case 'department':
        if (typeof v !== 'string' || !UUID.test(v)) {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        values[f.key] = v.toLowerCase();
        break;
      case 'file':
        if (
          !Array.isArray(v) ||
          v.length > 20 ||
          v.some((x) => typeof x !== 'string' || !UUID.test(x))
        ) {
          errors.push({ key: f.key, code: 'TYPE' });
          continue;
        }
        values[f.key] = v;
        break;
      case 'info':
        break;
    }
  }
  return { values, errors };
}

/** Initial values of a form: case variables for known keys, else the field default. */
export function initialFormValues(
  form: FormSchema,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form.fields) {
    if (f.type === 'info') continue;
    if (vars[f.key] !== undefined && vars[f.key] !== null) out[f.key] = vars[f.key];
    else if (f.defaultValue !== null) out[f.key] = f.defaultValue;
  }
  return out;
}

/** Label in the user's language with fallback. */
export const fieldLabel = (f: Pick<FormField, 'labelEn' | 'labelAr' | 'key'>, locale: string) =>
  (locale === 'ar' ? f.labelAr || f.labelEn : f.labelEn || f.labelAr) || f.key;
