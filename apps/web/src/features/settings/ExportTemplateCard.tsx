import { useEffect } from 'react';
import { App, Button, Card, ColorPicker, Flex, Form, Switch, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Color } from 'antd/es/color-picker';
import type { ExportTemplate } from '@processhub/shared';
import { api } from '@/api/client';
import { useErrorMessage } from '@/components/i18n-helpers';

const KEY = ['exports', 'template'] as const;
const hex = (v: unknown) =>
  typeof v === 'string' ? v : ((v as Color | undefined)?.toHexString?.().slice(0, 7) ?? '#1F4E79');

/** Settings → Branding: colours (and logo placement) of PowerPoint and offline HTML exports. */
export function ExportTemplateCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: KEY, queryFn: () => api<ExportTemplate>('/exports/template') });
  const save = useMutation({
    mutationFn: (body: ExportTemplate) =>
      api<ExportTemplate>('/exports/template', { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const [form] = Form.useForm<ExportTemplate>();
  useEffect(() => {
    if (tpl.data) form.setFieldsValue(tpl.data);
  }, [tpl.data, form]);

  return (
    <Card title={t('integrations:template.title')} loading={tpl.isLoading}>
      <Typography.Paragraph type="secondary">
        {t('integrations:template.hint')}
      </Typography.Paragraph>
      <Form<ExportTemplate>
        form={form}
        layout="vertical"
        onFinish={(v) =>
          save.mutate(
            {
              primaryColor: hex(v.primaryColor).toUpperCase(),
              accentColor: hex(v.accentColor).toUpperCase(),
              logoOnEverySlide: v.logoOnEverySlide,
            },
            {
              onSuccess: () => message.success(t('saved')),
              onError: (err) => message.error(errorMessage(err)),
            },
          )
        }
      >
        <Flex gap={24} wrap>
          <Form.Item name="primaryColor" label={t('integrations:template.primary')}>
            <ColorPicker disabledAlpha showText />
          </Form.Item>
          <Form.Item name="accentColor" label={t('integrations:template.accent')}>
            <ColorPicker disabledAlpha showText />
          </Form.Item>
        </Flex>
        <Form.Item
          name="logoOnEverySlide"
          label={t('integrations:template.logoOnEverySlide')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Button htmlType="submit" loading={save.isPending}>
          {t('save')}
        </Button>
      </Form>
    </Card>
  );
}
