import { createContext, useContext } from 'react';

export const AssistantContext = createContext<{ ask: (question?: string) => void } | null>(null);

/** Opens the portal assistant (optionally asking a question right away); null when unavailable. */
export const usePortalAssistant = () => useContext(AssistantContext);
