/** Form rules for a six-digit authenticator code. */
export const codeRules = (t: (k: string) => string) => [
  { required: true, message: t('validation.required') },
  { pattern: /^\d{6}$/, message: t('auth.mfa.codeFormat') },
];
