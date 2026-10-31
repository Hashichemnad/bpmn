import { z } from 'zod';
import {
  LOCALES,
  SYSTEM_ROLE_KEYS,
  type ContentType,
  type Locale,
  type ObjectType,
  type SystemRoleKey,
} from './constants';

// ---------- AI Assistant (M16) ----------

export const AI_PROVIDERS = ['anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Features of the assistant; each request is logged with one of these. */
export const AI_FEATURES = [
  'GENERATE_PROCESS',
  'REFINE_PROCESS',
  'GENERATE_DOC',
  'DOC_TO_PROCESS',
  'TRANSLATE',
  'ANALYSE',
  'SUMMARISE',
  'PORTAL_QA',
  'TEST_CONNECTION',
  /** Risk & Compliance: control gaps of a process (Phase 4.1). */
  'CONTROL_GAPS',
  /** Process mining (Phase 5.1): explain simulation results, propose improvement scenarios. */
  'SIMULATION',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Features that offer suggestion chips (sample prompts) in the UI. */
export const AI_SUGGESTION_FEATURES = [
  'GENERATE_PROCESS',
  'REFINE_PROCESS',
  'GENERATE_DOC',
  'ANALYSE',
  'SUMMARISE',
  'PORTAL_QA',
] as const;
export type AiSuggestionFeature = (typeof AI_SUGGESTION_FEATURES)[number];

export const AI_USAGE_STATUSES = ['SUCCESS', 'ERROR', 'INVALID_OUTPUT'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/** Machine-readable AI errors; translated in the web client (errors.json). */
export const AI_ERROR_CODES = [
  'AI_DISABLED',
  'AI_NOT_ALLOWED',
  'AI_NOT_CONFIGURED',
  'AI_USER_LIMIT',
  'AI_ORG_LIMIT',
  'AI_AUTH_FAILED',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_ERROR',
  'AI_TIMEOUT',
  'AI_REFUSED',
  'AI_INVALID_OUTPUT',
  'AI_INPUT_TOO_LARGE',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const AI_DEFAULT_FAST_MODEL = 'claude-haiku-5-5';
/** Longest free-text prompt a user can send (characters). */
export const AI_PROMPT_MAX_CHARS = 4000;
/** Largest document (HTML/text characters) sent to the assistant in one request. */
export const AI_DOCUMENT_MAX_CHARS = 60_000;
export const AI_MAX_SUGGESTIONS = 6;

const modelName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:@/-]+$/, 'Invalid model name');

const bilingualText = (max: number) =>
  z.object({ en: z.string().trim().max(max), ar: z.string().trim().max(max) });

export const aiSuggestionSchema = bilingualText(300).refine((s) => !!(s.en || s.ar), {
  error: 'Empty suggestion',
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDERS),
  model: modelName,
  fastModel: modelName,
  /** New API key; empty keeps the stored one. Never returned by the API. */
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  allowedRoles: z.array(z.enum(SYSTEM_ROLE_KEYS)).max(SYSTEM_ROLE_KEYS.length),
  /** Requests per user per day (UTC); 0 = no limit. */
  userDailyLimit: z.number().int().min(0).max(100_000),
  /** Requests for the whole organisation per calendar month (UTC); 0 = no limit. */
  orgMonthlyLimit: z.number().int().min(0).max(10_000_000),
  noticeEn: z.string().trim().max(1000),
  noticeAr: z.string().trim().max(1000),
  suggestions: z
    .object(
      Object.fromEntries(
        AI_SUGGESTION_FEATURES.map((f) => [f, z.array(aiSuggestionSchema).max(AI_MAX_SUGGESTIONS)]),
      ) as Record<AiSuggestionFeature, z.ZodArray<typeof aiSuggestionSchema>>,
    )
    .partial()
    .default({}),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export type AiSuggestions = Partial<Record<AiSuggestionFeature, AiSuggestion[]>>;

export interface AiSettingsDto {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  fastModel: string;
  hasApiKey: boolean;
  /** False when INTEGRATIONS_ENCRYPTION_KEY is missing (the key cannot be stored). */
  encryptionAvailable: boolean;
  allowedRoles: SystemRoleKey[];
  userDailyLimit: number;
  orgMonthlyLimit: number;
  noticeEn: string;
  noticeAr: string;
  suggestions: AiSuggestions;
}

export interface AiTestResultDto {
  ok: boolean;
  code: AiErrorCode | null;
  message: string | null;
  model: string | null;
}

/** What the current user may do with the assistant (drives every "✨ AI" button). */
export interface AiStatusDto {
  available: boolean;
  /** Why it is not available (null when available). */
  reason: 'DISABLED' | 'NOT_ALLOWED' | 'NOT_CONFIGURED' | null;
  noticeEn: string;
  noticeAr: string;
  usedToday: number;
  dailyLimit: number;
  suggestions: AiSuggestions;
}

export const aiUsageQuerySchema = z.object({
  /** YYYY-MM (UTC); defaults to the current month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export interface AiUsageTotalsDto {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
}

export interface AiUsageReportDto {
  month: string;
  totals: AiUsageTotalsDto;
  orgMonthlyLimit: number;
  byUser: (AiUsageTotalsDto & {
    user: { id: string; email: string; nameEn: string; nameAr: string } | null;
  })[];
  byFeature: (AiUsageTotalsDto & { feature: AiFeature })[];
  byModel: (AiUsageTotalsDto & { model: string })[];
  /** The last 12 months, oldest first. */
  byMonth: (AiUsageTotalsDto & { month: string })[];
}

// ---------- Requests ----------

const prompt = z.string().trim().min(3).max(AI_PROMPT_MAX_CHARS);
const optionalPrompt = z.string().trim().max(AI_PROMPT_MAX_CHARS).optional();
const bpmnXmlInput = z
  .string()
  .min(1)
  .max(5 * 1024 * 1024);
const localeInput = z.enum(LOCALES);

/** Feature 1: generate a process from a description. */
export const aiGenerateProcessSchema = z.object({
  description: prompt,
  /** Language the user wrote in (labels are produced in both). */
  language: localeInput,
  /** Existing process the result is for (modeler); omitted in the "New process" dialog. */
  processId: z.guid().optional(),
});
export type AiGenerateProcessInput = z.infer<typeof aiGenerateProcessSchema>;

/** Feature 4: translate. Fields, BPMN labels or a page into the target language. */
export const aiTranslateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fields'),
    target: localeInput,
    fields: z
      .array(z.object({ key: z.string().min(1).max(50), text: z.string().max(5000) }))
      .min(1)
      .max(20),
  }),
  z.object({ kind: z.literal('bpmn'), target: localeInput, bpmnXml: bpmnXmlInput }),
  z.object({
    kind: z.literal('page'),
    target: localeInput,
    title: z.string().max(300),
    html: z.string().max(AI_DOCUMENT_MAX_CHARS),
  }),
]);
export type AiTranslateInput = z.infer<typeof aiTranslateSchema>;

/** Feature 2: refine the diagram with a chat instruction. */
export const aiRefineProcessSchema = z.object({
  processId: z.guid(),
  bpmnXml: bpmnXmlInput,
  instruction: prompt,
  language: localeInput,
  /** Earlier turns of this chat (instructions and the assistant's explanations). */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(20)
    .default([]),
});
export type AiRefineProcessInput = z.infer<typeof aiRefineProcessSchema>;

export const AI_DOC_TEMPLATES = ['SOP', 'WORK_INSTRUCTION'] as const;
export type AiDocTemplate = (typeof AI_DOC_TEMPLATES)[number];

/** Feature 3a: documentation page from a process. */
export const aiGenerateDocSchema = z.object({
  processId: z.guid(),
  template: z.enum(AI_DOC_TEMPLATES),
  instructions: optionalPrompt,
});
export type AiGenerateDocInput = z.infer<typeof aiGenerateDocSchema>;

/** Feature 3b: process draft from a wiki page. */
export const aiDocToProcessSchema = z.object({
  pageId: z.guid(),
  language: localeInput,
  instructions: optionalPrompt,
});
export type AiDocToProcessInput = z.infer<typeof aiDocToProcessSchema>;

/** Feature 5: analyse a process. */
export const aiAnalyseSchema = z.object({
  processId: z.guid(),
  /** The diagram as shown in the modeler (may contain unsaved changes). */
  bpmnXml: bpmnXmlInput.optional(),
  language: localeInput,
  /** Validation warnings shown in the modeler, to be explained in plain language. */
  warnings: z
    .array(
      z.object({
        code: z.string().max(50),
        elementId: z.string().max(200).optional(),
        elementName: z.string().max(300).optional(),
      }),
    )
    .max(50)
    .default([]),
  focus: optionalPrompt,
});
export type AiAnalyseInput = z.infer<typeof aiAnalyseSchema>;

export const aiControlGapsSchema = z.object({
  processId: z.guid(),
  /** The diagram as shown in the modeler (may contain unsaved changes). */
  bpmnXml: bpmnXmlInput.optional(),
  language: localeInput,
});
export type AiControlGapsInput = z.infer<typeof aiControlGapsSchema>;

/** Feature 6: summarise an item, or what changed between two versions. */
export const aiSummariseSchema = z.object({
  type: z.enum(['PROCESS', 'PAGE']),
  id: z.guid(),
  language: localeInput,
  /** Compare two saved versions (version numbers); omitted = summarise the current content. */
  compare: z.object({ from: z.number().int().min(0), to: z.number().int().min(1) }).optional(),
  /** Review screen: summarise the changes of this review against the published version. */
  reviewId: z.guid().optional(),
  instructions: optionalPrompt,
});
export type AiSummariseInput = z.infer<typeof aiSummariseSchema>;

/** Feature 7: question to the portal assistant. */
export const aiPortalQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  language: localeInput,
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(10)
    .default([]),
});
export type AiPortalQuestionInput = z.infer<typeof aiPortalQuestionSchema>;

// ---------- Results ----------

export interface AiObjectRef {
  id: string;
  type: ObjectType;
  code: string | null;
  nameEn: string;
  nameAr: string;
}

/** A link to a library object proposed for a generated BPMN element (confirmed by the user). */
export interface AiSuggestedLinkDto {
  elementId: string;
  elementNameEn: string;
  elementNameAr: string;
  object: AiObjectRef;
  relation: 'PERFORMS' | 'SUPPORTS';
}

export interface AiGeneratedProcessDto {
  bpmnXml: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  /** Short explanation of what was built / changed, in the user's language. */
  explanation: string;
  suggestedLinks: AiSuggestedLinkDto[];
  /** Roles and systems the assistant named that are not in the library. */
  unmatched: { type: 'ROLE' | 'SYSTEM'; nameEn: string; nameAr: string }[];
  /** Validation findings of the generated diagram (codes of validateBpmnGraph). */
  warnings: string[];
  /** Refinement: elements of the current diagram the assistant cannot edit (dropped on accept). */
  dropped: number;
  counts: { lanes: number; tasks: number; gateways: number; events: number; flows: number };
}

export interface AiTranslationDto {
  kind: 'fields' | 'bpmn' | 'page';
  target: Locale;
  /** kind=fields: translated text per key. */
  fields?: Record<string, string>;
  /** kind=bpmn: translated label / description per element id. */
  elements?: { id: string; source: string; name: string; description: string }[];
  /** kind=page: translated title and sanitised HTML. */
  title?: string;
  html?: string;
}

export interface AiGeneratedDocDto {
  titleEn: string;
  titleAr: string;
  /** Sanitised HTML. */
  contentEn: string;
  contentAr: string;
  template: AiDocTemplate;
  processId: string;
}

export interface AiSummaryDto {
  kind: 'SUMMARY' | 'CHANGES';
  /** Streamed text: a sentence and "- " bullet lines. Empty when nothing changed. */
  text: string;
  noChanges: boolean;
  /** Compared versions (0 = nothing before). */
  from?: number;
  to?: number;
}

export const AI_FINDING_KINDS = [
  'MISSING_STEP',
  'UNCLEAR_RESPONSIBILITY',
  'BOTTLENECK',
  'RISK',
  'CONTROL',
  'IMPROVEMENT',
] as const;
export type AiFindingKind = (typeof AI_FINDING_KINDS)[number];

export interface AiAnalysisDto {
  summary: string;
  findings: {
    kind: AiFindingKind;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    explanation: string;
    suggestion: string;
    elementIds: string[];
  }[];
  warnings: { code: string; elementId: string | null; explanation: string }[];
}

export interface AiSourceDto {
  /** The number the answer cites, e.g. 2 for "[2]". */
  ref: number;
  type: ContentType;
  id: string;
  code: string | null;
  titleEn: string;
  titleAr: string;
  versionLabel: string | null;
}

export interface AiAnswerDto {
  answer: string;
  /** False when the published content does not answer the question. */
  answered: boolean;
  sources: AiSourceDto[];
}

/**
 * Server-Sent Events of a streamed AI request: `delta` (text as it is written), `progress`
 * (characters of structured output received), then exactly one `result` or `error`.
 */
export type AiStreamEvent<T> =
  | { event: 'delta'; data: { text: string } }
  | { event: 'progress'; data: { chars: number } }
  | { event: 'result'; data: T }
  | {
      event: 'error';
      data: { code: AiErrorCode | 'ERROR'; message: string; details?: unknown };
    };

// ---------- Terminology helpers (pure; used for library matching and glossaries) ----------

/**
 * Normalises a name for matching: lower case, Arabic letter variants unified (alef forms,
 * taa marbuta, alef maqsura), diacritics, tatweel and punctuation removed.
 */
export function normalizeTerm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface NamedEntry {
  code?: string | null;
  nameEn: string;
  nameAr: string;
}

/**
 * Best library entry for a name the assistant used: an exact match of the normalised English or
 * Arabic name or code, otherwise the only entry whose words are all contained in the name
 * (e.g. "IT Support team" → "IT Support"). Null when nothing or more than one entry fits.
 */
export function matchByName<T extends NamedEntry>(
  names: { en: string; ar: string },
  entries: readonly T[],
): T | null {
  const wanted = [names.en, names.ar].map(normalizeTerm).filter(Boolean);
  if (!wanted.length) return null;
  const keys = (e: T) => [e.nameEn, e.nameAr, e.code ?? ''].map(normalizeTerm).filter(Boolean);
  const exact = entries.filter((e) => keys(e).some((k) => wanted.includes(k)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const words = (s: string) => new Set(s.split(' '));
  const contained = entries.filter((e) =>
    keys(e).some((k) => {
      const kw = [...words(k)];
      return kw.length > 0 && wanted.some((w) => kw.every((x) => words(w).has(x)));
    }),
  );
  return contained.length === 1 ? contained[0] : null;
}
