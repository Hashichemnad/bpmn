import { useEffect, useState } from 'react';
import { App, Button, Card, InputNumber, Space, Switch, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  CONVENTION_RULES,
  CONVENTIONS_MAX_ELEMENTS_LIMITS,
  DEFAULT_CONVENTIONS,
  type ConventionRule,
  type ModelingConventions,
} from '@processhub/shared';
import { useConventions, useSaveConventions } from '@/api/conventions';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';

/**
 * Settings → Modeling conventions (D-088): which house rules the Validation panel shows and which
 * of them must pass before a process can be submitted for review.
 */
export function ConventionsSettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const query = useConventions();
  const save = useSaveConventions();
  const [value, setValue] = useState<ModelingConventions | null>(null);

  useEffect(() => {
    if (query.data) setValue(query.data);
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !value) return <ErrorState error={query.error} />;

  const setRule = (
    rule: ConventionRule,
    patch: Partial<{ enabled: boolean; mandatory: boolean }>,
  ) =>
    setValue((v) => {
      if (!v) return v;
      const next = { ...v.rules[rule], ...patch };
      // Mandatory implies enabled; switching a rule off also drops "mandatory".
      if (patch.mandatory) next.enabled = true;
      if (patch.enabled === false) next.mandatory = false;
      return { ...v, rules: { ...v.rules, [rule]: next } };
    });

  const submit = async () => {
    try {
      await save.mutateAsync(value);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title={t('admin:conventions.title')}
        subtitle={t('admin:conventions.subtitle')}
        extra={
          <Space>
            <Button onClick={() => setValue(DEFAULT_CONVENTIONS)}>
              {t('admin:conventions.reset')}
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
              {t('save')}
            </Button>
          </Space>
        }
      />
      <Card>
        <Table
          rowKey="rule"
          pagination={false}
          dataSource={CONVENTION_RULES.map((rule) => ({ rule }))}
          columns={[
            {
              title: t('admin:conventions.rule'),
              render: (_, { rule }) => (
                <>
                  <Typography.Text strong>
                    {t(`admin:conventions.rules.${rule}.title`)}
                  </Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ marginBlock: 0 }}>
                    {t(`admin:conventions.rules.${rule}.hint`)}
                  </Typography.Paragraph>
                  {rule === 'maxElements' && (
                    <Space style={{ marginBlockStart: 8 }}>
                      <Typography.Text>{t('admin:conventions.maxElements')}</Typography.Text>
                      <InputNumber
                        size="small"
                        min={CONVENTIONS_MAX_ELEMENTS_LIMITS.min}
                        max={CONVENTIONS_MAX_ELEMENTS_LIMITS.max}
                        precision={0}
                        aria-label={t('admin:conventions.maxElements')}
                        value={value.maxElements}
                        onChange={(n) =>
                          setValue((v) =>
                            v && typeof n === 'number' ? { ...v, maxElements: n } : v,
                          )
                        }
                      />
                    </Space>
                  )}
                </>
              ),
            },
            {
              title: t('admin:conventions.enabled'),
              width: 140,
              align: 'center',
              render: (_, { rule }) => (
                <Switch
                  aria-label={`${t(`admin:conventions.rules.${rule}.title`)} — ${t('admin:conventions.enabled')}`}
                  checked={value.rules[rule].enabled}
                  onChange={(enabled) => setRule(rule, { enabled })}
                />
              ),
            },
            {
              title: t('admin:conventions.mandatory'),
              width: 200,
              align: 'center',
              render: (_, { rule }) => (
                <Switch
                  aria-label={`${t(`admin:conventions.rules.${rule}.title`)} — ${t('admin:conventions.mandatory')}`}
                  checked={value.rules[rule].mandatory}
                  onChange={(mandatory) => setRule(rule, { mandatory })}
                />
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginBlock: '16px 0' }}>
          {t('admin:conventions.footnote')}
        </Typography.Paragraph>
      </Card>
    </>
  );
}
