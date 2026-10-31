import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Col, Form, Modal, Row, TreeSelect, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type DiagramDto, type DiagramType } from '@processhub/shared';
import { useCreateDiagram, useUpdateDiagram } from '@/api/diagrams';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import { BilingualFields } from '@/components/BilingualFields';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { DiagramTypeIcon } from './DiagramTypeIcon';

interface Values {
  nameEn?: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  processId?: string | null;
  ownerId?: string | null;
  departmentId?: string | null;
}

/**
 * Create a diagram of a type (optionally with generated content) or edit its details: bilingual
 * name / description, parent process (process-house node), owner and department.
 */
export function DiagramFormModal({
  open,
  type,
  diagram,
  defaultProcessId,
  content,
  changeNote,
  extra,
  onClose,
}: {
  open: boolean;
  type: DiagramType;
  /** Edit mode. */
  diagram?: DiagramDto;
  defaultProcessId?: string | null;
  /** Generated initial content (value chain from the process house, org chart from departments …). */
  content?: string;
  changeNote?: string;
  /** Generation options shown above the fields (create mode). */
  extra?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const create = useCreateDiagram();
  const update = useUpdateDiagram(diagram?.id ?? '');
  const [form] = Form.useForm<Values>();
  const processes = useProcessTreeOptions('');
  const departments = useDepartmentTreeData();
  const canPickOwner = can(PERMISSIONS.USERS_READ) && (!diagram || can(PERMISSIONS.PROCESSES_EDIT));

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      diagram
        ? {
            nameEn: diagram.nameEn,
            nameAr: diagram.nameAr,
            descriptionEn: diagram.descriptionEn,
            descriptionAr: diagram.descriptionAr,
            processId: diagram.processId,
            ownerId: diagram.ownerId,
            departmentId: diagram.departmentId,
          }
        : { processId: defaultProcessId ?? null, ownerId: user?.id ?? null },
    );
  }, [open, diagram, defaultProcessId, user, form]);

  const submit = async () => {
    const v = await form.validateFields();
    if (!v.nameEn?.trim() && !v.nameAr?.trim()) {
      form.setFields([{ name: 'nameEn', errors: [t('validation.nameRequired')] }]);
      return;
    }
    try {
      if (diagram) {
        await update.mutateAsync(v);
        message.success(t('saved'));
        onClose();
      } else {
        const created = await create.mutateAsync({
          type,
          ...v,
          ...(content ? { content, changeNote: changeNote || undefined } : {}),
        });
        message.success(t('diagrams:created', { code: created.code }));
        onClose();
        navigate(`/diagrams/${created.id}`);
      }
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Modal
      title={
        <span>
          <DiagramTypeIcon type={type} style={{ marginInlineEnd: 8 }} />
          {diagram
            ? t('diagrams:editDetails')
            : t('diagrams:newOfType', { type: t(`diagrams:type.${type}`) })}
        </span>
      }
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={create.isPending || update.isPending}
      width={760}
      destroyOnHidden
    >
      {!diagram && (
        <Typography.Paragraph type="secondary">
          {t(`diagrams:typeHint.${type}`)}
        </Typography.Paragraph>
      )}
      {extra}
      <Form form={form} layout="vertical" requiredMark="optional" name="diagram">
        <BilingualFields description />
        <Form.Item
          name="processId"
          label={t('diagrams:fields.process')}
          extra={t('diagrams:fields.processHint')}
        >
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            treeData={processes.options}
            loading={processes.loading}
            placeholder={t('none')}
          />
        </Form.Item>
        <Row gutter={16}>
          {canPickOwner && (
            <Col xs={24} md={12}>
              <Form.Item name="ownerId" label={t('fields.owner')}>
                <UserSelect
                  allowClear
                  known={diagram?.owner ? [diagram.owner] : user ? [user] : []}
                  placeholder={t('none')}
                />
              </Form.Item>
            </Col>
          )}
          <Col xs={24} md={12}>
            <Form.Item name="departmentId" label={t('fields.department')}>
              <TreeSelect
                allowClear
                treeData={departments}
                treeDefaultExpandAll
                placeholder={t('none')}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
