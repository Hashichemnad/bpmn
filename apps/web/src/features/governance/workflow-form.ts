import type { UserRef, WorkflowDto, WorkflowInput } from '@processhub/shared';

/** Form values of a workflow (the shape of WorkflowInput). */
export type WorkflowFormValues = WorkflowInput;

export function workflowToForm(w: WorkflowDto | null | undefined): WorkflowFormValues {
  if (!w) {
    return {
      nameEn: '',
      nameAr: '',
      descriptionEn: '',
      descriptionAr: '',
      autoPublish: false,
      steps: [{ nameEn: '', nameAr: '', rule: 'ANY', assignees: [{ type: 'OWNER' }] }],
    };
  }
  return {
    nameEn: w.nameEn,
    nameAr: w.nameAr,
    descriptionEn: w.descriptionEn,
    descriptionAr: w.descriptionAr,
    autoPublish: w.autoPublish,
    steps: w.steps.map((s) => ({
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      rule: s.rule,
      assignees: s.assignees.map((a) =>
        a.type === 'USER'
          ? { type: 'USER' as const, userId: a.userId! }
          : a.type === 'ROLE'
            ? { type: 'ROLE' as const, roleKey: a.roleKey!, departmentId: a.departmentId ?? null }
            : { type: 'OWNER' as const },
      ),
    })),
  };
}

/** Users already named in a workflow, so the pickers can show their names. */
export function knownUsers(w: WorkflowDto | null | undefined): UserRef[] {
  return (w?.steps ?? []).flatMap((s) =>
    s.assignees.flatMap((a) =>
      a.type === 'USER' && a.label
        ? [
            {
              id: a.userId!,
              email: a.label.email ?? '',
              nameEn: a.label.nameEn,
              nameAr: a.label.nameAr,
            },
          ]
        : [],
    ),
  );
}
