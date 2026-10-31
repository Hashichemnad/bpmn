/** Workspace and portal paths of workflow pages (Viewers use the portal). */
export const taskPath = (id: string, portal = false) =>
  `${portal ? '/portal' : ''}/workflow/tasks/${id}`;
export const casePath = (id: string, portal = false) =>
  `${portal ? '/portal' : ''}/workflow/cases/${id}`;

export const caseTitle = (
  r: { caseTitleEn?: string; caseTitleAr?: string; titleEn?: string; titleAr?: string },
  loc: (o: object, field?: string) => string,
) => loc(r, r.caseTitleEn !== undefined ? 'caseTitle' : 'title');
