import { createContext, useContext } from 'react';

/**
 * Where wiki content is rendered. In the Knowledge Portal embedded diagrams show the published
 * version and files are served by the portal endpoints.
 */
export const RenderModeContext = createContext<'workspace' | 'portal'>('workspace');
export const useRenderMode = () => useContext(RenderModeContext);

/** Points attachment URLs of published content at the portal endpoint. */
export const toPortalAttachments = (html: string) =>
  html.replace(
    /\/api\/v1\/attachments\/([0-9a-f-]{36})\/content/gi,
    '/api/v1/portal/attachments/$1/content',
  );
