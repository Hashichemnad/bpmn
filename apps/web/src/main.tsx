import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './i18n';
import './styles.css';
import { AppProviders, createQueryClient } from './app/AppProviders';
import { createRouter } from './App';

const queryClient = createQueryClient();
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>
  </StrictMode>,
);
