import { expect, type Page } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/** Creates a diagram through the API as the signed-in user, owned by the demo Process Owner. */
export async function createDiagram(
  page: Page,
  body: { type: string; nameEn: string; nameAr: string; content?: string; changeNote?: string },
) {
  const owners = await apiCall<{ id: string; email: string }[]>(
    page,
    'GET',
    `/users/directory?q=${encodeURIComponent(DEMO.owner)}`,
  );
  const ownerId = owners.data.find((u) => u.email === DEMO.owner)?.id;
  const created = await apiCall<{ id: string; code: string }>(page, 'POST', '/diagrams', {
    ...body,
    ownerId,
  });
  expect(created.status).toBe(201);
  return created.data;
}

/**
 * Takes a diagram with a saved version through the demo workflow (reviewer, then owner) and
 * publishes it, through the API (the UI flow is covered by diagrams-value-chain.spec).
 */
export async function publishDiagram(page: Page, diagramId: string) {
  await login(page, DEMO.modeler);
  expect((await apiCall(page, 'POST', `/governance/diagrams/${diagramId}/submit`, {})).status).toBe(
    200,
  );
  for (const who of [DEMO.reviewer, DEMO.owner]) {
    await login(page, who);
    const tasks = await apiCall<{ reviews: { id: string; item: { entityId: string } }[] }>(
      page,
      'GET',
      '/tasks',
    );
    const review = tasks.data.reviews.find((r) => r.item.entityId === diagramId);
    expect(review).toBeTruthy();
    const decided = await apiCall(page, 'POST', `/reviews/${review!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(decided.status).toBe(200);
  }
  expect(
    (await apiCall(page, 'POST', `/governance/diagrams/${diagramId}/publish`, {})).status,
  ).toBe(200);
}
