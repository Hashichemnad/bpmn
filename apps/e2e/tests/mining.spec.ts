import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiCall, login, setLocale } from './helpers';

/**
 * Process mining (Phase 5.1): import a CSV with the column mapping, validation report and import;
 * then (later steps) the process map, variants, conformance overlay and simulation scenarios.
 */
test.setTimeout(120_000);

/** Small purchase log: 6 cases, one with rework, one bad row, times in Asia/Dubai (day first). */
export function purchaseCsv(prefix: string) {
  const rows = ['Request;Step;Started;Finished;Clerk;Unit;Channel'];
  const day = (d: number, h: number, m = 0) =>
    `${String(d).padStart(2, '0')}/03/2026 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  for (let i = 1; i <= 6; i++) {
    const c = `${prefix}-${i}`;
    rows.push(`${c};Create request;${day(i, 8)};${day(i, 8, 30)};Sara;Procurement;web`);
    rows.push(`${c};Check budget;${day(i, 9)};${day(i, 10)};Omar;Finance;web`);
    if (i % 3 === 0) rows.push(`${c};Check budget;${day(i, 11)};${day(i, 12)};Omar;Finance;web`);
    rows.push(
      `${c};Approve request;${day(i, 13)};${day(i, 13, 20)};Lina;Finance;${i % 2 ? 'web' : 'email'}`,
    );
  }
  rows.push(`${prefix}-7;;${day(7, 8)};${day(7, 9)};Sara;Procurement;web`); // no activity → skipped
  return rows.join('\n');
}

export async function importCsv(page: Page, name: string, csv: string) {
  await page.goto('/mining/logs/new');
  await page.locator('input[type=file]').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByLabel('Name (English)').fill(name);
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  // Mapping suggested from the column names and values.
  const mapping = page.getByTestId('mining-mapping');
  await expect(mapping.getByTestId('map-caseColumn')).toContainText('Request');
  await expect(mapping.getByTestId('map-activityColumn')).toContainText('Step');
  await expect(mapping.getByTestId('map-startColumn')).toContainText('Started');
  await expect(mapping.getByTestId('map-endColumn')).toContainText('Finished');
  await expect(mapping.getByTestId('map-resourceColumn')).toContainText('Clerk');
  await expect(mapping.getByTestId('map-departmentColumn')).toContainText('Unit');
  // Extra attribute for filters.
  await mapping.locator('.ant-select-multiple').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .locator('.ant-select-item-option-content', { hasText: /^Channel$/ })
    .click();
  await page.keyboard.press('Escape');
  await page.getByTestId('mining-validate').click();
  const report = page.getByTestId('mining-report');
  await expect(report).toContainText('1 rows without an activity');
  await page.getByTestId('mining-import').click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  return page.url().split('/mining/logs/')[1].split('/')[0];
}

test('import an event log: mapping, validation, import', async ({ page }) => {
  await login(page, DEMO.performance);
  const name = `E2E purchase ${Date.now()}`;
  const id = await importCsv(page, name, purchaseCsv(`P${Date.now() % 100000}`));
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  const log = await apiCall<{ caseCount: number; eventCount: number; attributeNames: string[] }>(
    page,
    'GET',
    `/mining/logs/${id}`,
  );
  expect(log.data).toMatchObject({ caseCount: 6, eventCount: 20, attributeNames: ['Channel'] });
  await page.getByRole('tab', { name: 'Activities and steps' }).click();
  await expect(page.getByTestId('mining-activities')).toContainText('Check budget');

  // Process map: frequency labels, performance view, path slider.
  await page.getByRole('tab', { name: 'Process map' }).click();
  const map = page.getByTestId('process-map');
  await expect(map.locator('[data-node="Check budget"]')).toBeVisible();
  await expect(map.locator('[data-edge="Check budget>Check budget"]')).toBeVisible();
  await expect(map.locator('[data-edge="Create request>Check budget"]')).toContainText('6');
  await page.getByTestId('map-mode').getByText('Performance').click();
  await expect(map.locator('[data-edge="Create request>Check budget"]')).toContainText('30 min');
  // Filter: only e-mail cases (attribute) → 3 of 6 cases.
  await page.getByTestId('add-filter').click();
  await page.getByRole('menuitem', { name: 'Attribute value' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Attribute').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content', {
      hasText: /^Channel$/,
    })
    .click();
  await dlg.getByLabel('Values').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content', { hasText: /^email$/ })
    .click();
  await page.keyboard.press('Escape');
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('filtered-cases')).toContainText('3 of 6 cases');
  await page.getByTestId('mining-filters').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('filtered-cases')).toContainText('6 of 6 cases');

  // Variants: two variants, the rework one on the map.
  await page.getByRole('tab', { name: 'Variants' }).click();
  const variants = page.getByTestId('variants-table');
  await expect(variants.locator('tbody tr.ant-table-row')).toHaveCount(2);
  await variants
    .locator('tbody tr.ant-table-row')
    .nth(1)
    .getByRole('button', { name: 'Show on map' })
    .click();
  await expect(page.getByText('Variant highlighted')).toBeVisible();
  await page.getByRole('tab', { name: 'Variants' }).click();
  await variants.locator('tbody tr.ant-table-row .ant-checkbox-input').nth(0).check();
  await variants.locator('tbody tr.ant-table-row .ant-checkbox-input').nth(1).check();
  await expect(page.getByTestId('variant-compare')).toContainText('Check budget');

  // Statistics and bottlenecks.
  await page.getByRole('tab', { name: 'Statistics' }).click();
  await expect(page.getByTestId('mining-stats')).toContainText('Cases with rework');
  await page.getByRole('tab', { name: 'Bottlenecks' }).click();
  await expect(page.getByTestId('mining-bottlenecks')).toContainText('Check budget');

  // Arabic: list and page in RTL.
  await setLocale(page, 'ar');
  await page.goto('/mining/logs');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('mining-logs')).toContainText(name);
  await page.goto(`/mining/logs/${id}`);
  await expect(page.getByRole('tab', { name: 'نظرة عامة' })).toBeVisible();
  await setLocale(page, 'en');

  // Other departments' users do not see the log; Viewers have no mining menu.
  await login(page, DEMO.viewer);
  expect((await apiCall(page, 'GET', `/mining/logs/${id}`)).status).toBe(403);
});

const purchaseBpmn = () => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:ph="http://processhub.io/schema/bpmn" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="Create" name="Create request" ph:nameEn="Create request" ph:durationMinutes="10" />
    <bpmn:task id="Check" name="Check budget" ph:nameEn="Check budget" ph:durationMinutes="60" />
    <bpmn:task id="Approve" name="Approve request" ph:nameEn="Approve request" ph:durationMinutes="20" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Create" />
    <bpmn:sequenceFlow id="F2" sourceRef="Create" targetRef="Check" />
    <bpmn:sequenceFlow id="F3" sourceRef="Check" targetRef="Approve" />
    <bpmn:sequenceFlow id="F4" sourceRef="Approve" targetRef="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Create_di" bpmnElement="Create"><dc:Bounds x="190" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Check_di" bpmnElement="Check"><dc:Bounds x="340" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Approve_di" bpmnElement="Approve"><dc:Bounds x="490" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_di" bpmnElement="End"><dc:Bounds x="640" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="136" y="118" /><di:waypoint x="190" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="290" y="118" /><di:waypoint x="340" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F3_di" bpmnElement="F3"><di:waypoint x="440" y="118" /><di:waypoint x="490" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F4_di" bpmnElement="F4"><di:waypoint x="590" y="118" /><di:waypoint x="640" y="118" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('conformance: deviations and the overlay on the BPMN model', async ({ page }) => {
  // A modeler creates the process with its model.
  await login(page, DEMO.modeler);
  const code = `E2E.M${Date.now() % 1_000_000}`;
  const proc = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code,
    nameEn: 'E2E purchase request',
    category: 'SUPPORT',
  });
  expect(proc.status).toBe(201);
  expect(
    (await apiCall(page, 'PUT', `/processes/${proc.data.id}/model`, { bpmnXml: purchaseBpmn() }))
      .status,
  ).toBe(200);

  await login(page, DEMO.performance);
  const id = await importCsv(
    page,
    `E2E conformance ${Date.now()}`,
    purchaseCsv(`K${Date.now() % 100000}`),
  );
  expect(
    (await apiCall(page, 'PATCH', `/mining/logs/${id}`, { processId: proc.data.id })).status,
  ).toBe(200);
  await page.goto(`/mining/logs/${id}/conformance`);
  // Rework of "Check budget" (2 of 6 cases) is the only deviation.
  await expect(page.getByTestId('conformance-summary')).toContainText('66.7%(4 / 6)');
  await expect(page.getByTestId('deviations')).toContainText('"Check budget" repeated');
  await expect(page.getByTestId('step-suggestions')).toContainText('Create request');

  // Overlay on the read-only model: deviations view with the log as source.
  await page.getByTestId('show-on-model').click();
  await expect(page.getByTestId('colour-by-note')).toContainText('LOG-');
  await expect(page.locator('.ph-colour-legend')).toContainText('Mining: deviations');
  await expect(page.locator('.ph-metric-badge').first()).toBeVisible();
  await expect(page.locator('.ph-metric-flow').first()).toContainText('6');
});

test('simulation: as-is and to-be scenarios, comparison and bottleneck view', async ({ page }) => {
  await login(page, DEMO.modeler);
  const code = `E2E.S${Date.now() % 1_000_000}`;
  const proc = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code,
    nameEn: 'E2E simulated purchase',
    category: 'SUPPORT',
  });
  // Lanes (resources) and step attributes: 600 requests a month, the check takes 40 minutes.
  const xml = purchaseBpmn()
    .replace(
      '<bpmn:startEvent id="Start" />',
      '<bpmn:laneSet id="LS"><bpmn:lane id="Clerks" name="Clerks"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>Create</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="Finance" name="Finance"><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>Approve</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:startEvent id="Start" />',
    )
    .replace('ph:durationMinutes="10" />', 'ph:durationMinutes="10" ph:frequencyPerMonth="600" />')
    .replace('ph:durationMinutes="60" />', 'ph:durationMinutes="40" ph:costPerExecution="30" />');
  expect(
    (await apiCall(page, 'PUT', `/processes/${proc.data.id}/model`, { bpmnXml: xml })).status,
  ).toBe(200);

  await login(page, DEMO.performance);
  await page.goto('/mining/simulations');
  await page.getByTestId('new-simulation').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByTestId('sim-process').click();
  await page.keyboard.type(code);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
  await dlg.getByLabel('Name (English)').fill('E2E staffing');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('sim-scenario')).toHaveCount(1);
  await expect(page.getByTestId('sim-scenario')).toContainText('As-is');

  // To-be: copy and give Finance two people.
  await page.getByTestId('sim-copy').click();
  await expect(page.getByTestId('sim-scenario')).toHaveCount(2);
  await page.getByTestId('sim-edit').nth(1).click();
  await page.getByRole('tab', { name: 'Resources' }).click();
  await page
    .locator(
      'input[data-testid="sim-capacity-Finance"], [data-testid="sim-capacity-Finance"] input',
    )
    .first()
    .fill('2');
  await page.getByTestId('sim-save-scenario').click();
  await expect(page.getByTestId('sim-scenario').nth(1)).toContainText('Finance: 2');

  await page.getByTestId('sim-run').click();
  const table = page.getByTestId('sim-comparison');
  await expect(table).toContainText('Cases completed', { timeout: 60_000 });
  await expect(table).toContainText('Utilisation: Finance');
  await expect(table.locator('thead th')).toHaveCount(3);

  // Bottlenecks on the model (Colour by → Simulation: utilisation).
  await page.getByTestId('sim-on-model').click();
  await expect(page.locator('.ph-colour-legend')).toContainText('Simulation: utilisation');
  await expect(page.getByTestId('colour-by-note')).toContainText('SIM-');
  await expect(page.locator('.ph-metric-badge').first()).toBeVisible();
});
