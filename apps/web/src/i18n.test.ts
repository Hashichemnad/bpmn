import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  CALLOUT_TYPES,
  GIT_ENTITY_TYPES,
  GIT_ERROR_CODES,
  GIT_SYNC_STATUSES,
  SEARCH_TYPES,
  SPACE_ACCESS_LEVELS,
  SPACE_PRINCIPAL_TYPES,
  LINK_RELATIONS,
  OBJECT_TYPES,
  PROCESS_CATEGORIES,
  PROCESS_STATUSES,
  SYSTEM_ROLE_KEYS,
  APPROVAL_RULES,
  ASSIGNEE_TYPES,
  CONTENT_TYPES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  INVOLVEMENT_REASONS,
  NOTIFICATION_TYPES,
  REVIEW_DATE_STATES,
  REVIEW_DECISIONS,
  REVIEW_STATUSES,
  REVIEW_TASK_STATUSES,
  WORKFLOW_SOURCES,
  AI_ERROR_CODES,
  AI_FEATURES,
  AI_PROVIDERS,
} from '@processhub/shared';
import { resources } from './i18n';

type Tree = { [k: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}

function keySet(locale: 'en' | 'ar'): Set<string> {
  const keys = new Set<string>();
  for (const [ns, tree] of Object.entries(resources[locale])) {
    for (const k of flatten(tree as Tree)) keys.add(`${ns}:${k.replace(PLURAL, '')}`);
  }
  return keys;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const en = keySet('en');
const ar = keySet('ar');

describe('translations', () => {
  it('English and Arabic define the same keys', () => {
    expect([...en].filter((k) => !ar.has(k))).toEqual([]);
    expect([...ar].filter((k) => !en.has(k))).toEqual([]);
  });

  it('every static key used in the code exists', () => {
    const missing: string[] = [];
    for (const file of walk(join(__dirname))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
        const key = m[1].includes(':') ? m[1] : `common:${m[1]}`;
        if (!en.has(key)) missing.push(`${key} (${file.split('/src/')[1]})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dynamic keys built from shared constants exist', () => {
    const expected = [
      ...SYSTEM_ROLE_KEYS.map((r) => `admin:roles.${r}`),
      ...AUDIT_ACTIONS.map((a) => `admin:audit.actions.${a}`),
      ...AUDIT_ENTITY_TYPES.map((e) => `admin:audit.entities.${e}`),
      ...['ACTIVE', 'INACTIVE'].map((s) => `admin:status.${s}`),
      ...PROCESS_CATEGORIES.flatMap((c) => [
        `processes:category.${c}`,
        `processes:house.bandHint.${c}`,
      ]),
      ...PROCESS_STATUSES.map((s) => `processes:status.${s}`),
      ...OBJECT_TYPES.flatMap((o) => [
        `objects:types.${o}`,
        `objects:new.${o}`,
        `objects:edit.${o}`,
      ]),
      ...LINK_RELATIONS.map((r) => `objects:relations.${r}`),
      ...['ROLE', 'SYSTEM', 'DOCUMENT'].flatMap((o) => [
        `objects:library.${o}.title`,
        `objects:library.${o}.subtitle`,
        `objects:library.${o}.empty`,
        `modeler:add.${o}`,
        `modeler:linked.${o}`,
      ]),
      ...['TOO_SHORT', 'MISSING_UPPER', 'MISSING_LOWER', 'MISSING_DIGIT', 'MISSING_SYMBOL'].map(
        (e) => `common:validation.password.${e}`,
      ),
      ...[
        'NO_START_EVENT',
        'NO_END_EVENT',
        'UNCONNECTED_ELEMENT',
        'MISSING_INCOMING',
        'MISSING_OUTGOING',
        'UNNAMED_ACTIVITY',
        'GATEWAY_NOT_BRANCHING',
        'CALL_ACTIVITY_UNLINKED',
      ].map((c) => `modeler:rules.${c}`),
      ...GIT_ERROR_CODES.map((c) => `errors:${c}`),
      ...GIT_SYNC_STATUSES.map((s) => `admin:git.status.${s}`),
      ...GIT_ENTITY_TYPES.map((e) => `admin:git.entity.${e}`),
      'admin:git.tokenHintGithub',
      'admin:git.tokenHintGitlab',
      ...CALLOUT_TYPES.map((c) => `docs:callout.${c}`),
      ...SPACE_PRINCIPAL_TYPES.map((p) => `docs:permissions.principal.${p}`),
      ...SPACE_ACCESS_LEVELS.map((a) => `docs:permissions.access.${a}`),
      ...['PROCESS', 'ROLE', 'SYSTEM'].map((k) => `docs:links.kind.${k}`),
      ...['added', 'removed', 'changed', 'layout'].map((k) => `docs:compare.kind.${k}`),
      ...['p', 'h1', 'h2', 'h3', 'h4'].map((b) => `docs:editor.blocks.${b}`),
      ...SEARCH_TYPES.map((s) => `search:types.${s}`),
      // Governance and Knowledge Portal
      ...APPROVAL_RULES.map((r) => `governance:rule.${r}`),
      ...ASSIGNEE_TYPES.map((a) => `governance:assignee.${a}`),
      ...CONTENT_TYPES.flatMap((c) => [`governance:type.${c}`, `governance:dashboard.counts.${c}`]),
      ...FEEDBACK_KINDS.map((k) => `governance:feedback.kind.${k}`),
      ...FEEDBACK_STATUSES.map((s) => `governance:feedback.status.${s}`),
      ...INVOLVEMENT_REASONS.map((r) => `portal:my.reason.${r}`),
      ...NOTIFICATION_TYPES.filter((n) => n !== 'REVIEW_OVERDUE').map(
        (n) => `governance:notifications.title.${n}`,
      ),
      'governance:notifications.title.REVIEW_OVERDUE_task',
      'governance:notifications.title.REVIEW_OVERDUE_periodic',
      ...NOTIFICATION_TYPES.map((n) => `governance:prefs.types.${n}`),
      ...REVIEW_DATE_STATES.map((s) => `governance:reviewState.${s}`),
      ...REVIEW_DECISIONS.flatMap((d) => [
        `governance:decision.${d}`,
        `governance:decisionHint.${d}`,
      ]),
      ...REVIEW_STATUSES.map((s) => `governance:reviewStatus.${s}`),
      ...REVIEW_TASK_STATUSES.map((s) => `governance:taskStatus.${s}`),
      ...WORKFLOW_SOURCES.map((s) => `governance:workflowSource.${s}`),
      ...['WAITING', 'ACTIVE', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'CANCELLED'].map(
        (s) => `governance:stepState.${s}`,
      ),
      ...['reviews', 'toPublish', 'returned', 'dueReviews', 'mentions', 'feedback'].flatMap((k) => [
        `governance:tasks.tabs.${k}`,
        `governance:tasks.empty.${k}`,
      ]),
      ...['ROLE', 'SYSTEM', 'DOCUMENT', 'RISK', 'CONTROL', 'KPI'].map(
        (o) => `portal:process.linked.${o}`,
      ),
      'governance:status.changesRequested',
      'governance:status.rejected',
      'errors:ITEM_IN_REVIEW',
      'errors:ITEM_ARCHIVED',
      // AI assistant
      ...AI_ERROR_CODES.map((c) => `errors:${c}`),
      ...AI_FEATURES.map((f) => `ai:features.${f}`),
      ...AI_PROVIDERS.map((p) => `ai:settings.providers.${p}`),
      ...['PERFORMS', 'SUPPORTS'].map((r) => `ai:generate.relation.${r}`),
      ...['SOP', 'WORK_INSTRUCTION'].map((k) => `ai:doc.templates.${k}`),
      ...['en', 'ar'].flatMap((l) => [
        `ai:translate.labelsTitle.${l}`,
        `ai:translate.pageTitle.${l}`,
        `ai:translate.fillFrom.${l}`,
        `ai:translate.target.${l}`,
        `ai:translate.fieldsTo.${l}`,
      ]),
    ];
    expect(expected.filter((k) => !en.has(k))).toEqual([]);
  });

  it('every error code raised by the API is translated', () => {
    const apiSrc = join(__dirname, '../../api/src');
    const codes = new Set<string>();
    for (const file of walk(apiSrc)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:badRequest|conflict)\(\s*'([A-Z_]+)'/g)) codes.add(m[1]);
      for (const m of src.matchAll(/HttpStatus\.\w+,\s*'([A-Z_]+)'/g)) codes.add(m[1]);
      for (const m of src.matchAll(/code: '([A-Z_]+)'/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(20);
    expect([...codes].filter((c) => !en.has(`errors:${c}`))).toEqual([]);
  });
});
