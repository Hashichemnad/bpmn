import { z } from 'zod';

/**
 * Demo installation marker (D-180), Setting `system.demo`: written by the seed when
 * SEED_DEMO_DATA=true, so administrators see a warning while demo data or the demo API key exists.
 */
export const demoInstallationSchema = z.object({
  seededAt: z.string(),
  /** Demo users created by the seed (one per role). */
  userIds: z.array(z.string()).default([]),
  /** Demo API keys created by the seed (random, printed once in the seed output). */
  apiKeyIds: z.array(z.string()).default([]),
  /** Set by a Super Admin after the demo data was removed (go-live checklist). */
  clearedAt: z.string().nullable().default(null),
  clearedById: z.string().nullable().default(null),
});
export type DemoInstallation = z.infer<typeof demoInstallationSchema>;

export interface DemoStatusDto {
  /** Show the warning banner: demo data not confirmed removed, or demo users / keys still active. */
  warning: boolean;
  seededAt: string | null;
  /** Demo content seeded and not yet confirmed removed by a Super Admin. */
  demoData: boolean;
  activeDemoUsers: number;
  activeDemoApiKeys: number;
  clearedAt: string | null;
}

/** The banner shows while anything of the demo remains. */
export function demoWarning(s: Omit<DemoStatusDto, 'warning'>): boolean {
  return s.demoData || s.activeDemoUsers > 0 || s.activeDemoApiKeys > 0;
}
