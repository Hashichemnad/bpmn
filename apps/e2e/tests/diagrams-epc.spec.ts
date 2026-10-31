import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';
import { createDiagram, publishDiagram } from './diagram-helpers';

/**
 * EPC (D-124): syntax warnings in the Validation panel, version, conversion to a new draft BPMN
 * process with the mapping report, publication and the portal view.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).toUpperCase();
const NAME_EN = `E2E purchase EPC ${stamp}`;
let diagramId = '';

const node = (id: string, kind: string, nameEn: string, nameAr: string, x: number, y: number) => ({
  id,
  kind,
  x,
  y,
  width: kind === 'xor' ? 40 : 150,
  height: kind === 'xor' ? 40 : 60,
  nameEn,
  nameAr,
});
const flow = (sourceId: string, targetId: string, kind = 'flow') => ({
  id: `F_${sourceId}_${targetId}`,
  kind,
  sourceId,
  targetId,
  waypoints: [],
  nameEn: '',
  nameAr: '',
});
const CONTENT = JSON.stringify({
  schema: 1,
  type: 'EPC',
  nodes: [
    node('E1', 'event', 'Purchase request raised', 'تم رفع طلب الشراء', 300, 40),
    node('F1', 'function', 'Check request', 'مراجعة الطلب', 300, 140),
    node('U1', 'orgUnit', 'Procurement', 'المشتريات', 520, 140),
    node('X1', 'xor', '', '', 355, 250),
    node('E2', 'event', 'Request approved', 'تمت الموافقة على الطلب', 160, 330),
    node('E3', 'event', 'Request rejected', 'تم رفض الطلب', 440, 330),
    node('F2', 'function', 'Issue purchase order', 'إصدار أمر الشراء', 160, 430),
    node('E4', 'event', 'Order issued', 'تم إصدار الأمر', 160, 530),
  ],
  edges: [
    flow('E1', 'F1'),
    flow('U1', 'F1', 'assignment'),
    flow('F1', 'X1'),
    flow('X1', 'E2'),
    flow('X1', 'E3'),
    flow('E2', 'F2'),
    flow('F2', 'E4'),
  ],
});

test('modeler sees EPC syntax warnings and saves a valid version', async ({ page }) => {
  await login(page, DEMO.modeler);
  diagramId = (
    await createDiagram(page, {
      type: 'EPC',
      nameEn: NAME_EN,
      nameAr: `سلسلة ${stamp}`,
      content: CONTENT,
    })
  ).id;
  await page.goto(`/diagrams/${diagramId}/edit`);
  await expect(page.locator('.ph-ws-canvas .djs-shape').first()).toBeVisible();
  await page.getByRole('tab', { name: /Validation/ }).click();
  await expect(page.getByTestId('epc-valid')).toBeVisible();

  // A loose function is reported, deleting it makes the chain valid again.
  await page.locator('.ph-palette-entry[data-kind="function"]').click();
  const box = (await page.locator('.ph-ws-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width - 120, box.y + 80, { steps: 5 });
  await page.mouse.click(box.x + box.width - 120, box.y + 80);
  await page.keyboard.type('Loose step');
  await page.mouse.click(box.x + 10, box.y + box.height - 10);
  await expect(page.getByTestId('epc-issues').locator('[data-code="UNCONNECTED"]')).toBeVisible();
  await page.getByTestId('epc-issues').locator('[data-code="UNCONNECTED"]').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('epc-valid')).toBeVisible();

  await page.getByRole('button', { name: 'Save version' }).click();
  await page.getByRole('dialog').getByLabel('Change note').fill('Purchase request EPC');
  await page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version 1 saved/)).toBeVisible();
});

test('modeler converts the EPC to a draft BPMN process', async ({ page }) => {
  await login(page, DEMO.modeler);
  await page.goto(`/diagrams/${diagramId}/edit`);
  await expect(page.locator('.ph-ws-canvas .djs-shape').first()).toBeVisible();
  await page.getByTestId('epc-convert').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill(`E2E.EPC.${stamp}`);
  await dialog.getByRole('button', { name: 'Convert to BPMN' }).click();
  await expect(page.getByTestId('epc-report')).toContainText('Branch label after the gateway');
  await expect(page.getByTestId('epc-report')).toContainText('User task');
  await page.getByRole('link', { name: 'Open the BPMN model' }).click();
  await expect(page).toHaveURL(/\/processes\/[0-9a-f-]{36}\/model/);
  await expect(page.locator('.djs-shape[data-element-id="F1"]')).toBeVisible();
  const processId = new URL(page.url()).pathname.split('/')[2];
  const model = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${processId}/model`);
  expect(model.data.bpmnXml).toContain('bpmn:exclusiveGateway id="X1"');
  expect(model.data.bpmnXml).toContain('ph:nameEn="Request approved"');
});

test('the published EPC is shown in the portal', async ({ page }) => {
  test.setTimeout(90_000);
  await publishDiagram(page, diagramId);
  await login(page, DEMO.viewer, 'ar');
  await page.goto(`/portal/diagrams/${diagramId}`);
  await expect(page.locator('.ph-graph-canvas')).toContainText('مراجعة الطلب');
  await login(page, DEMO.viewer, 'en');
});
