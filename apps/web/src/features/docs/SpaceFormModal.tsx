import { useEffect } from 'react';
import { App, Form, Input, Modal, Radio, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { SPACE_ICONS, type SpaceDto, type SpaceIcon } from '@processhub/shared';
import { useNavigate } from 'react-router-dom';
import { useDepartments, useUsers } from '@/api/hooks';
import { useSaveSpace } from '@/api/docs';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useAuth } from '@/auth/AuthProvider';
import { PERMISSIONS } from '@processhub/shared';
import { SPACE_ICON_COMPONENTS } from './space-icons';

interface Values {
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: SpaceIcon;
  ownerId: string | null;
  departmentId: string | null;
}

export function SpaceFormModal({ space, onClose }: { space?: SpaceDto; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { can } = useAuth();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const save = useSaveSpace();
  const users = useUsers({ pageSize: 100, status: 'ACTIVE' }, can(PERMISSIONS.USERS_READ));
  const departments = useDepartments();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    form.setFieldsValue(
      space
        ? {
            key: space.key,
            nameEn: space.nameEn,
            nameAr: space.nameAr,
            descriptionEn: space.descriptionEn,
            descriptionAr: space.descriptionAr,
            icon: space.icon,
            ownerId: space.owner?.id ?? null,
            departmentId: space.department?.id ?? null,
          }
        : { icon: 'book', ownerId: null, departmentId: null },
    );
  }, [space, form]);

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const { key, ...rest } = v;
      const saved = await save.mutateAsync(
        space ? { id: space.id, body: rest } : { body: { key, ...rest } },
      );
      message.success(t('saved'));
      onClose();
      if (!space) navigate(`/docs/${saved.id}`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open
      title={space ? t('docs:spaces.edit') : t('docs:spaces.new')}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={save.isPending}
      width={720}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item
          name="key"
          label={t('docs:spaces.key')}
          extra={t('docs:spaces.keyHint')}
          rules={[
            { required: true, message: t('validation.required') },
            { pattern: /^[A-Za-z][A-Za-z0-9]{1,9}$/, message: t('docs:spaces.keyInvalid') },
          ]}
        >
          <Input
            dir="ltr"
            disabled={!!space}
            maxLength={10}
            style={{ textTransform: 'uppercase', maxInlineSize: 200 }}
          />
        </Form.Item>
        <BilingualFields description />
        <Form.Item name="icon" label={t('docs:spaces.icon')}>
          <Radio.Group
            optionType="button"
            options={SPACE_ICONS.map((i) => {
              const Icon = SPACE_ICON_COMPONENTS[i];
              return { value: i, label: <Icon aria-label={i} /> };
            })}
          />
        </Form.Item>
        <Form.Item name="ownerId" label={t('fields.owner')} extra={t('docs:spaces.ownerHint')}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={users.isLoading}
            options={(users.data?.items ?? []).map((u) => ({
              value: u.id,
              label: loc(u) || u.email,
            }))}
          />
        </Form.Item>
        <Form.Item name="departmentId" label={t('fields.department')}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: loc(d) }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
