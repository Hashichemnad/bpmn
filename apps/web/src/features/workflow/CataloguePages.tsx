import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { FileAddOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';
import { useCatalogue, useStartCase, useStartForm } from '@/api/workflow';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { CaseDiagram } from './CaseDiagram';
import { WorkflowForm } from './WorkflowForm';
import { formToData } from './form-utils';
import { casePath } from './wf-paths';

/** Portal → Services: executable processes the user may start (Phase 5.2 step 3). */
export function ServiceCataloguePage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const cat = useCatalogue();
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (cat.data ?? []).filter(
      (c) =>
        !s ||
        [c.code, c.nameEn, c.nameAr, c.descriptionEn, c.descriptionAr].some((x) =>
          x.toLowerCase().includes(s),
        ),
    );
  }, [cat.data, q]);
  if (cat.isLoading) return <LoadingState />;
  if (cat.isError) return <ErrorState error={cat.error} />;
  return (
    <Card>
      <Typography.Title level={3}>{t('workflow:catalogue.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t('workflow:catalogue.subtitle')}
      </Typography.Paragraph>
      <Input.Search
        allowClear
        placeholder={t('workflow:catalogue.search')}
        onChange={(e) => setQ(e.target.value)}
        style={{ maxWidth: 360, marginBlockEnd: 16 }}
      />
      {items.length === 0 ? (
        <Empty description={t('workflow:catalogue.empty')} />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((c) => (
            <Col key={c.processId} xs={24} md={12} xl={8}>
              <Card
                size="small"
                className="ph-service-card"
                title={
                  <Space>
                    <Tag dir="ltr">{c.code}</Tag>
                    {loc(c)}
                  </Space>
                }
                actions={[
                  <Link
                    key="start"
                    to={`/portal/services/${c.processId}`}
                    data-testid={`start-${c.code}`}
                  >
                    <FileAddOutlined /> {t('workflow:catalogue.start')}
                  </Link>,
                ]}
              >
                <Typography.Paragraph ellipsis={{ rows: 3 }} style={{ minBlockSize: 66 }}>
                  {loc(c, 'description') || t('workflow:catalogue.noDescription')}
                </Typography.Paragraph>
                <Space size={4} wrap>
                  {c.department && <Tag>{loc(c.department)}</Tag>}
                  {c.myOpenCases > 0 && (
                    <Tag color="blue">
                      {t('workflow:catalogue.myOpen', { count: c.myOpenCases })}
                    </Tag>
                  )}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}

/** Start form of a service (portal); on submit the request starts and its page opens. */
export function StartRequestPage() {
  const { processId } = useParams<{ processId: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const start = useStartForm(processId);
  const submit = useStartCase(processId!);
  const [form] = Form.useForm();
  if (start.isLoading) return <LoadingState />;
  if (start.isError || !start.data) return <ErrorState error={start.error} />;
  const s = start.data;
  const send = async () => {
    if (s.form) await form.validateFields();
    try {
      const res = await submit.mutateAsync({
        data: s.form ? formToData(s.form, form.getFieldsValue(true)) : {},
      });
      message.success(t('workflow:start.started', { number: res.number }));
      navigate(casePath(res.id, true));
    } catch (e) {
      message.error(errorMessage(e));
      if (e instanceof ApiError && e.code === 'FORM_INVALID' && Array.isArray(e.details))
        form.setFields(
          (e.details as { key: string; code: string }[]).map((x) => ({
            name: x.key,
            errors: [t(`workflow:formError.${x.code}`, { defaultValue: x.code })],
          })),
        );
    }
  };
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={13}>
        <Card>
          <Typography.Title level={3}>
            {t('workflow:start.title', { name: loc(s) })}
          </Typography.Title>
          {loc(s, 'description') && (
            <Typography.Paragraph>{loc(s, 'description')}</Typography.Paragraph>
          )}
          <Alert
            type="info"
            showIcon
            message={t('workflow:start.hint', { prefix: s.casePrefix })}
            style={{ marginBlockEnd: 16 }}
          />
          {s.form && s.form.fields.length > 0 ? (
            <WorkflowForm schema={s.form} form={form} />
          ) : (
            <Typography.Paragraph type="secondary">
              {t('workflow:start.noForm')}
            </Typography.Paragraph>
          )}
          <Space>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={submit.isPending}
              onClick={() => void send()}
              data-testid="wf-submit-request"
            >
              {t('workflow:start.submit')}
            </Button>
            <Link to="/portal/services">
              <Button>{t('cancel')}</Button>
            </Link>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={11}>
        <Card title={t('workflow:start.howItWorks')}>
          <CaseDiagram xml={s.bpmnXml} active={[]} />
        </Card>
      </Col>
    </Row>
  );
}
