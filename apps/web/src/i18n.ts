import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@processhub/shared';
import enCommon from './locales/en/common.json';
import enAdmin from './locales/en/admin.json';
import enProcesses from './locales/en/processes.json';
import enModeler from './locales/en/modeler.json';
import enObjects from './locales/en/objects.json';
import enErrors from './locales/en/errors.json';
import enDocs from './locales/en/docs.json';
import enSearch from './locales/en/search.json';
import enGovernance from './locales/en/governance.json';
import enPortal from './locales/en/portal.json';
import enAi from './locales/en/ai.json';
import arCommon from './locales/ar/common.json';
import arAdmin from './locales/ar/admin.json';
import arProcesses from './locales/ar/processes.json';
import arModeler from './locales/ar/modeler.json';
import arObjects from './locales/ar/objects.json';
import arErrors from './locales/ar/errors.json';
import arDocs from './locales/ar/docs.json';
import arSearch from './locales/ar/search.json';
import arGovernance from './locales/ar/governance.json';
import arPortal from './locales/ar/portal.json';
import arAi from './locales/ar/ai.json';

export const resources = {
  en: {
    common: enCommon,
    admin: enAdmin,
    processes: enProcesses,
    modeler: enModeler,
    objects: enObjects,
    errors: enErrors,
    docs: enDocs,
    search: enSearch,
    governance: enGovernance,
    portal: enPortal,
    ai: enAi,
  },
  ar: {
    common: arCommon,
    admin: arAdmin,
    processes: arProcesses,
    modeler: arModeler,
    objects: arObjects,
    errors: arErrors,
    docs: arDocs,
    search: arSearch,
    governance: arGovernance,
    portal: arPortal,
    ai: arAi,
  },
} as const;

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
] as const;

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

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLocale() ?? DEFAULT_LOCALE,
  fallbackLng: 'en',
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
  showSupportNotice: false,
});

export default i18n;
