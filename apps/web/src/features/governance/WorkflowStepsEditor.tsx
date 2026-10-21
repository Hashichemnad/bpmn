import {
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Radio,
  Row,
  Select,
  TreeSelect,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  MAX_WORKFLOW_STEPS,
  READ_ONLY_ROLE_KEYS,
  SYSTEM_ROLE_KEYS,
  type UserRef,
} from '@processhub/shared';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from './UserSelect';

/**
 * Edits `steps` of the surrounding Form: steps run one after another; each step needs
 * any one or all of its assignees (users, a role — optionally within a department — or the owner).
 */
export function WorkflowStepsEditor({ known = [] }: { known?: UserRef[] }) {
  const { t } = useTranslation();
  const departments = useDepartmentTreeData();
  const required = { required: true, message: t('validation.required') };
  return (
    <Form.List name="steps">
      {(steps, { add, remove, move }) => (
        <>
          {steps.map((step, index) => (
            <Card
              key={step.key}
              size="small"
              style={{ marginBlockEnd: 12 }}
              title={t('governance:workflows.stepN', { number: index + 1 })}
              extra={
                <Flex gap={4}>
                  <Button
                    size="small"
                    type="text"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={t('governance:workflows.moveUp')}
                  >
                    ↑
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={t('governance:workflows.moveDown')}
                  >
                    ↓
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={steps.length === 1}
                    onClick={() => remove(step.name)}
                    aria-label={t('delete')}
                  />
                </Flex>
              }
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name={[step.name, 'nameEn']} label={t('fields.nameEn')}>
                    <Input
                      dir="ltr"
                      lang="en"
                      placeholder={t('governance:workflows.stepNamePlaceholder')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name={[step.name, 'nameAr']} label={t('fields.nameAr')}>
                    <Input dir="rtl" lang="ar" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                name={[step.name, 'rule']}
                label={t('governance:workflows.rule')}
                initialValue="ANY"
              >
                <Radio.Group
                  options={[
                    { value: 'ANY', label: t('governance:rule.ANY') },
                    { value: 'ALL', label: t('governance:rule.ALL') },
                  ]}
                />
              </Form.Item>
              <Typography.Text type="secondary" style={{ display: 'block', marginBlockEnd: 8 }}>
                {t('governance:workflows.assignees')}
              </Typography.Text>
              <Form.List name={[step.name, 'assignees']}>
                {(assignees, ops) => (
                  <>
                    {assignees.map((a) => (
                      <Flex
                        key={a.key}
                        gap={8}
                        align="start"
                        wrap="wrap"
                        style={{ marginBlockEnd: 8 }}
                      >
                        <Form.Item
                          name={[a.name, 'type']}
                          rules={[required]}
                          style={{ marginBlockEnd: 0, minInlineSize: 160 }}
                        >
                          <Select
                            options={(['OWNER', 'ROLE', 'USER'] as const).map((v) => ({
                              value: v,
                              label: t(`governance:assignee.${v}`),
                            }))}
                          />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate>
                          {({ getFieldValue }) => {
                            const type = getFieldValue([
                              'steps',
                              step.name,
                              'assignees',
                              a.name,
                              'type',
                            ]);
                            if (type === 'USER') {
                              return (
                                <Form.Item
                                  name={[a.name, 'userId']}
                                  rules={[required]}
                                  style={{ marginBlockEnd: 0, flex: 1, minInlineSize: 220 }}
                                >
                                  <UserSelect known={known} />
                                </Form.Item>
                              );
                            }
                            if (type === 'ROLE') {
                              return (
                                <>
                                  <Form.Item
                                    name={[a.name, 'roleKey']}
                                    rules={[required]}
                                    style={{ marginBlockEnd: 0, minInlineSize: 180 }}
                                  >
                                    <Select
                                      placeholder={t('governance:workflows.role')}
                                      options={SYSTEM_ROLE_KEYS.filter(
                                        (r) => !READ_ONLY_ROLE_KEYS.includes(r),
                                      ).map((r) => ({
                                        value: r,
                                        label: t(`admin:roles.${r}`),
                                      }))}
                                    />
                                  </Form.Item>
                                  <Form.Item
                                    name={[a.name, 'departmentId']}
                                    style={{ marginBlockEnd: 0, flex: 1, minInlineSize: 200 }}
                                  >
                                    <TreeSelect
                                      allowClear
                                      treeDefaultExpandAll
                                      placeholder={t('governance:workflows.anyDepartment')}
                                      treeData={departments}
                                    />
                                  </Form.Item>
                                </>
                              );
                            }
                            return (
                              <Typography.Text type="secondary" style={{ paddingBlockStart: 5 }}>
                                {t('governance:workflows.ownerHint')}
                              </Typography.Text>
                            );
                          }}
                        </Form.Item>
                        <Button
                          type="text"
                          icon={<DeleteOutlined />}
                          disabled={assignees.length === 1}
                          onClick={() => ops.remove(a.name)}
                          aria-label={t('delete')}
                        />
                      </Flex>
                    ))}
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => ops.add({ type: 'ROLE', roleKey: 'REVIEWER' })}
                    >
                      {t('governance:workflows.addAssignee')}
                    </Button>
                  </>
                )}
              </Form.List>
            </Card>
          ))}
          <Button
            icon={<PlusOutlined />}
            disabled={steps.length >= MAX_WORKFLOW_STEPS}
            onClick={() =>
              add({
                nameEn: '',
                nameAr: '',
                rule: 'ANY',
                assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }],
              })
            }
          >
            {t('governance:workflows.addStep')}
          </Button>
        </>
      )}
    </Form.List>
  );
}
