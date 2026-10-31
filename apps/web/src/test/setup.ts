import '@testing-library/jest-dom/vitest';
import i18n from '../i18n';
import { resources } from '../locales/resources';

// Tests get every translation synchronously (the app loads the active language on demand).
for (const [lng, bundles] of Object.entries(resources))
  for (const [ns, data] of Object.entries(bundles))
    i18n.addResourceBundle(lng, ns, data, true, true);

// jsdom lacks matchMedia, used by Ant Design's responsive utilities.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
