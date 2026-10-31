import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  buildTree,
  type AppLifecycle,
  type CapabilityDto,
  type Criticality,
  type DataClassification,
  type EaStepDto,
  type TreeNode,
} from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useCapabilities } from '@/api/ea';
import { useLocalized } from '@/components/i18n-helpers';
/** What the signed-in user may do in the architecture workspace (the server checks again). */
export function useEaAccess() {
  const { can } = useAuth();
  return {
    canRead: can(PERMISSIONS.EA_READ),
    canEdit: can(PERMISSIONS.EA_EDIT),
    canAdmin: can(PERMISSIONS.EA_ADMIN),
  };
}

export const LIFECYCLE_COLORS: Record<AppLifecycle, string> = {
  PLANNED: 'blue',
  ACTIVE: 'green',
  PHASING_OUT: 'orange',
  RETIRED: 'default',
};
/** Same colours as hex values (diagrams, map tiles). */
export const LIFECYCLE_HEX: Record<AppLifecycle, string> = {
  PLANNED: '#1677ff',
  ACTIVE: '#389e0d',
  PHASING_OUT: '#d46b08',
  RETIRED: '#8c8c8c',
};
export const CRITICALITY_COLORS: Record<Criticality, string> = {
  LOW: 'default',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
};
export const CLASSIFICATION_COLORS: Record<DataClassification, string> = {
  PUBLIC: 'green',
  INTERNAL: 'blue',
  CONFIDENTIAL: 'orange',
  SECRET: 'red',
};

/** Select options of an enum with labels from `ea:<group>.<VALUE>`. */
export function useEnumOptions(group: string, values: readonly string[]) {
  const { t } = useTranslation();
  return useMemo(
    () => values.map((v) => ({ value: v, label: t(`ea:${group}.${v}`) })),
    [t, group, values],
  );
}

/** "CODE Name" of an architecture item in the active language. */
export function useEaLabel() {
  const loc = useLocalized();
  return (r: { code: string | null; nameEn: string; nameAr: string } | null | undefined) =>
    r ? [r.code, loc(r)].filter(Boolean).join(' · ') || '—' : '—';
}

export const applicationPath = (id: string) => `/ea/applications/${id}`;

/** Modeler deep link of a step (the process page for whole-process links). */
export function eaStepHref(s: Pick<EaStepDto, 'process' | 'bpmnElementId'>) {
  return s.bpmnElementId === PROCESS_ELEMENT_ID
    ? `/processes/${s.process.id}`
    : `/processes/${s.process.id}/model?element=${encodeURIComponent(s.bpmnElementId)}`;
}

/** Capabilities as TreeSelect data ("code name"); `maxLevel` limits the levels offered. */
export function useCapabilityTreeData(opts: { exclude?: string; maxLevel?: number } = {}) {
  const caps = useCapabilities();
  const label = useEaLabel();
  return useMemo(() => {
    type Node = { title: string; value: string; disabled?: boolean; children: Node[] };
    const map = (nodes: TreeNode<CapabilityDto>[]): Node[] =>
      nodes.map((c) => ({
        title: label(c),
        value: c.id,
        disabled: c.id === opts.exclude || (opts.maxLevel ? c.level > opts.maxLevel : false),
        children: c.id === opts.exclude ? [] : map(c.children),
      }));
    return map(buildTree(caps.data ?? []));
  }, [caps.data, opts.exclude, opts.maxLevel, label]);
}
