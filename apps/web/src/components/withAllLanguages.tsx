import type { ComponentType } from 'react';
import { useAllLanguages } from '@/i18n';
import { LoadingState } from './states';

/**
 * Renders the component once the texts of both languages are loaded (only the active language is
 * loaded at start-up). For components that write bilingual content — labels in English and Arabic
 * — or print in a language other than the user's (final session, part A).
 */
export function withAllLanguages<P extends object>(
  Component: ComponentType<P>,
  fallback: 'loading' | 'none' = 'loading',
): ComponentType<P> {
  function WithAllLanguages(props: P) {
    const ready = useAllLanguages();
    if (!ready) return fallback === 'loading' ? <LoadingState /> : null;
    return <Component {...props} />;
  }
  WithAllLanguages.displayName = `withAllLanguages(${Component.displayName ?? Component.name})`;
  return WithAllLanguages;
}
