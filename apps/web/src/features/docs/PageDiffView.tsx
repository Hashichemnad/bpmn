import { Empty, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TextDirection } from '@processhub/shared';
import type { Block, DiffPart, DiffRow, diffStats } from './text-diff';

const prefix = (b: Block) =>
  b.kind === 'li'
    ? '• '
    : b.kind === 'task'
      ? b.checked
        ? '☑ '
        : '☐ '
      : b.kind === 'quote'
        ? '❝ '
        : '';

function Parts({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i} className="ph-diff-ins">
            {p.value}
          </ins>
        ) : p.removed ? (
          <del key={i} className="ph-diff-del">
            {p.value}
          </del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

function BlockText({ block, parts }: { block?: Block; parts?: DiffPart[] }) {
  if (!block) return null;
  return (
    <div className={`ph-diff-block ph-diff-kind-${block.kind}`}>
      {prefix(block)}
      {parts ? <Parts parts={parts} /> : block.text}
    </div>
  );
}

export function DiffStatsTags({ stats }: { stats: ReturnType<typeof diffStats> }) {
  const { t } = useTranslation();
  return (
    <Space size={4} wrap>
      <Tag color="green">{t('docs:diff.added', { count: stats.added })}</Tag>
      <Tag color="red">{t('docs:diff.removed', { count: stats.removed })}</Tag>
      <Tag color="gold">{t('docs:diff.changed', { count: stats.changed })}</Tag>
    </Space>
  );
}

/** Text diff of two page versions: side by side (aligned rows) or inline. */
export function PageDiffView({
  rows,
  mode,
  dir,
  leftTitle,
  rightTitle,
}: {
  rows: DiffRow[];
  mode: 'side' | 'inline';
  dir: TextDirection;
  leftTitle: string;
  rightTitle: string;
}) {
  const { t } = useTranslation();
  if (!rows.length) return <Empty description={t('docs:diff.empty')} />;
  if (rows.every((r) => r.type === 'equal')) {
    return <Typography.Text type="secondary">{t('docs:diff.identical')}</Typography.Text>;
  }

  if (mode === 'inline') {
    return (
      <div className="ph-diff ph-diff-inline" dir={dir}>
        {rows.map((r, i) => (
          <div key={i} className={`ph-diff-row ph-diff-${r.type}`}>
            {r.type === 'changed' ? (
              <BlockText block={r.right} parts={r.inlineParts} />
            ) : r.type === 'removed' ? (
              <del className="ph-diff-del-block">
                <BlockText block={r.left} />
              </del>
            ) : r.type === 'added' ? (
              <ins className="ph-diff-ins-block">
                <BlockText block={r.right} />
              </ins>
            ) : (
              <BlockText block={r.left} />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ph-diff ph-diff-side" role="table">
      <div className="ph-diff-side-row ph-diff-side-head" role="row">
        <div role="columnheader">{leftTitle}</div>
        <div role="columnheader">{rightTitle}</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`ph-diff-side-row ph-diff-${r.type}`} role="row">
          <div role="cell" dir={dir} className={r.left ? undefined : 'ph-diff-gap'}>
            <BlockText block={r.left} parts={r.leftParts} />
          </div>
          <div role="cell" dir={dir} className={r.right ? undefined : 'ph-diff-gap'}>
            <BlockText block={r.right} parts={r.rightParts} />
          </div>
        </div>
      ))}
    </div>
  );
}
