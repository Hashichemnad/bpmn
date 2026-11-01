import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { RTL_LOCALES, type Locale } from '@processhub/shared';
import dayjs from 'dayjs';
import 'dayjs/locale/ar';
import i18n, { rememberLocale, storedLocale } from '@/i18n';

interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  /** True when the user (or browser storage) chose a language explicitly. */
  explicit: boolean;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function applyDocument(locale: Locale) {
  const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  dayjs.locale(locale);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>((i18n.language as Locale) ?? 'en');
  const [explicit, setExplicit] = useState(() => storedLocale() !== null);

  useEffect(() => applyDocument(locale), [locale]);

  const setLocale = useCallback((next: Locale) => {
    rememberLocale(next);
    setExplicit(true);
    // The layout direction switches together with the texts, once the language is loaded.
    void i18n.changeLanguage(next).finally(() => setLocaleState(next));
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr', explicit, setLocale }),
    [locale, explicit, setLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

/** Renders children with another content language (e.g. a bilingual form preview); UI texts stay. */
export function LocaleOverride({ locale, children }: { locale: Locale; children: ReactNode }) {
  const parent = useLocale();
  const value = useMemo<LocaleContextValue>(
    () => ({ ...parent, locale, dir: RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr' }),
    [parent, locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
