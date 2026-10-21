import {
  AI_DEFAULT_FAST_MODEL,
  AI_DEFAULT_MODEL,
  SYSTEM_ROLE_KEYS,
  type AiProvider,
  type AiSuggestions,
  type SystemRoleKey,
} from '@processhub/shared';

/** Stored in Setting `ai`; the API key only ever as AES-256-GCM ciphertext. */
export interface StoredAiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  fastModel: string;
  apiKeySealed: string | null;
  allowedRoles: SystemRoleKey[];
  userDailyLimit: number;
  orgMonthlyLimit: number;
  noticeEn: string;
  noticeAr: string;
  suggestions: AiSuggestions;
}

export const AI_DEFAULTS: StoredAiSettings = {
  enabled: false,
  provider: 'anthropic',
  model: AI_DEFAULT_MODEL,
  fastModel: AI_DEFAULT_FAST_MODEL,
  apiKeySealed: null,
  allowedRoles: [...SYSTEM_ROLE_KEYS],
  userDailyLimit: 50,
  orgMonthlyLimit: 5000,
  noticeEn:
    'Your prompt and the content it refers to are sent to an external AI service to produce a draft. ' +
    'AI output can be wrong: review it before you save or publish.',
  noticeAr:
    'يُرسَل طلبك والمحتوى المرتبط به إلى خدمة ذكاء اصطناعي خارجية لإعداد مسودة. ' +
    'قد تكون مخرجات الذكاء الاصطناعي غير دقيقة: راجعها قبل الحفظ أو النشر.',
  suggestions: {},
};
