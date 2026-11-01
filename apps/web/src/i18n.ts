import i18n, { type BackendModule, type ReadCallback } from 'i18next';
import { useEffect, useState } from 'react';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@processhub/shared';

/** Namespaces of the translation files `src/locales/{en,ar}/<namespace>.json`. */
export const NAMESPACES = [
  'common',
  'admin',
  'processes',
  'modeler',
  'objects',
  'errors',
  'docs',
  'search',
  'governance',
  'portal',
  'ai',
  'grc',
  'assurance',
  'ea',
  'kpi',
  'diagrams',
  'mining',
  'workflow',
  'imports',
  'integrations',
] as const;

// One chunk per language and namespace, fetched only for the active language (final session,
// part A): the other language is not downloaded until the user switches. Keys are complete in both
// languages (CI check), so no fallback language is loaded.
const files = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  import: 'default',
});

const lazyBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language: string, namespace: string, callback: ReadCallback) {
    const load = files[`./locales/${language}/${namespace}.json`];
    if (!load) return callback(null, {});
    load().then(
      (data) => callback(null, data),
      (err: Error) => callback(err, null),
    );
  },
};

const STORAGE_KEY = 'ph.locale';

export function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : null;
  } catch {
    return null;
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable */
  }
}

/** Resolves once the active language is loaded; the app renders after it (main.tsx). */
export const i18nReady = i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: storedLocale() ?? DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    fallbackLng: false,
    load: 'currentOnly',
    ns: NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    showSupportNotice: false,
  });

export default i18n;

const allLoaded = () =>
  LOCALES.every((lng) => NAMESPACES.every((ns) => i18n.hasResourceBundle(lng, ns)));
let allLanguages: Promise<void> | null = null;

/**
 * Loads every language (the active one is loaded at start-up; the other one follows in the
 * background after the first screen, see main.tsx). Bilingual features — labels created in both
 * languages, printing in the other language — wait for it with `useAllLanguages`.
 */
export function loadAllLanguages(): Promise<void> {
  if (allLoaded()) return Promise.resolve();
  return (allLanguages ??= i18n.loadLanguages([...LOCALES]).then(() => undefined));
}

/** True once both languages' texts are available (loads them on first use). */
export function useAllLanguages(): boolean {
  const [ready, setReady] = useState(allLoaded);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadAllLanguages().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}
