import {
  DEFAULT_GRC_SETTINGS,
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  type GrcBand,
  type GrcObjectType,
  type GrcStatus,
  type GrcStepLinkDto,
} from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useGrcSettings } from '@/api/grc';
import { useLocale } from '@/app/LocaleProvider';

/** Workspace routes of the registers and their items. */
export const GRC_ROUTES: Record<GrcObjectType, string> = {
  RISK: '/grc/risks',
  CONTROL: '/grc/controls',
  REQUIREMENT: '/grc/requirements',
};
export const grcItemPath = (type: GrcObjectType, id: string) => `${GRC_ROUTES[type]}/${id}`;

/** Modeler deep link of a linked step (the process page for whole-process links). */
export function stepHref(s: Pick<GrcStepLinkDto, 'process' | 'bpmnElementId'>) {
  return s.bpmnElementId === PROCESS_ELEMENT_ID
    ? `/processes/${s.process.id}`
    : `/processes/${s.process.id}/model?element=${encodeURIComponent(s.bpmnElementId)}`;
}

/** What the signed-in user may do in Risk & Compliance (the server checks again). */
export function useGrcAccess() {
  const { user, can } = useAuth();
  const canEdit = can(PERMISSIONS.GRC_EDIT);
  const canPropose = canEdit || can(PERMISSIONS.GRC_PROPOSE);
  const ownDraft = (i: { createdById: string | null; status: GrcStatus }) =>
    i.status === 'DRAFT' && !!user && i.createdById === user.id;
  return {
    canRead: can(PERMISSIONS.GRC_READ),
    canPropose,
    canEdit,
    canAdmin: can(PERMISSIONS.GRC_ADMIN),
    canComment: can(PERMISSIONS.GRC_READ) && can(PERMISSIONS.COMMENTS_WRITE),
    canChange: (i: { createdById: string | null; status: GrcStatus }) => canEdit || ownDraft(i),
    canDelete: (i: { createdById: string | null; status: GrcStatus }) =>
      can(PERMISSIONS.GRC_ADMIN) || ownDraft(i),
  };
}

/** The configured matrix (defaults while loading). */
export function useGrcConfig() {
  const settings = useGrcSettings();
  return settings.data ?? DEFAULT_GRC_SETTINGS;
}

export function bandOf(bands: GrcBand[], key: string | null | undefined) {
  return bands.find((b) => b.key === key) ?? null;
}

/** Readable text colour on a band colour. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1f1f1f' : '#ffffff';
}

export function useCategoryName() {
  const { locale } = useLocale();
  const { categories } = useGrcConfig();
  return (key: string) => {
    const c = categories.find((x) => x.key === key);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : key;
  };
}
