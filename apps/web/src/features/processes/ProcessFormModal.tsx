import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Col, Form, Input, Modal, Row, Select, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  PROCESS_CATEGORIES,
  type ProcessCategory,
  type ProcessDto,
} from '@processhub/shared';
import { useSaveProcess, useUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  process?: ProcessDto;
  parent?: Pick<ProcessDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'category'>;
  defaultCategory?: ProcessCategory;
  onClose: () => void;
}

export function ProcessFormModal({ open, mode, process, parent, defaultCategory, onClose }: Props) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const save = useSaveProcess();
  const [form] = Form.useForm();
  const canPickOwner = can(PERMISSIONS.USERS_READ) && (mode === 'create' || can(PERMISSIONS.PROCESSES_EDIT));
  const users = useUsers({ pageSize: 100, status: 'ACTIVE', sort: 'nameEn' }, canPickOwner && open);
  const departmentTree = useDepartmentTreeData();
  const isTopLevel = mode === 'create' ? !parent : !process?.parentId;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (mode === 'edit' && process) {
      form.setFieldsValue({
        code: process.code,
        nameEn: process.nameEn,
        nameAr: process.nameAr,
        descriptionEn: process.descriptionEn,
        descriptionAr: process.descriptionAr,
        category: process.category,
        ownerId: process.ownerId,
        departmentId: process.departmentId,
      });
    } else {
      form.setFieldsValue({
        category: parent?.category ?? defaultCategory ?? 'CORE',
        code: parent ? `${parent.code}.` : '',
      });
    }
  }, [open, mode, process, parent, defaultCategory, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const body = {
      ...values,
      ownerId: values.ownerId ?? null,
      departmentId: values.departmentId ?? null,
      ...(mode === 'create' ? { parentId: parent?.id ?? null } : {}),
    };
    if (!isTopLevel) delete body.category;
    if (!canPickOwner) delete body.ownerId;
    try {
      const saved = await save.mutateAsync({ id: mode === 'edit' ? process?.id : undefined, body });
      message.success(t('saved'));
      onClose();
      if (mode === 'create') navigate(`/processes/${saved.id}`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Modal
      title={
        mode === 'edit'
          ? t('processes:edit')
          : parent
            ? t('processes:newSubProcessOf', { name: loc(parent) })
            : t('processes:new')
      }
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={save.isPending}
      width={760}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="code"
              label={t('fields.code')}
              tooltip={t('processes:codeHint')}
              rules={[
                { required: true, message: t('validation.required') },
                { pattern: /^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/, message: t('validation.code') },
              ]}
            >
              <Input dir="ltr" maxLength={30} placeholder="C.02.03" />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="category" label={t('fields.category')} extra={!isTopLevel ? t('processes:categoryInherited') : undefined}>
              <Select
                disabled={!isTopLevel}
                options={PROCESS_CATEGORIES.map((c) => ({ value: c, label: t(`processes:category.${c}`) }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields description />
        <Row gutter={16}>
          {canPickOwner && (
            <Col xs={24} md={12}>
              <Form.Item name="ownerId" label={t('fields.owner')}>
                <Select
                  allowClear
                  showSearch
                  placeholder={t('none')}
                  loading={users.isLoading}
                  optionFilterProp="label"
                  options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: `${loc(u) || u.email}` }))}
                />
              </Form.Item>
            </Col>
          )}
          <Col xs={24} md={12}>
            <Form.Item name="departmentId" label={t('fields.department')}>
              <TreeSelect allowClear treeData={departmentTree} treeDefaultExpandAll placeholder={t('none')} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
