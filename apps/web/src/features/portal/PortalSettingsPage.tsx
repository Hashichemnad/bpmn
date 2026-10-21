import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  App,
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
  PORTAL_MAX_FEATURED,
  PORTAL_MAX_QUICK_LINKS,
  SYSTEM_ROLE_KEYS,
  type PortalPageNodeDto,
  type PortalSettingsInput,
} from '@processhub/shared';
import { api } from '@/api/client';
import {
  portalKeys,
  usePortalProcesses,
  usePortalSettings,
  usePortalSpaces,
  useSavePortalSettings,
} from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';

type FormValues = Omit<PortalSettingsInput, 'featured'> & { featured: string[] };

/** Portal name and tagline, quick links, featured content and who may use the portal. */
export function PortalSettingsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = usePortalSettings();
  const save = useSavePortalSettings();
  const processes = usePortalProcesses();
  const spaces = usePortalSpaces();
  const departments = useDepartmentTreeData();
  const pages = useQueries({
    queries: (spaces.data ?? []).map((s) => ({
      queryKey: portalKeys.spacePages(s.id),
      queryFn: () => api<PortalPageNodeDto[]>(`/portal/spaces/${s.id}/pages`),
    })),
  });
  const [form] = Form.useForm<FormValues>();
  const mode = Form.useWatch(['access', 'mode'], form);

  const featuredOptions = useMemo(
    () => [
      {
        label: t('portal:nav.processes'),
        options: (processes.data ?? []).map((p) => ({
          value: `PROCESS:${p.id}`,
          label: `${p.code} ${loc(p)}`,
        })),
      },
      {
        label: t('portal:nav.docs'),
        options: pages.flatMap((q) =>
          (q.data ?? []).map((p) => ({ value: `PAGE:${p.id}`, label: loc(p, 'title') })),
        ),
      },
    ],
    [processes.data, pages, loc, t],
  );

  useEffect(() => {
    if (!settings.data) return;
    form.setFieldsValue({
      ...settings.data,
      featured: settings.data.featured.map((f) => `${f.entityType}:${f.entityId}`),
    });
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const submit = async (v: FormValues) => {
    try {
      await save.mutateAsync({
        ...v,
        quickLinks: v.quickLinks ?? [],
        access: {
          mode: v.access.mode,
          departmentIds: v.access.departmentIds ?? [],
          roleKeys: v.access.roleKeys ?? [],
        },
        featured: (v.featured ?? []).map((f) => {
          const [entityType, entityId] = f.split(':') as ['PROCESS' | 'PAGE', string];
          return { entityType, entityId };
        }),
      });
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title={t('portal:settings.title')} subtitle={t('portal:settings.subtitle')} />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)}>
        <Row gutter={[24, 24]}>
          <Col xs={24} xl={12}>
            <Card title={t('portal:settings.branding')}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="nameEn" label={t('portal:settings.nameEn')}>
                    <Input dir="ltr" maxLength={200} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="nameAr" label={t('portal:settings.nameAr')}>
                    <Input dir="rtl" maxLength={200} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="taglineEn" label={t('portal:settings.taglineEn')}>
                    <Input.TextArea dir="ltr" rows={2} maxLength={300} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="taglineAr" label={t('portal:settings.taglineAr')}>
                    <Input.TextArea dir="rtl" rows={2} maxLength={300} />
                  </Form.Item>
                </Col>
              </Row>
              <Typography.Text type="secondary">{t('portal:settings.logoHint')}</Typography.Text>
            </Card>
            <Card title={t('portal:settings.access')} style={{ marginBlockStart: 24 }}>
              <Form.Item name={['access', 'mode']}>
                <Radio.Group
                  options={[
                    { value: 'ALL', label: t('portal:settings.accessAll') },
                    { value: 'RESTRICTED', label: t('portal:settings.accessRestricted') },
                  ]}
                />
              </Form.Item>
              {mode === 'RESTRICTED' && (
                <>
                  <Form.Item
                    name={['access', 'departmentIds']}
                    label={t('portal:settings.departments')}
                  >
                    <TreeSelect multiple allowClear treeData={departments} treeDefaultExpandAll />
                  </Form.Item>
                  <Form.Item name={['access', 'roleKeys']} label={t('portal:settings.roles')}>
                    <Select
                      mode="multiple"
                      allowClear
                      options={SYSTEM_ROLE_KEYS.map((r) => ({
                        value: r,
                        label: t(`admin:roles.${r}`),
                      }))}
                    />
                  </Form.Item>
                  <Typography.Text type="secondary">
                    {t('portal:settings.accessHint')}
                  </Typography.Text>
                </>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title={t('portal:settings.featured')}>
              <Form.Item
                name="featured"
                extra={t('portal:settings.featuredHint', { max: PORTAL_MAX_FEATURED })}
              >
                <Select
                  mode="multiple"
                  allowClear
                  optionFilterProp="label"
                  maxCount={PORTAL_MAX_FEATURED}
                  options={featuredOptions}
                />
              </Form.Item>
            </Card>
            <Card title={t('portal:settings.quickLinks')} style={{ marginBlockStart: 24 }}>
              <Form.List name="quickLinks">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((f) => (
                      <Flex key={f.key} gap={8} align="start" wrap="wrap">
                        <Form.Item
                          name={[f.name, 'titleEn']}
                          style={{ flex: 1, minInlineSize: 120 }}
                        >
                          <Input dir="ltr" placeholder={t('portal:settings.linkTitleEn')} />
                        </Form.Item>
                        <Form.Item
                          name={[f.name, 'titleAr']}
                          style={{ flex: 1, minInlineSize: 120 }}
                        >
                          <Input dir="rtl" placeholder={t('portal:settings.linkTitleAr')} />
                        </Form.Item>
                        <Form.Item
                          name={[f.name, 'url']}
                          style={{ flex: 2, minInlineSize: 180 }}
                          rules={[
                            { required: true, message: t('validation.required') },
                            {
                              pattern: /^(https?:\/\/\S+|\/(?!\/)\S*)$/,
                              message: t('portal:settings.urlInvalid'),
                            },
                          ]}
                        >
                          <Input dir="ltr" placeholder="https://… or /portal/…" />
                        </Form.Item>
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(f.name)}
                          aria-label={t('delete')}
                        />
                      </Flex>
                    ))}
                    <Button
                      icon={<PlusOutlined />}
                      disabled={fields.length >= PORTAL_MAX_QUICK_LINKS}
                      onClick={() => add({ titleEn: '', titleAr: '', url: '' })}
                    >
                      {t('portal:settings.addLink')}
                    </Button>
                  </>
                )}
              </Form.List>
            </Card>
          </Col>
        </Row>
        <Button
          type="primary"
          htmlType="submit"
          loading={save.isPending}
          style={{ marginBlockStart: 24 }}
        >
          {t('save')}
        </Button>
      </Form>
    </>
  );
}
