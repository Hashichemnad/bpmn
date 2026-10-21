import { useState } from 'react';
import {
  App,
  Avatar,
  Button,
  Empty,
  Flex,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PartitionOutlined,
  UndoOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type CommentDto, type ContentType } from '@processhub/shared';
import { useCommentActions, useComments } from '@/api/governance';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { CommentBody } from './CommentBody';
import { MentionInput } from './MentionInput';

type Filter = 'open' | 'resolved' | 'all';

function Composer({
  onSubmit,
  pending,
  initial,
  submitLabel,
  onCancel,
  placeholder,
}: {
  onSubmit: (body: string) => Promise<boolean>;
  pending: boolean;
  initial?: string;
  submitLabel: string;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initial ?? '');
  const [key, setKey] = useState(0);
  return (
    <div>
      <MentionInput
        key={key}
        initial={initial}
        onChange={setBody}
        placeholder={placeholder}
        autoFocus={!!onCancel}
      />
      <Flex justify="end" gap={8} style={{ marginBlockStart: 6 }}>
        {onCancel && (
          <Button size="small" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button
          size="small"
          type="primary"
          loading={pending}
          disabled={!body.trim()}
          onClick={() =>
            void onSubmit(body).then((ok) => {
              if (ok && !onCancel) {
                setBody('');
                setKey((k) => k + 1);
              }
            })
          }
        >
          {submitLabel}
        </Button>
      </Flex>
    </div>
  );
}

/**
 * Threaded discussion of a process or page. Process threads can be attached to a BPMN element
 * (`elementId` limits the panel to that element). Mentions notify colleagues.
 */
export function CommentsPanel({
  type,
  id,
  elementId,
  onOpenElement,
}: {
  type: ContentType;
  id: string;
  elementId?: string;
  onOpenElement?: (elementId: string) => void;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const comments = useComments(type, id);
  const actions = useCommentActions(type, id);
  const [filter, setFilter] = useState<Filter>('open');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const canWrite = can(PERMISSIONS.COMMENTS_WRITE);

  if (comments.isLoading) return <LoadingState />;
  if (comments.isError)
    return <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />;

  const all = (comments.data ?? []).filter((c) => !elementId || c.bpmnElementId === elementId);
  const threads = all.filter((c) =>
    filter === 'all' ? true : filter === 'open' ? !c.resolvedAt : !!c.resolvedAt,
  );
  const tryRun = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      message.error(errorMessage(err));
      return false;
    }
  };

  const renderComment = (c: CommentDto, root: boolean) => (
    <div
      key={c.id}
      className={root ? `ph-comment${c.resolvedAt ? ' ph-comment-resolved' : ''}` : undefined}
    >
      <Flex justify="space-between" align="start" gap={8}>
        <Space size={8} align="center" wrap>
          <Avatar size="small" icon={<UserOutlined />} style={{ background: '#64748b' }} />
          <Typography.Text strong>
            {loc(c.author) || c.author?.email || t('governance:unknownUser')}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatDate(c.createdAt)}
            {c.editedAt ? ` · ${t('governance:comments.edited')}` : ''}
          </Typography.Text>
          {root && c.bpmnElementId && !elementId && (
            <Tag
              color="blue"
              icon={<PartitionOutlined />}
              className={onOpenElement ? 'ph-clickable' : undefined}
              onClick={() => onOpenElement?.(c.bpmnElementId!)}
            >
              {loc(c.element) || c.bpmnElementId}
            </Tag>
          )}
          {root && c.resolvedAt && (
            <Tag color="green">
              {t('governance:comments.resolvedBy', {
                name: loc(c.resolvedBy) || c.resolvedBy?.email || '—',
              })}
            </Tag>
          )}
        </Space>
        <Space size={0}>
          {c.canEdit && (
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              aria-label={t('edit')}
              onClick={() => setEditing(c.id)}
            />
          )}
          {c.canEdit && (
            <Popconfirm
              title={root ? t('governance:comments.deleteThread') : t('governance:comments.delete')}
              okText={t('delete')}
              cancelText={t('cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={() => void tryRun(() => actions.remove.mutateAsync(c.id))}
            >
              <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={t('delete')} />
            </Popconfirm>
          )}
          {root && c.canResolve && (
            <Button
              size="small"
              type="text"
              icon={c.resolvedAt ? <UndoOutlined /> : <CheckOutlined />}
              onClick={() =>
                void tryRun(() =>
                  actions.resolve.mutateAsync({ commentId: c.id, resolved: !c.resolvedAt }),
                )
              }
            >
              {c.resolvedAt ? t('governance:comments.reopen') : t('governance:comments.resolve')}
            </Button>
          )}
        </Space>
      </Flex>
      {editing === c.id ? (
        <div style={{ marginBlockStart: 6 }}>
          <Composer
            initial={c.body}
            submitLabel={t('save')}
            pending={actions.update.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={async (body) => {
              const ok = await tryRun(() => actions.update.mutateAsync({ commentId: c.id, body }));
              if (ok) setEditing(null);
              return ok;
            }}
          />
        </div>
      ) : (
        <CommentBody body={c.body} />
      )}
      {root && (
        <>
          {c.replies.length > 0 && (
            <div className="ph-comment-replies">
              {c.replies.map((r) => renderComment(r, false))}
            </div>
          )}
          {canWrite &&
            (replyTo === c.id ? (
              <div style={{ marginBlockStart: 8 }}>
                <Composer
                  submitLabel={t('governance:comments.reply')}
                  pending={actions.create.isPending}
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async (body) => {
                    const ok = await tryRun(() =>
                      actions.create.mutateAsync({ body, parentId: c.id }),
                    );
                    if (ok) setReplyTo(null);
                    return ok;
                  }}
                />
              </div>
            ) : (
              <Button
                size="small"
                type="link"
                icon={<MessageOutlined />}
                style={{ paddingInline: 0 }}
                onClick={() => setReplyTo(c.id)}
              >
                {t('governance:comments.reply')}
              </Button>
            ))}
        </>
      )}
    </div>
  );

  const openCount = all.filter((c) => !c.resolvedAt).length;
  return (
    <div>
      {canWrite && (
        <div style={{ marginBlockEnd: 16 }}>
          <Composer
            submitLabel={t('governance:comments.post')}
            pending={actions.create.isPending}
            placeholder={elementId ? t('governance:comments.placeholderElement') : undefined}
            onSubmit={(body) =>
              tryRun(() => actions.create.mutateAsync({ body, bpmnElementId: elementId ?? null }))
            }
          />
        </div>
      )}
      <Flex
        justify="space-between"
        align="center"
        style={{ marginBlockEnd: 10 }}
        gap={8}
        wrap="wrap"
      >
        <Typography.Text type="secondary">
          {t('governance:comments.openCount', { count: openCount })}
        </Typography.Text>
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'open', label: t('governance:comments.filter.open') },
            { value: 'resolved', label: t('governance:comments.filter.resolved') },
            { value: 'all', label: t('governance:comments.filter.all') },
          ]}
        />
      </Flex>
      {threads.length ? (
        threads.map((c) => renderComment(c, true))
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('governance:comments.empty')} />
      )}
    </div>
  );
}
