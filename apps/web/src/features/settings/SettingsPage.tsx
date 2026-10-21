import { useEffect } from 'react';
import { Alert, App, Button, Card, Col, Flex, Form, Input, Popconfirm, Radio, Row, Space, Tag, Typography, Upload } from 'antd';
import { DeleteOutlined, GithubOutlined, GitlabOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES, type UpdateSettingsInput } from '@processhub/shared';
import { useRemoveLogo, useSettings, useUpdateSettings, useUploadLogo } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';
import { BrandMark } from '@/layout/BrandMark';

export function SettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useSettings();
  const update = useUpdateSettings();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const [form] = Form.useForm<UpdateSettingsInput>();

  useEffect(() => {
    if (settings.data) {
      form.setFieldsValue({
        orgNameEn: settings.data.orgNameEn,
        orgNameAr: settings.data.orgNameAr,
        defaultLocale: settings.data.defaultLocale,
      });
    }
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const save = async (values: UpdateSettingsInput) => {
    try {
      await update.mutateAsync(values);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const beforeUpload = (file: File) => {
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      message.error(t('errors:UNSUPPORTED_FILE_TYPE'));
      return Upload.LIST_IGNORE;
    }
    if (file.size > LOGO_MAX_BYTES) {
      message.error(t('errors:FILE_TOO_LARGE'));
      return Upload.LIST_IGNORE;
    }
    upload.mutate(file, {
      onSuccess: () => message.success(t('admin:settings.logoUpdated')),
      onError: (err) => message.error(errorMessage(err)),
    });
    return false;
  };

  return (
    <>
      <PageHeader title={t('admin:settings.title')} subtitle={t('admin:settings.subtitle')} />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card title={t('admin:settings.organisation')}>
            <Form form={form} layout="vertical" onFinish={save}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="orgNameEn" label={t('admin:settings.orgNameEn')} rules={[{ max: 200 }]}>
                    <Input dir="ltr" lang="en" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="orgNameAr" label={t('admin:settings.orgNameAr')} rules={[{ max: 200 }]}>
                    <Input dir="rtl" lang="ar" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="defaultLocale" label={t('admin:settings.defaultLanguage')} extra={t('admin:settings.defaultLanguageHint')}>
                <Radio.Group
                  optionType="button"
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'العربية', value: 'ar' },
                  ]}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={update.isPending}>
                {t('save')}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={t('admin:settings.logo')}>
            <Flex align="center" gap={20}>
              <div className="ph-logo-preview">
                <BrandMark settings={settings.data} size={72} />
              </div>
              <Space direction="vertical">
                <Upload accept={LOGO_MIME_TYPES.join(',')} showUploadList={false} beforeUpload={beforeUpload} maxCount={1}>
                  <Button icon={<UploadOutlined />} loading={upload.isPending}>
                    {t('admin:settings.uploadLogo')}
                  </Button>
                </Upload>
                {settings.data?.hasLogo && (
                  <Popconfirm
                    title={t('admin:settings.removeLogoConfirm')}
                    okText={t('delete')}
                    cancelText={t('cancel')}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => removeLogo.mutate(undefined, { onError: (e) => message.error(errorMessage(e)) })}
                  >
                    <Button danger type="link" icon={<DeleteOutlined />} style={{ paddingInline: 0 }}>
                      {t('admin:settings.removeLogo')}
                    </Button>
                  </Popconfirm>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('admin:settings.logoHint')}
                </Typography.Text>
              </Space>
            </Flex>
          </Card>
        </Col>
        <Col span={24}>
          <Card title={t('admin:settings.integrations')} extra={<Tag>{t('admin:settings.comingPhase2')}</Tag>}>
            <Alert type="info" showIcon message={t('admin:settings.integrationsInfo')} style={{ marginBottom: 16 }} />
            <Row gutter={[16, 16]}>
              {[
                { key: 'github', icon: <GithubOutlined />, name: 'GitHub' },
                { key: 'gitlab', icon: <GitlabOutlined />, name: 'GitLab' },
              ].map((i) => (
                <Col xs={24} md={12} key={i.key}>
                  <Card size="small" className="ph-integration-card">
                    <Flex justify="space-between" align="center">
                      <Space>
                        <span style={{ fontSize: 22 }}>{i.icon}</span>
                        <div>
                          <Typography.Text strong>{i.name}</Typography.Text>
                          <br />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {t('admin:settings.integrationDescription')}
                          </Typography.Text>
                        </div>
                      </Space>
                      <Tag>{t('admin:settings.disabled')}</Tag>
                    </Flex>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </>
  );
}
