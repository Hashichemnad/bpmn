import { PERMISSIONS, type RepoObjectDto } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';

/** What the user may do with library objects, with the dictionary rules for terms (D-083). */
export function useObjectAccess() {
  const { can } = useAuth();
  const manage = can(PERMISSIONS.OBJECTS_MANAGE);
  const propose = can(PERMISSIONS.DICTIONARY_PROPOSE);
  const approve = can(PERMISSIONS.DICTIONARY_APPROVE);
  const isTerm = (o: Pick<RepoObjectDto, 'type'>) => o.type === 'TERM';
  /** Approved terms: approvers only; proposed terms: anyone who may propose. */
  const canEdit = (o: Pick<RepoObjectDto, 'type' | 'status'>) =>
    isTerm(o) ? (o.status === 'APPROVED' ? approve : propose || approve) : manage;
  return {
    canPropose: propose,
    canApprove: approve,
    canManage: manage,
    canEdit,
    canRename: (o: Pick<RepoObjectDto, 'type' | 'status'>) =>
      (o.type === 'TERM' || o.type === 'ROLE' || o.type === 'SYSTEM') && canEdit(o),
    canDelete: (o: Pick<RepoObjectDto, 'type' | 'status'>) =>
      manage && (!isTerm(o) || o.status === 'DRAFT' || approve),
  };
}

/** Synonyms in the active language first, then the other language. */
export function synonymsOf(o: Pick<RepoObjectDto, 'synonymsEn' | 'synonymsAr'>, ar: boolean) {
  return ar ? [...o.synonymsAr, ...o.synonymsEn] : [...o.synonymsEn, ...o.synonymsAr];
}
