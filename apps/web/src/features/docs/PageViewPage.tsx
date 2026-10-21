import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Flex,
  List,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@processhub/shared';
import { api } from '@/api/client';
import { useDeletePage, usePage } from '@/api/docs';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { RichTextView } from './RichTextView';
import { PageLinksPanel } from './PageLinksPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { useSpaceContext } from './space-context';
import { pageVersionFor, useLanguageVersion } from './useLanguageVersion';
import { GovernancePanel } from '@/features/governance/GovernancePanel';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { useGovernance } from '@/api/governance';
import { StatusTag } from '@/components/tags';
import { AiBadge } from '@/features/ai/AiParts';

export function LanguageAvailability({ hasEn, hasAr }: { hasEn: boolean; hasAr: boolean }) {
  const { t } = useTranslation();
  return (
    <Space size={4} className="ph-available-in">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('docs:availableIn')}
      </Typography.Text>
      <Tag color={hasEn ? 'green' : 'default'} className={hasEn ? undefined : 'ph-tag-missing'}>
        English
      </Tag>
      <Tag color={hasAr ? 'green' : 'default'} className={hasAr ? undefined : 'ph-tag-missing'}>
        العربية
      </Tag>
    </Space>
  );
}

export function PageViewPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { space, newPage } = useSpaceContext();
  const page = usePage(pageId);
  const remove = useDeletePage(space.id);
  const { lang, setLang, fallback, has } = useLanguageVersion(page.data);
  const governance = useGovernance('PAGE', pageId);
  const [params] = useSearchParams();
  const commentsRef = useRef<HTMLDivElement>(null);
  const showComments = params.get('comments') === '1';
  useEffect(() => {
    if (showComments && page.data) commentsRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [showComments, page.data]);

  if (page.isLoading) return <LoadingState />;
  if (page.isError || !page.data)
    return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const p = page.data;
  const v = pageVersionFor(p, lang);

  const exportMarkdown = async (l: Locale) => {
    try {
      const text = await api<string>(`/pages/${p.id}/export/markdown`, { query: { lang: l } });
      downloadBlob(
        new Blob([text], { type: 'text/markdown' }),
        `${(l === 'ar' ? p.titleAr : p.titleEn) || p.titleEn || p.titleAr || 'page'}.${l}.md`,
      );
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const confirmDelete = () =>
    modal.confirm({
      title: t('docs:pages.deleteTitle', { name: v.title }),
      content: p.children.length
        ? t('docs:pages.deleteWithChildren', { count: p.children.length })
        : t('docs:pages.deleteText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await remove.mutateAsync(p.id);
          message.success(t('docs:pages.deleted'));
          navigate(p.parentId ? `/docs/${space.id}/pages/${p.parentId}` : `/docs/${space.id}`);
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const exportItems = [
    {
      key: 'pdf',
      icon: <FilePdfOutlined />,
      label: t('docs:export.pdf'),
      onClick: () => window.open(`/print/pages/${p.id}?lang=${lang}`, '_blank', 'noopener'),
    },
    ...(['en', 'ar'] as const)
      .filter((l) => has(l))
      .map((l) => ({
        key: `md-${l}`,
        icon: <FileTextOutlined />,
        label: t('docs:export.markdown', { language: l === 'ar' ? 'العربية' : 'English' }),
        onClick: () => void exportMarkdown(l),
      })),
  ];

  const moreItems = [
    ...(p.canEdit
      ? [
          {
            key: 'sub',
            icon: <PlusOutlined />,
            label: t('docs:pages.newSubPage'),
            onClick: () => newPage(p.id),
          },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            danger: true,
            label: t('delete'),
            onClick: confirmDelete,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.docs'), to: '/docs' },
          { title: loc(space), to: `/docs/${space.id}` },
          ...p.ancestors.map((a) => ({
            title: loc(a, 'title') || t('docs:untitled'),
            to: `/docs/${space.id}/pages/${a.id}`,
          })),
          { title: v.title || t('docs:untitled') },
        ]}
        title={<span dir={v.dir}>{v.title || t('docs:untitled')}</span>}
        subtitle={
          <Flex gap={12} wrap="wrap" align="center" style={{ marginTop: 6 }}>
            <StatusTag
              status={p.status}
              changesRequested={governance.data?.changesRequested}
              rejected={governance.data?.rejected}
            />
            <LanguageAvailability hasEn={p.hasEn} hasAr={p.hasAr} />
            {p.aiGenerated && <AiBadge />}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('docs:pages.versionMeta', {
                version: p.version,
                time: formatDate(p.updatedAt),
                name: loc(p.updatedBy) || p.updatedBy?.email || '—',
              })}
            </Typography.Text>
          </Flex>
        }
        extra={
          <>
            <Segmented
              value={lang}
              onChange={(l) => setLang(l as Locale)}
              options={[
                { value: 'en', label: 'EN', disabled: !p.hasEn },
                { value: 'ar', label: 'عربي', disabled: !p.hasAr },
              ]}
              aria-label={t('docs:pages.languageVersion')}
            />
            {p.canEdit && (
              <Link to={`/docs/${space.id}/pages/${p.id}/edit`}>
                <Button type="primary" icon={<EditOutlined />}>
                  {t('edit')}
                </Button>
              </Link>
            )}
            <Link to={`/docs/${space.id}/pages/${p.id}/history`}>
              <Button icon={<HistoryOutlined />}>{t('docs:history.button')}</Button>
            </Link>
            <Dropdown menu={{ items: exportItems }} trigger={['click']}>
              <Button icon={<DownloadOutlined />}>
                {t('modeler:export')} <DownOutlined />
              </Button>
            </Dropdown>
            {moreItems.length > 0 && (
              <Dropdown menu={{ items: moreItems }} trigger={['click']}>
                <Button>
                  {t('more')} <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </>
        }
      />
      {fallback && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('docs:pages.fallbackNotice', {
            language: lang === 'ar' ? 'العربية' : 'English',
          })}
        />
      )}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={16} xxl={17}>
          <Card className="ph-page-card">
            {(lang === 'ar' ? p.contentAr : p.contentEn).trim() ? (
              <RichTextView
                key={`${p.id}-${lang}-${p.version}`}
                html={v.html}
                dir={v.dir}
                lang={lang}
              />
            ) : (
              <Typography.Text type="secondary">{t('docs:pages.noContent')}</Typography.Text>
            )}
          </Card>
          <div ref={commentsRef}>
            <Card title={t('governance:comments.title')} style={{ marginBlockStart: 24 }}>
              <CommentsPanel type="PAGE" id={p.id} />
            </Card>
          </div>
        </Col>
        <Col xs={24} xl={8} xxl={7}>
          <Space direction="vertical" size={16} style={{ inlineSize: '100%' }}>
            <GovernancePanel type="PAGE" id={p.id} />
            <PageLinksPanel pageId={p.id} canEdit={p.canEdit} />
            <AttachmentsPanel pageId={p.id} canEdit={p.canEdit} />
            {p.children.length > 0 && (
              <Card size="small" title={t('docs:pages.subPages')}>
                <List
                  size="small"
                  dataSource={p.children}
                  renderItem={(c) => (
                    <List.Item>
                      <Link to={`/docs/${space.id}/pages/${c.id}`}>
                        {loc(c, 'title') || t('docs:untitled')}
                      </Link>
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </Space>
        </Col>
      </Row>
    </>
  );
}
