import { expect, test } from '@playwright/test';
import { DEMO, apiCall, login } from './helpers';

/**
 * Quick Model (Modeler design B2): paste rows from Excel into the table, generate the diagram
 * (lanes from roles, typed steps, conditions, IT system links), then edit the table again — the
 * existing step keeps its id.
 */
const stamp = Date.now().toString(36).toUpperCase();

const ROWS = [
  'Step\tStep (AR)\tPerformed by\tIT system\tType\tNext\tConditions',
  'Create purchase request\tإنشاء طلب الشراء\tRequester\tERP (SAP S/4HANA)\tTask\t2',
  'Review request\tمراجعة الطلب\tDepartment Manager\t\tApproval\t3',
  'Approved?\tمعتمد؟\tDepartment Manager\t\tDecision\t4; 6\tYes; No',
  'Create purchase order\tإنشاء أمر الشراء\tProcurement Officer\tERP (SAP S/4HANA)\tSystem\t5',
  'PO issued\tتم إصدار أمر الشراء\tProcurement Officer\t\tEnd\t',
  'Request rejected\tتم رفض الطلب\tDepartment Manager\t\tEnd\t',
].join('\n');

test('paste rows from Excel, generate the diagram, edit the table again', async ({ page }) => {
  await login(page, DEMO.modeler);
  const created = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code: `E2E.Q${stamp}`,
    nameEn: `E2E quick model ${stamp}`,
    nameAr: `نمذجة سريعة ${stamp}`,
    category: 'CORE',
  });
  const id = created.data.id;
  await page.goto(`/processes/${id}/model`);
  await expect(page.locator('.djs-container svg').first()).toBeVisible();

  await page.locator('.ph-ws-view').getByText('Quick Model').click();
  await page.getByRole('button', { name: 'Paste from Excel' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(ROWS);
  await expect(page.getByRole('dialog').getByText('6 steps found')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Use these rows' }).click();
  await expect(page.locator('.ph-quick-table .ant-table-row')).toHaveCount(6);

  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByText('Diagram updated from the table')).toBeVisible();
  await expect(page.locator('.djs-element[data-element-id^="Lane"]')).toHaveCount(3);
  await expect(
    page.locator('.djs-shape[data-element-id^="Gateway"]:not([data-element-id$="_label"])'),
  ).toHaveCount(1);

  // Saved with links: roles on the lanes (PERFORMS), the IT system on two steps (SUPPORTS).
  await expect
    .poll(async () => {
      const links = await apiCall<{ relation: string }[]>(page, 'GET', `/processes/${id}/links`);
      return links.data.map((l) => l.relation).sort();
    })
    .toEqual(['PERFORMS', 'PERFORMS', 'PERFORMS', 'SUPPORTS', 'SUPPORTS']);
  const model = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${id}/model`);
  expect(model.data.bpmnXml).toMatch(/<bpmn:sequenceFlow [^>]*ph:nameEn="Yes"/);
  const taskId = /<bpmn:task id="([^"]+)" ph:nameEn="Create purchase request"/.exec(
    model.data.bpmnXml,
  )?.[1];
  expect(taskId).toBeTruthy();

  // Edit the table again: the step keeps its id.
  await page.locator('.ph-ws-view').getByText('Quick Model').click();
  const first = page.getByRole('textbox', { name: 'Step (English)' }).first();
  await expect(first).toHaveValue('Create purchase request');
  await first.fill('Create purchase requisition');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByText('Diagram updated from the table')).toBeVisible();
  await expect
    .poll(async () => {
      const m = await apiCall<{ bpmnXml: string }>(page, 'GET', `/processes/${id}/model`);
      return m.data.bpmnXml;
    })
    .toContain(`id="${taskId}" ph:nameEn="Create purchase requisition"`);
});

test('Arabic: the table is right-to-left and accepts Arabic-only rows', async ({ page }) => {
  await login(page, DEMO.modeler, 'ar');
  const created = await apiCall<{ id: string }>(page, 'POST', '/processes', {
    code: `E2E.QA${stamp}`,
    nameAr: `اعتماد الإجازة ${stamp}`,
    category: 'SUPPORT',
  });
  await page.goto(`/processes/${created.data.id}/model`);
  await expect(page.locator('.djs-container svg').first()).toBeVisible();
  await page.locator('.ph-ws-view').getByText('النمذجة السريعة').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'لصق من Excel' }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox')
    .fill(['تقديم طلب الإجازة\t\tمقدم الطلب', 'اعتماد الطلب\t\tمدير الإدارة\t\tاعتماد'].join('\n'));
  await page.getByRole('dialog').getByRole('button', { name: 'استخدام هذه الصفوف' }).click();
  await expect(page.getByRole('textbox', { name: 'الخطوة (بالعربية)' }).first()).toHaveValue(
    'تقديم طلب الإجازة',
  );
  await page.getByRole('button', { name: 'إنشاء المخطط' }).click();
  await expect(page.locator('.djs-element[data-element-id^="Lane"]')).toHaveCount(2);
  await expect(page.locator('.djs-shape .djs-visual text').getByText('اعتماد الطلب')).toHaveCount(
    1,
  );
});
