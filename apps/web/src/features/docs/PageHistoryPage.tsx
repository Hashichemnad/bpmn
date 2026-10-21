import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DiffOutlined, EyeOutlined, RollbackOutlined, TagOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Locale, PageVersionDto } from '@processhub/shared';
import {
  fetchPageVersion,
  useLabelPageVersion,
  usePage,
  usePageVersions,
  useRestorePageVersion,
} from '@/api/docs';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RichTextView } from './RichTextView';
import { DiffStatsTags, PageDiffView } from './PageDiffView';
import { useDiff } from './use-diff';
import { useSpaceContext } from './space-context';
import { SummaryButton } from '@/features/ai/SummaryModal';

export function VersionTitle({
  v,
}: {
  v: Pick<PageVersionDto, 'versionNumber' | 'label' | 'restoredFrom'>;
}) {
  const { t } = useTranslation();
  return (
    <Space size={4} wrap>
      <Tag color="blue">v{v.versionNumber}</Tag>
      {v.label && (
        <Tag color="purple" icon={<TagOutlined />}>
          {v.label}
        </Tag>
      )}
      {v.restoredFrom && <Tag>{t('docs:history.restoredFrom', { number: v.restoredFrom })}</Tag>}
    </Space>
  );
}

const useVersionDetail = (pageId: string, versionId: string | null) =>
  useQuery({
    queryKey: ['pages', pageId, 'versions', versionId],
    queryFn: () => fetchPageVersion(pageId, versionId!),
    enabled: !!versionId,
    staleTime: Infinity,
  });

export function PageHistoryPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const { space } = useSpaceContext();
  const page = usePage(pageId);
  const versions = usePageVersions(pageId!);
  const restore = useRestorePageVersion(pageId!);
  const label = useLabelPageVersion(pageId!);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'side' | 'inline'>('side');
  const [lang, setLang] = useState<Locale>(locale);
  const [preview, setPreview] = useState<string | null>(null);
  const [labelling, setLabelling] = useState<PageVersionDto | null>(null);
  const [labelForm] = Form.useForm<{ label: string }>();

  const list = useMemo(() => versions.data ?? [], [versions.data]);
  // Default comparison: the latest version against the one before it.
  const aId = params.get('a') ?? list[1]?.id ?? null;
  const bId = params.get('b') ?? list[0]?.id ?? null;
  const a = useVersionDetail(pageId!, aId);
  const b = useVersionDetail(pageId!, bId);
  const previewed = useVersionDetail(pageId!, preview);
  const pick = (v: { contentEn: string; contentAr: string } | undefined) =>
    v ? (lang === 'ar' ? v.contentAr : v.contentEn) : '';
  const { rows, stats } = useDiff(pick(a.data), pick(b.data));
  const dir = lang === 'ar' ? (b.data?.dirAr ?? 'rtl') : (b.data?.dirEn ?? 'ltr');

  if (page.isLoading || versions.isLoading) return <LoadingState />;
  if (page.isError || !page.data)
    return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const p = page.data;
  const latest = list[0]?.versionNumber;

  const compareSelected = () => {
    const [x, y] = selected
      .map((id) => list.find((v) => v.id === id)!)
      .sort((m, n) => m.versionNumber - n.versionNumber);
    setParams({ a: x.id, b: y.id });
    setSelected([]);
  };

  const confirmRestore = (v: PageVersionDto) =>
    modal.confirm({
      title: t('docs:history.restoreTitle', { number: v.versionNumber }),
      content: t('docs:history.restoreText', { next: (latest ?? 0) + 1 }),
      okText: t('docs:history.restore'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await restore.mutateAsync({ versionId: v.id, body: {} });
          message.success(t('docs:history.restored', { number: v.versionNumber }));
          setParams({});
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const saveLabel = async () => {
    const { label: value } = await labelForm.validateFields();
    try {
      await label.mutateAsync({ versionId: labelling!.id, body: { label: value?.trim() || null } });
      setLabelling(null);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const numOf = (id: string | null) => list.find((x) => x.id === id)?.versionNumber;
  const [na, nb] = [numOf(aId), numOf(bId)];
  const comparePair =
    na !== undefined && nb !== undefined && na !== nb
      ? { from: Math.min(na, nb), to: Math.max(na, nb) }
      : null;

  const vName = (id: string | null) => {
    const v = list.find((x) => x.id === id);
    return v ? `v${v.versionNumber}` : '—';
  };

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.docs'), to: '/docs' },
          { title: loc(space), to: `/docs/${space.id}` },
          { title: loc(p, 'title') || t('docs:untitled'), to: `/docs/${space.id}/pages/${p.id}` },
          { title: t('docs:history.title') },
        ]}
        title={t('docs:history.title')}
        subtitle={loc(p, 'title')}
        extra={
          <Link to={`/docs/${space.id}/pages/${p.id}`}>
            <Button>{t('docs:history.backToPage')}</Button>
          </Link>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} xxl={10}>
          <Card
            title={t('docs:history.versions', { count: list.length })}
            extra={
              <Tooltip title={t('docs:history.selectTwo')}>
                <Button
                  icon={<DiffOutlined />}
                  disabled={selected.length !== 2}
                  onClick={compareSelected}
                >
                  {t('docs:history.compareSelected')}
                </Button>
              </Tooltip>
            }
          >
            <Table
              rowKey="id"
              size="small"
              dataSource={list}
              pagination={list.length > 15 ? { pageSize: 15 } : false}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected((keys as string[]).slice(-2)),
                hideSelectAll: true,
                columnTitle: ' ',
              }}
              rowClassName={(v) => (v.id === aId || v.id === bId ? 'ph-row-compared' : '')}
              columns={[
                {
                  title: t('docs:history.version'),
                  key: 'v',
                  render: (_, v) => (
                    <>
                      <VersionTitle v={v} />
                      <div>{v.changeNote}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(v.createdAt)} · {loc(v.createdBy) || v.createdBy?.email || '—'}
                      </Typography.Text>
                    </>
                  ),
                },
                {
                  key: 'actions',
                  align: 'end',
                  width: 120,
                  render: (_, v) => (
                    <Space size={2}>
                      <Tooltip title={t('view')}>
                        <Button
                          size="small"
                          type="text"
                          icon={<EyeOutlined />}
                          aria-label={t('view')}
                          onClick={() => setPreview(v.id)}
                        />
                      </Tooltip>
                      {p.canEdit && (
                        <Tooltip title={t('docs:history.label')}>
                          <Button
                            size="small"
                            type="text"
                            icon={<TagOutlined />}
                            aria-label={t('docs:history.label')}
                            onClick={() => {
                              labelForm.setFieldsValue({ label: v.label ?? '' });
                              setLabelling(v);
                            }}
                          />
                        </Tooltip>
                      )}
                      {p.canEdit && v.versionNumber !== latest && (
                        <Tooltip title={t('docs:history.restore')}>
                          <Button
                            size="small"
                            type="text"
                            icon={<RollbackOutlined />}
                            aria-label={t('docs:history.restore')}
                            onClick={() => confirmRestore(v)}
                          />
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xxl={14}>
          <Card
            title={
              <Space wrap>
                {t('docs:history.comparing', { a: vName(aId), b: vName(bId) })}
                {aId && bId && <DiffStatsTags stats={stats} />}
              </Space>
            }
            extra={
              <Space wrap>
                {comparePair && (
                  <SummaryButton
                    size="small"
                    target={{ type: 'PAGE', id: p.id, compare: comparePair }}
                  />
                )}
                <Segmented
                  size="small"
                  value={lang}
                  onChange={(l) => setLang(l as Locale)}
                  options={[
                    { value: 'en', label: 'EN' },
                    { value: 'ar', label: 'عربي' },
                  ]}
                />
                <Segmented
                  size="small"
                  value={mode}
                  onChange={(m) => setMode(m as 'side' | 'inline')}
                  options={[
                    { value: 'side', label: t('docs:diff.sideBySide') },
                    { value: 'inline', label: t('docs:diff.inline') },
                  ]}
                />
              </Space>
            }
          >
            {list.length < 2 ? (
              <Empty description={t('docs:history.onlyOne')} />
            ) : a.isLoading || b.isLoading ? (
              <LoadingState />
            ) : a.isError || b.isError ? (
              <ErrorState error={a.error ?? b.error} />
            ) : (
              <>
                {a.data &&
                  b.data &&
                  (lang === 'ar'
                    ? a.data.titleAr !== b.data.titleAr
                    : a.data.titleEn !== b.data.titleEn) && (
                    <Flex gap={8} className="ph-diff-title-change" wrap="wrap">
                      <Typography.Text type="secondary">
                        {t('docs:diff.titleChanged')}
                      </Typography.Text>
                      <del className="ph-diff-del">
                        {lang === 'ar' ? a.data.titleAr : a.data.titleEn}
                      </del>
                      <ins className="ph-diff-ins">
                        {lang === 'ar' ? b.data.titleAr : b.data.titleEn}
                      </ins>
                    </Flex>
                  )}
                <PageDiffView
                  rows={rows}
                  mode={mode}
                  dir={dir}
                  leftTitle={vName(aId)}
                  rightTitle={vName(bId)}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width="min(1000px, 95vw)"
        title={previewed.data ? <VersionTitle v={previewed.data} /> : ''}
        destroyOnHidden
      >
        {previewed.isLoading || !previewed.data ? (
          <LoadingState />
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              {previewed.data.changeNote} · {formatDate(previewed.data.createdAt)}
            </Typography.Paragraph>
            <Segmented
              size="small"
              value={lang}
              onChange={(l) => setLang(l as Locale)}
              options={[
                { value: 'en', label: 'EN' },
                { value: 'ar', label: 'عربي' },
              ]}
              style={{ marginBottom: 12 }}
            />
            <Typography.Title
              level={3}
              dir={lang === 'ar' ? previewed.data.dirAr : previewed.data.dirEn}
            >
              {lang === 'ar'
                ? previewed.data.titleAr || previewed.data.titleEn
                : previewed.data.titleEn || previewed.data.titleAr}
            </Typography.Title>
            <RichTextView
              key={`${preview}-${lang}`}
              html={lang === 'ar' ? previewed.data.contentAr : previewed.data.contentEn}
              dir={lang === 'ar' ? previewed.data.dirAr : previewed.data.dirEn}
              lang={lang}
            />
          </>
        )}
      </Modal>
      <Modal
        open={!!labelling}
        title={labelling ? t('docs:history.labelTitle', { number: labelling.versionNumber }) : ''}
        onCancel={() => setLabelling(null)}
        onOk={() => void saveLabel()}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={label.isPending}
        destroyOnHidden
      >
        <Form form={labelForm} layout="vertical">
          <Form.Item
            name="label"
            label={t('docs:history.labelField')}
            extra={t('docs:history.labelHint')}
            rules={[{ max: 100 }]}
          >
            <Input maxLength={100} autoFocus placeholder={t('docs:history.labelPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
