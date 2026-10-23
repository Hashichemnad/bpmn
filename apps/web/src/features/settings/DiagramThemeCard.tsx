import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  ColorPicker,
  Flex,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { BgColorsOutlined, UndoOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DIAGRAM_THEME,
  THEME_KINDS,
  type DiagramTheme,
  type ThemeKind,
} from '@processhub/shared';
import {
  useApplyDiagramTheme,
  usePublicSettings,
  useResetDiagramTheme,
  useSetDiagramTheme,
} from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import type { BpmnInstance, Canvas } from '@/features/modeler/bpmn-types';
import { createDiagram, importDiagram } from '@/features/modeler/create-diagram';
import { applyLanguage } from '@/features/modeler/diagram';
import { themePreviewXml } from './theme-preview';

type Field = 'fill' | 'stroke' | 'fillAlt';

/** Live preview of the theme on a small sample diagram, in the active language. */
function ThemePreview({ theme }: { theme: DiagramTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<BpmnInstance | null>(null);
  const { locale } = useLocale();
  useEffect(() => {
    if (!ref.current) return;
    viewer.current = createDiagram('viewer', { container: ref.current });
    return () => {
      viewer.current?.destroy();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    const id = setTimeout(() => {
      const v = viewer.current;
      if (!v) return;
      void importDiagram(v, themePreviewXml(theme)).then(() => {
        applyLanguage(v, locale);
        v.get<Canvas>('canvas').zoom('fit-viewport', 'auto');
      });
    }, 120);
    return () => clearTimeout(id);
  }, [theme, locale]);
  return <div ref={ref} dir="ltr" className="ph-theme-preview" />;
}

/** Settings → Branding: colours of diagram elements by kind (Super Admin). */
export function DiagramThemeCard() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = usePublicSettings();
  const save = useSetDiagramTheme();
  const reset = useResetDiagramTheme();
  const apply = useApplyDiagramTheme();
  const stored = settings.data?.diagramTheme ?? DEFAULT_DIAGRAM_THEME;
  const [draft, setDraft] = useState<DiagramTheme>(stored);
  useEffect(() => setDraft(stored), [stored]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(stored), [draft, stored]);

  const set = (kind: ThemeKind, field: Field, value: string) =>
    setDraft((d) => ({ ...d, [kind]: { ...d[kind], [field]: value.toUpperCase() } }));

  const swatch = (kind: ThemeKind, field: Field) => {
    const value = (draft[kind] as Record<Field, string>)[field];
    return (
      <ColorPicker
        size="small"
        format="hex"
        disabledAlpha
        showText
        value={value}
        aria-label={`${t(`admin:theme.kind.${kind}`)} — ${t(`admin:theme.${field}`)}`}
        presets={[
          {
            label: t('admin:theme.defaults'),
            colors: [
              ...new Set(
                THEME_KINDS.flatMap((k) => [
                  DEFAULT_DIAGRAM_THEME[k].fill,
                  DEFAULT_DIAGRAM_THEME[k].stroke,
                ]),
              ),
            ],
          },
        ]}
        onChangeComplete={(c) => set(kind, field, c.toHexString())}
      />
    );
  };

  const onSave = async () => {
    try {
      await save.mutateAsync(draft);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const onReset = async () => {
    try {
      await reset.mutateAsync();
      setDraft(DEFAULT_DIAGRAM_THEME);
      message.success(t('admin:theme.resetDone'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const onApply = async () => {
    try {
      const dry = await apply.mutateAsync(true);
      if (!dry.models) {
        message.info(
          dry.skipped
            ? t('admin:theme.applySkipped', { count: dry.skipped })
            : t('admin:theme.applyNothing'),
        );
        return;
      }
      modal.confirm({
        title: t('admin:theme.applyTitle'),
        width: 520,
        content: (
          <Space direction="vertical" size={4}>
            <Typography.Text>
              {t('admin:theme.applyText', { models: dry.models, elements: dry.elements })}
            </Typography.Text>
            {dry.inPlace > 0 && (
              <Typography.Text>
                {t('admin:theme.applyInPlace', { count: dry.inPlace })}
              </Typography.Text>
            )}
            {dry.published > 0 && (
              <Typography.Text type="warning">
                {t('admin:theme.applyPublished', { count: dry.published })}
              </Typography.Text>
            )}
            {dry.skipped > 0 && (
              <Typography.Text type="secondary">
                {t('admin:theme.applySkipped', { count: dry.skipped })}
              </Typography.Text>
            )}
          </Space>
        ),
        okText: t('admin:theme.applyOk'),
        cancelText: t('cancel'),
        onOk: async () => {
          try {
            const res = await apply.mutateAsync(false);
            message.success(t('admin:theme.applyDone', { count: res.models }));
          } catch (err) {
            message.error(errorMessage(err));
          }
        },
      });
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Card
      title={
        <Space>
          <BgColorsOutlined />
          {t('admin:theme.title')}
          <Tag color={settings.data?.diagramThemeCustomised ? 'blue' : 'default'}>
            {settings.data?.diagramThemeCustomised
              ? t('admin:theme.customised')
              : t('admin:theme.default')}
          </Tag>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t('admin:theme.intro')}</Typography.Paragraph>
      <Row gutter={[24, 16]}>
        <Col xs={24} xl={11}>
          <table className="ph-theme-table">
            <thead>
              <tr>
                <th scope="col">{t('admin:theme.element')}</th>
                <th scope="col">{t('admin:theme.fill')}</th>
                <th scope="col">{t('admin:theme.stroke')}</th>
              </tr>
            </thead>
            <tbody>
              {THEME_KINDS.map((kind) => (
                <tr key={kind}>
                  <th scope="row">{t(`admin:theme.kind.${kind}`)}</th>
                  <td>
                    <Space direction="vertical" size={4}>
                      {swatch(kind, 'fill')}
                      {kind === 'lane' && (
                        <Space size={4} wrap>
                          {swatch(kind, 'fillAlt')}
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                          >
                            {t('admin:theme.fillAlt')}
                          </Typography.Text>
                        </Space>
                      )}
                    </Space>
                  </td>
                  <td>{swatch(kind, 'stroke')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Col>
        <Col xs={24} xl={13}>
          <Typography.Text strong>{t('admin:theme.preview')}</Typography.Text>
          <ThemePreview theme={draft} />
        </Col>
      </Row>
      <Flex wrap="wrap" gap={8} justify="space-between" style={{ marginBlockStart: 16 }}>
        <Space wrap>
          <Button
            type="primary"
            onClick={() => void onSave()}
            loading={save.isPending}
            disabled={!dirty}
          >
            {t('save')}
          </Button>
          {dirty && <Button onClick={() => setDraft(stored)}>{t('admin:theme.discard')}</Button>}
          <Popconfirm
            title={t('admin:theme.resetConfirm')}
            okText={t('admin:theme.reset')}
            cancelText={t('cancel')}
            onConfirm={() => void onReset()}
          >
            <Button icon={<UndoOutlined />} loading={reset.isPending}>
              {t('admin:theme.reset')}
            </Button>
          </Popconfirm>
        </Space>
        <Button onClick={() => void onApply()} loading={apply.isPending} disabled={dirty}>
          {t('admin:theme.apply')}
        </Button>
      </Flex>
      {dirty && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockStart: 12 }}
          message={t('admin:theme.unsaved')}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ marginBlockStart: 12, fontSize: 12 }}>
        {t('admin:theme.applyHint')}
      </Typography.Paragraph>
    </Card>
  );
}
