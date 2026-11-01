/**
 * Entry of the server-side diagram renderer (Phase 4.4, D-172). The `renderer` container opens this
 * page in headless Chromium and calls `window.phRender(...)`: the same bpmn-js / diagram-js code,
 * ProcessHub renderer and self-hosted fonts as the app draw the diagram, so exports and e-mails show
 * exactly what users see (Arabic labels and right-to-left text included). No React, no API calls.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import { renderRequest, type RenderRequest, type RenderResult } from './render-core';

declare global {
  interface Window {
    phRender: (req: RenderRequest) => Promise<RenderResult>;
    phRenderReady: boolean;
  }
}

window.phRender = renderRequest;
window.phRenderReady = true;
