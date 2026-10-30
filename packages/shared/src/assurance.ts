import type { GrcChangeDto } from './grc';

/**
 * Assurance (Phase 4.2, module M10 — DECISIONS D-098 onwards): approval of GRC changes, control
 * testing, issues and action plans, audit management, questionnaires and the assurance dashboard.
 */

/** Everything assurance-related waiting for the current user (My tasks). */
export interface AssuranceTasksDto {
  /** Changes of active risks / controls waiting for the user's approval. */
  grcChanges: GrcChangeDto[];
}
