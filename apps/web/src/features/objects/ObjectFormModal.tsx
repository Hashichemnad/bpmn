import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  TreeSelect,
  Typography,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ROLE_DEPARTMENT_ATTRIBUTE, type ObjectType, type RepoObjectDto } from '@processhub/shared';
import { useSaveObject } from '@/api/hooks';
import { useSaveTerm } from '@/api/dictionary';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { useObjectAccess } from './term-access';
import { RenameModal } from './RenameModal';

interface Props {
  open: boolean;
  type: ObjectType;
  object?: RepoObjectDto;
  /** Values for a new object (e.g. a term proposed from a diagram label). */
  defaults?: Partial<Pick<RepoObjectDto, 'nameEn' | 'nameAr' | 'descriptionEn' | 'descriptionAr'>>;
  onClose: (saved?: RepoObjectDto) => void;
}

/** Objects whose labels can be linked in diagrams: renaming them can update those labels. */
const LABEL_TYPES: ObjectType[] = ['TERM', 'ROLE', 'SYSTEM'];

type AttrRow = { key: string; value: string };

export function ObjectFormModal({ open, type, object, defaults, onClose }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const access = useObjectAccess();
  const isTerm = type === 'TERM';
  const saveObject = useSaveObject();
  const saveTerm = useSaveTerm();
  const save = isTerm ? saveTerm : saveObject;
  const [form] = Form.useForm();
  const departments = useDepartmentTreeData();
  /** Names changed on an object used in diagrams: continue in the rename dialog. */
  const [renameTo, setRenameTo] = useState<{
    object: RepoObjectDto;
    names: { nameEn: string; nameAr: string };
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (object) {
      form.setFieldsValue({
        ...object,
        attributes: Object.entries(object.attributes)
          .filter(([key]) => !(type === 'ROLE' && key === ROLE_DEPARTMENT_ATTRIBUTE))
          .map(([key, value]) => ({ key, value: String(value) })),
        roleDepartmentId:
          type === 'ROLE' ? (object.attributes[ROLE_DEPARTMENT_ATTRIBUTE] ?? null) : undefined,
      });
    } else {
      form.setFieldsValue({ attributes: [], synonymsEn: [], synonymsAr: [], ...defaults });
    }
  }, [open, object, defaults, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const attributes: Record<string, string> = Object.fromEntries(
      ((values.attributes ?? []) as AttrRow[])
        .filter((a) => a?.key?.trim() && a.key.trim() !== ROLE_DEPARTMENT_ATTRIBUTE)
        .map((a) => [a.key.trim(), a.value ?? '']),
    );
    // Roles: the department of the position (organisation charts, D-122).
    if (type === 'ROLE' && values.roleDepartmentId)
      attributes[ROLE_DEPARTMENT_ATTRIBUTE] = values.roleDepartmentId;
    delete values.roleDepartmentId;
    const body = {
      ...values,
      attributes,
      code: values.code || null,
      ...(isTerm ? { category: values.category || null, ownerId: values.ownerId ?? null } : {}),
      ...(object ? {} : { type }),
    };
    const names = { nameEn: values.nameEn?.trim() ?? '', nameAr: values.nameAr?.trim() ?? '' };
    const renamed =
      !!object &&
      LABEL_TYPES.includes(type) &&
      object.usageCount > 0 &&
      (names.nameEn !== object.nameEn || names.nameAr !== object.nameAr);
    if (renamed) {
      // Save everything else; the rename dialog shows the affected labels first.
      delete body.nameEn;
      delete body.nameAr;
    }
    try {
      const saved = await save.mutateAsync({ id: object?.id, body });
      if (renamed) {
        setRenameTo({ object: saved, names });
        return;
      }
      message.success(
        isTerm && !object && saved.status === 'DRAFT'
          ? t('objects:dictionary.proposed')
          : t('saved'),
      );
      onClose(saved);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  if (renameTo)
    return (
      <RenameModal
        object={renameTo.object}
        initial={renameTo.names}
        onClose={(renamed) => onClose(renamed ?? renameTo.object)}
      />
    );

  return (
    <Modal
      title={
        object
          ? t(`objects:edit.${type}`)
          : isTerm && !access.canApprove
            ? t('objects:dictionary.propose')
            : t(`objects:new.${type}`)
      }
      open={open}
      onCancel={() => onClose()}
      onOk={() => void submit()}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={save.isPending}
      width={720}
      destroyOnHidden
    >
      {isTerm && !object && !access.canApprove && (
        <Alert
          type="info"
          showIcon
          message={t('objects:dictionary.proposeHint')}
          style={{ marginBlockEnd: 16 }}
        />
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Row gutter={16}>
          <Col xs={24} md={isTerm ? 8 : 24}>
            <Form.Item name="code" label={t('fields.code')}>
              <Input dir="ltr" maxLength={50} style={{ maxWidth: 220 }} />
            </Form.Item>
          </Col>
          {isTerm && (
            <>
              <Col xs={24} md={8}>
                <Form.Item
                  name="category"
                  label={t('objects:dictionary.category')}
                  tooltip={t('objects:dictionary.categoryHint')}
                >
                  <Input maxLength={100} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="ownerId" label={t('objects:dictionary.owner')}>
                  <UserSelect allowClear known={object?.owner ? [object.owner] : []} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
        <BilingualFields
          description
          descriptionLabels={
            isTerm
              ? {
                  en: t('objects:dictionary.definitionEn'),
                  ar: t('objects:dictionary.definitionAr'),
                }
              : undefined
          }
        />
        {isTerm && (
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="synonymsEn"
                label={t('objects:dictionary.synonymsEn')}
                extra={t('objects:dictionary.synonymsHint')}
              >
                <Select mode="tags" open={false} maxCount={20} tokenSeparators={[',']} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="synonymsAr" label={t('objects:dictionary.synonymsAr')}>
                <Select mode="tags" open={false} maxCount={20} tokenSeparators={['،', ',']} />
              </Form.Item>
            </Col>
          </Row>
        )}
        {type === 'ROLE' && (
          <Form.Item
            name="roleDepartmentId"
            label={t('fields.department')}
            extra={t('diagrams:org.roleDepartmentHint')}
          >
            <TreeSelect
              allowClear
              treeDefaultExpandAll
              treeData={departments}
              placeholder={t('none')}
            />
          </Form.Item>
        )}
        <Typography.Text strong>{t('objects:attributes')}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t(`objects:attributesHint.${type}`, {
            defaultValue: t('objects:attributesHint.default'),
          })}
        </Typography.Paragraph>
        <Form.List name="attributes">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Row key={field.key} gutter={8} align="middle">
                  <Col span={10}>
                    <Form.Item name={[field.name, 'key']} rules={[{ max: 100 }]}>
                      <Input placeholder={t('objects:attributeName')} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={[field.name, 'value']} rules={[{ max: 2000 }]}>
                      <Input placeholder={t('objects:attributeValue')} />
                    </Form.Item>
                  </Col>
                  <Col span={2}>
                    <Form.Item>
                      <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                        aria-label={t('delete')}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ))}
              <Space>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ key: '', value: '' })}
                  disabled={fields.length >= 50}
                >
                  {t('objects:addAttribute')}
                </Button>
              </Space>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
