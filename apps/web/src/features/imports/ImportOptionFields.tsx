import { Form, Radio, Select, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { PAGE_TEMPLATE_KEYS, PERMISSIONS, type ImportKindInfo } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useSpaces } from '@/api/docs';
import { useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { PageTreeSelect, ProcessTreeSelect } from './import-helpers';

/** Option widgets of one import kind (inside an antd Form, field names = option keys). */
export function ImportOptionFields({ info }: { info: ImportKindInfo }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const spaces = useSpaces();
  const form = Form.useFormInstance();
  const spaceId = Form.useWatch('spaceId', form) as string | null | undefined;
  const has = (k: string) => (info.options as readonly string[]).includes(k);
  const { can, user } = useAuth();
  // Process Owners (D-164) import for themselves, under their own processes.
  const owner = !can(PERMISSIONS.IMPORT_MANAGE);
  const label = (k: string) => t(`imports:option.${k}`);
  const help = (k: string) => t(`imports:optionHelp.${k}`);

  return (
    <>
      {has('defaultOwnerId') && !owner && (
        <Form.Item
          name="defaultOwnerId"
          label={label('defaultOwnerId')}
          extra={help('defaultOwnerId')}
        >
          <UserSelect allowClear />
        </Form.Item>
      )}
      {has('attachTo') && (
        <Form.Item name="attachTo" label={label('attachTo')} initialValue="MATCH_OR_CREATE">
          <Radio.Group>
            <Radio value="MATCH_OR_CREATE">{t('imports:attachTo.MATCH_OR_CREATE')}</Radio>
            <Radio value="CREATE">{t('imports:attachTo.CREATE')}</Radio>
          </Radio.Group>
        </Form.Item>
      )}
      {has('parentProcessId') && (
        <Form.Item
          name="parentProcessId"
          label={label('parentProcessId')}
          extra={help(owner ? 'parentProcessIdOwn' : 'parentProcessId')}
        >
          <ProcessTreeSelect ownerId={owner ? user?.id : undefined} />
        </Form.Item>
      )}
      {has('processCategory') && (
        <Form.Item name="processCategory" label={label('processCategory')} initialValue="CORE">
          <Select
            options={(['MANAGEMENT', 'CORE', 'SUPPORT'] as const).map((c) => ({
              value: c,
              label: t(`processes:category.${c}`),
            }))}
          />
        </Form.Item>
      )}
      {has('vendorExtensions') && (
        <Form.Item name="vendorExtensions" label={label('vendorExtensions')} initialValue="STRIP">
          <Radio.Group>
            <Radio value="STRIP">{t('imports:vendor.STRIP')}</Radio>
            <Radio value="KEEP">{t('imports:vendor.KEEP')}</Radio>
          </Radio.Group>
        </Form.Item>
      )}
      {has('autoLayout') && (
        <Form.Item name="autoLayout" label={label('autoLayout')} initialValue="MISSING">
          <Radio.Group>
            <Radio value="MISSING">{t('imports:layout.MISSING')}</Radio>
            <Radio value="ALWAYS">{t('imports:layout.ALWAYS')}</Radio>
          </Radio.Group>
        </Form.Item>
      )}
      {has('visioLayout') && (
        <Form.Item
          name="visioLayout"
          label={label('visioLayout')}
          initialValue="AUTO"
          extra={help('visioLayout')}
        >
          <Radio.Group>
            <Radio value="AUTO">{t('imports:visioLayout.AUTO')}</Radio>
            <Radio value="KEEP">{t('imports:visioLayout.KEEP')}</Radio>
          </Radio.Group>
        </Form.Item>
      )}
      {has('spaceId') && (
        <Form.Item
          name="spaceId"
          label={label('spaceId')}
          rules={[{ required: true, message: t('imports:spaceRequired') }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={spaces.isLoading}
            onChange={() => form.setFieldValue('parentPageId', null)}
            options={(spaces.data ?? [])
              .filter((s) => s.canEdit)
              .map((s) => ({
                value: s.id,
                label: `${s.key} · ${loc(s)}`,
              }))}
          />
        </Form.Item>
      )}
      {has('parentPageId') && (
        <Form.Item name="parentPageId" label={label('parentPageId')}>
          <PageTreeSelect spaceId={spaceId} />
        </Form.Item>
      )}
      {has('pageTemplate') && (
        <Form.Item name="pageTemplate" label={label('pageTemplate')} initialValue="NONE">
          <Select
            options={PAGE_TEMPLATE_KEYS.map((k) => ({
              value: k,
              label: t(`imports:template.${k}`),
            }))}
          />
        </Form.Item>
      )}
      {has('splitByHeading') && (
        <Form.Item
          name="splitByHeading"
          label={label('splitByHeading')}
          valuePropName="checked"
          initialValue={false}
          extra={help('splitByHeading')}
        >
          <Switch />
        </Form.Item>
      )}
      {has('linkProcesses') && (
        <Form.Item
          name="linkProcesses"
          label={label('linkProcesses')}
          valuePropName="checked"
          initialValue
          extra={help('linkProcesses')}
        >
          <Switch />
        </Form.Item>
      )}
      {has('sendInvitations') && (
        <Form.Item
          name="sendInvitations"
          label={label('sendInvitations')}
          valuePropName="checked"
          initialValue
          extra={help('sendInvitations')}
        >
          <Switch />
        </Form.Item>
      )}
      {has('updateExisting') && (
        <Form.Item
          name="updateExisting"
          label={label('updateExisting')}
          valuePropName="checked"
          initialValue
          extra={help('updateExisting')}
        >
          <Switch />
        </Form.Item>
      )}
    </>
  );
}
