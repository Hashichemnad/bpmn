import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login, sample } from './helpers';
import { publishDiagram } from './diagram-helpers';

/**
 * DMN decision table (D-123): import the sample, test the decision, save a version, link it to a
 * business rule task of a process ("where used"), publish and view it in the portal.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const NAME_EN = `E2E approval authority ${stamp}`;
let diagramId = '';
let processId = '';

const RULE_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:businessRuleTask id="Task_Approver" name="Determine approver" ph:nameEn="Determine approver" ph:nameAr="تحديد جهة الاعتماد" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="Task_Approver_di" bpmnElement="Task_Approver"><dc:Bounds x="200" y="100" width="120" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('modeler imports a DMN table and tests the decision', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto('/processes');
  await page.getByTestId('new-item').click();
  await page.getByRole('menuitem', { name: 'Decision table (DMN)' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(NAME_EN);
  await dialog.getByLabel('Name (Arabic)').fill(`صلاحية الاعتماد ${stamp}`);
  await dialog.getByLabel('Owner').fill('Omar');
  await page.locator('.ant-select-item-option', { hasText: 'Omar Owner' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/diagrams\/[0-9a-f-]{36}$/);
  diagramId = new URL(page.url()).pathname.split('/')[2];

  await page.goto(`/diagrams/${diagramId}/edit`);
  await expect(page.locator('[data-testid="dmn-canvas"] .tjs-container')).toBeVisible();
  await page.getByTestId('dmn-import').setInputFiles({
    name: 'approval-authority.dmn',
    mimeType: 'application/xml',
    buffer: readFileSync(sample('approval-authority.dmn')),
  });
  await expect(page.locator('[data-testid="dmn-canvas"]')).toContainText('IT Director');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Test decision: 50 000 for IT → the IT rule (FIRST hit policy).
  await page.getByRole('tab', { name: 'Test' }).click();
  await page.locator('[data-input-id="Input_Amount"]').fill('50000');
  await page.locator('[data-input-id="Input_Category"]').fill('IT');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('dmn-result')).toContainText('IT Director');
  await expect(page.locator('.ph-dmn-hit').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Validation' }).click();
  await expect(page.getByTestId('dmn-valid')).toBeVisible();

  await page.getByRole('button', { name: 'Save version' }).click();
  await page.getByRole('dialog').getByLabel('Change note').fill('Approval authority 2026');
  await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version 1 saved/)).toBeVisible();
  const content = await apiCall<{ content: string }>(page, 'GET', `/diagrams/${diagramId}/content`);
  expect(content.data.content).toContain('ph:nameAr="صلاحية الاعتماد حسب المبلغ"');
});

test('a business rule task links to the decision table', async ({ page }) => {
  await login(page, DEMO.modeler);
  const created = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code: `E2E.DMN.${stamp}`,
    nameEn: `E2E purchase approval ${stamp}`,
    category: 'SUPPORT',
  });
  processId = created.data.id;
  await apiCall(page, 'PUT', `/processes/${processId}/model`, { bpmnXml: RULE_TASK_BPMN });
  await page.goto(`/processes/${processId}/model`);
  await page.locator('.djs-shape[data-element-id="Task_Approver"]').click();
  await page.getByTestId('decision-diagram').click();
  await page.locator('.ant-select-item-option', { hasText: NAME_EN }).click();
  await expect(page.getByTestId('decision-view')).toBeVisible();
  // Autosaved after a short pause.
  await expect
    .poll(
      async () =>
        (await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${processId}/model`)).data
          .bpmnXml,
      { timeout: 15_000 },
    )
    .toContain(`ph:decisionRef="${diagramId}"`);
  const usage = await apiCall<{ relation: string; elementId: string }[]>(
    page,
    'GET',
    `/diagrams/where-used?diagramId=${diagramId}`,
  );
  expect(usage.data).toEqual([
    expect.objectContaining({ relation: 'DECISION', elementId: 'Task_Approver' }),
  ]);
});

test('the published decision table is shown in the portal', async ({ page }) => {
  test.setTimeout(90_000);
  await publishDiagram(page, diagramId);
  await login(page, DEMO.viewer);
  await page.goto(`/portal/diagrams/${diagramId}`);
  await expect(page.locator('.tjs-container')).toContainText('Chief Executive Officer');
});
