import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Flex,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  ImportOutlined,
  PlusOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { STEP_TYPES, type StepType } from '@processhub/shared';
import { useObjects } from '@/api/hooks';
import { useLocalized } from '@/components/i18n-helpers';
import {
  emptyRow,
  rowsFromPaste,
  validateRows,
  type PasteResult,
  type QuickNext,
  type QuickRole,
  type QuickRow,
  type TypeLabels,
} from './quick-model';
import { withAllLanguages } from '@/components/withAllLanguages';

interface Props {
  /** The table is kept while the diagram is shown; it re-reads the diagram when shown unedited. */
  visible: boolean;
  /** Rows read from the diagram (called when the table opens and on "Read from diagram"). */
  readRows: () => QuickRow[];
  canEdit: boolean;
  /** Writes the table into the diagram; resolves to the rows as read back from the diagram. */
  onGenerate: (rows: QuickRow[], original: QuickRow[]) => Promise<QuickRow[] | null>;
}

const ARABIC = /[؀-ۿ]/;

/**
 * Quick Model (Modeler design B2, D-085): the process as a spreadsheet-like table, one row per
 * step. "Generate diagram" writes it into the diagram (lanes from roles, auto-layout); pasting
 * rows copied from Excel fills the table.
 */
function QuickModelViewInner({ visible, readRows, canEdit, onGenerate }: Props) {
  const { t, i18n } = useTranslation();
  const loc = useLocalized();
  const { modal, message } = App.useApp();
  const [rows, setRows] = useState<QuickRow[]>([]);
  const [original, setOriginal] = useState<QuickRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const roles = useObjects({ type: 'ROLE', pageSize: 100, sort: 'nameEn' });
  const systems = useObjects({ type: 'SYSTEM', pageSize: 100, sort: 'nameEn' });

  const reload = () => {
    const r = readRows();
    setRows(r);
    setOriginal(r);
    setDirty(false);
  };
  useEffect(() => {
    if (visible && !dirty) reload();
    // Re-read the diagram each time the unedited table is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const issues = useMemo(() => validateRows(rows), [rows]);
  const errors = issues.filter((i) => i.severity === 'error');
  const update = (key: string, patch: Partial<QuickRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const setAll = (next: QuickRow[]) => {
    setRows(next);
    setDirty(true);
  };
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [r] = next.splice(index, 1);
    next.splice(index + delta, 0, r);
    setAll(next);
  };
  const insertAfter = (index: number) => {
    const prev = rows[index];
    const row: QuickRow = { ...emptyRow(), role: prev?.role ?? null };
    const next = [...rows];
    next.splice(index + 1, 0, row);
    // A new step after a simple step continues its flow.
    if (prev && prev.next.length === 1 && prev.type !== 'decision') {
      row.next = [{ ...prev.next[0], labelEn: '', labelAr: '' }];
      next[index] = { ...prev, next: [{ target: row.key, labelEn: '', labelAr: '' }] };
    } else if (prev && !prev.next.length && prev.type !== 'end') {
      next[index] = { ...prev, next: [{ target: row.key, labelEn: '', labelAr: '' }] };
    }
    setAll(next);
  };
  const remove = (key: string) =>
    setAll(
      rows
        .filter((r) => r.key !== key)
        .map((r) => ({ ...r, next: r.next.filter((n) => n.target !== key) })),
    );

  const generate = async () => {
    setBusy(true);
    try {
      const result = await onGenerate(rows, original);
      if (result) {
        setRows(result);
        setOriginal(result);
        setDirty(false);
      }
    } finally {
      setBusy(false);
    }
  };
  const readDiagram = () => {
    if (!dirty) return reload();
    modal.confirm({
      title: t('modeler:quick.rereadTitle'),
      content: t('modeler:quick.rereadText'),
      okText: t('modeler:quick.reread'),
      cancelText: t('cancel'),
      onOk: reload,
    });
  };

  const roleOptions = (roles.data?.items ?? []).map((r) => ({
    value: `role:${r.id}`,
    label: loc(r),
  }));
  const roleText = (r: QuickRole | null) => (r ? loc(r) : '');
  const rowLabel = (r: QuickRow, i: number) =>
    `${i + 1} · ${loc(r) || t(`modeler:quick.types.${r.type}`)}`;
  const nameOf = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    return i < 0 ? '?' : rowLabel(rows[i], i);
  };

  const conditions = (row: QuickRow) => (
    <Space direction="vertical" size={8} style={{ minWidth: 320 }}>
      {row.next.map((n, j) => {
        const set = (patch: Partial<QuickNext>) =>
          update(row.key, {
            next: row.next.map((x, k) => (k === j ? { ...x, ...patch } : x)),
          });
        return (
          <div key={n.target}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              → {nameOf(n.target)}
            </Typography.Text>
            <Flex gap={6}>
              <Input
                size="small"
                dir="ltr"
                lang="en"
                placeholder={t('modeler:quick.conditionEn')}
                aria-label={t('modeler:quick.conditionEn')}
                value={n.labelEn}
                disabled={!canEdit}
                onChange={(e) => set({ labelEn: e.target.value })}
              />
              <Input
                size="small"
                dir="rtl"
                lang="ar"
                placeholder={t('modeler:quick.conditionAr')}
                aria-label={t('modeler:quick.conditionAr')}
                value={n.labelAr}
                disabled={!canEdit}
                onChange={(e) => set({ labelAr: e.target.value })}
              />
            </Flex>
          </div>
        );
      })}
    </Space>
  );

  return (
    <div className="ph-quick" data-testid="quick-model" hidden={!visible}>
      <Flex className="ph-quick-bar" gap={8} wrap="wrap" align="center">
        <Typography.Text strong>{t('modeler:quick.title')}</Typography.Text>
        <Typography.Text type="secondary" className="ph-quick-hint">
          {t('modeler:quick.hint')}
        </Typography.Text>
        <span className="ph-quick-spacer" />
        {canEdit && (
          <>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => insertAfter(rows.length - 1)}
            >
              {t('modeler:quick.addStep')}
            </Button>
            <Button size="small" icon={<ImportOutlined />} onClick={() => setPasteOpen(true)}>
              {t('modeler:quick.paste')}
            </Button>
          </>
        )}
        <Button size="small" icon={<SyncOutlined />} onClick={readDiagram}>
          {t('modeler:quick.reread')}
        </Button>
        {canEdit && (
          <Tooltip
            title={errors.length ? t('modeler:quick.fixErrors') : t('modeler:quick.generateHint')}
          >
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              disabled={!!errors.length}
              loading={busy}
              onClick={() => void generate()}
            >
              {t('modeler:quick.generate')}
            </Button>
          </Tooltip>
        )}
      </Flex>
      {issues.length > 0 && (
        <Alert
          className="ph-quick-issues"
          type={errors.length ? 'error' : 'warning'}
          showIcon
          message={
            <ul>
              {issues.map((i, n) => (
                <li key={n}>
                  {i.row ? `${t('modeler:quick.row', { n: i.row })}: ` : ''}
                  {t(`modeler:quick.issues.${i.code}`)}
                </li>
              ))}
            </ul>
          }
        />
      )}
      <Table<QuickRow>
        className="ph-quick-table"
        size="small"
        rowKey="key"
        dataSource={rows}
        pagination={false}
        sticky
        scroll={{ x: 1250 }}
        locale={{ emptyText: t('modeler:quick.empty') }}
        columns={[
          {
            title: '#',
            key: 'n',
            width: 44,
            fixed: 'left',
            render: (_, _r, i) => <span className="ph-quick-n">{i + 1}</span>,
          },
          {
            title: t('modeler:quick.nameEn'),
            key: 'nameEn',
            width: 200,
            render: (_, r) => (
              <Input
                size="small"
                dir="ltr"
                lang="en"
                aria-label={t('modeler:quick.nameEn')}
                value={r.nameEn}
                disabled={!canEdit || r.type === 'other'}
                onChange={(e) => update(r.key, { nameEn: e.target.value })}
              />
            ),
          },
          {
            title: t('modeler:quick.nameAr'),
            key: 'nameAr',
            width: 200,
            render: (_, r) => (
              <Input
                size="small"
                dir="rtl"
                lang="ar"
                aria-label={t('modeler:quick.nameAr')}
                value={r.nameAr}
                disabled={!canEdit || r.type === 'other'}
                onChange={(e) => update(r.key, { nameAr: e.target.value })}
              />
            ),
          },
          {
            title: t('modeler:quick.role'),
            key: 'role',
            width: 180,
            render: (_, r) => (
              <AutoComplete
                size="small"
                style={{ width: '100%' }}
                aria-label={t('modeler:quick.role')}
                value={roleText(r.role)}
                options={roleOptions}
                disabled={!canEdit}
                filterOption={(input, option) =>
                  String(option?.label ?? '')
                    .toLocaleLowerCase()
                    .includes(input.toLocaleLowerCase())
                }
                onChange={(v: string) => {
                  if (v.startsWith('role:')) return;
                  update(r.key, {
                    role: v.trim()
                      ? ARABIC.test(v)
                        ? { id: null, nameEn: '', nameAr: v }
                        : { id: null, nameEn: v, nameAr: '' }
                      : null,
                  });
                }}
                onSelect={(v: string) => {
                  const role = roles.data?.items.find((x) => `role:${x.id}` === v);
                  if (role)
                    update(r.key, {
                      role: { id: role.id, nameEn: role.nameEn, nameAr: role.nameAr },
                    });
                }}
              />
            ),
          },
          {
            title: t('modeler:quick.system'),
            key: 'system',
            width: 170,
            render: (_, r) => (
              <Select
                size="small"
                style={{ width: '100%' }}
                aria-label={t('modeler:quick.system')}
                allowClear
                showSearch
                optionFilterProp="label"
                value={r.systemId ?? undefined}
                disabled={!canEdit || r.type === 'decision' || r.type === 'end'}
                options={(systems.data?.items ?? []).map((s) => ({ value: s.id, label: loc(s) }))}
                onChange={(v?: string) => update(r.key, { systemId: v ?? null })}
              />
            ),
          },
          {
            title: t('modeler:quick.type'),
            key: 'type',
            width: 140,
            render: (_, r) =>
              r.type === 'other' ? (
                <Tooltip title={t('modeler:quick.otherHint')}>
                  <Tag>
                    {t(`modeler:types.${(r.elementType ?? '').replace('bpmn:', '')}`, {
                      defaultValue: r.elementType,
                    })}
                  </Tag>
                </Tooltip>
              ) : (
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  aria-label={t('modeler:quick.type')}
                  value={r.type}
                  disabled={!canEdit}
                  options={STEP_TYPES.map((s) => ({
                    value: s,
                    label: t(`modeler:quick.types.${s}`),
                  }))}
                  onChange={(v: StepType) =>
                    update(r.key, { type: v, ...(v === 'end' ? { next: [] } : {}) })
                  }
                />
              ),
          },
          {
            title: t('modeler:quick.next'),
            key: 'next',
            width: 260,
            render: (_, r) => (
              <Flex gap={4} align="center">
                <Select
                  size="small"
                  mode="multiple"
                  style={{ flex: 1, minWidth: 0 }}
                  aria-label={t('modeler:quick.next')}
                  maxTagTextLength={18}
                  disabled={!canEdit || r.type === 'end'}
                  value={r.next.map((n) => n.target)}
                  optionFilterProp="label"
                  options={rows
                    .map((x, i) => ({ value: x.key, label: rowLabel(x, i) }))
                    .filter((o) => o.value !== r.key)}
                  onChange={(targets: string[]) =>
                    update(r.key, {
                      next: targets.map(
                        (target) =>
                          r.next.find((n) => n.target === target) ?? {
                            target,
                            labelEn: '',
                            labelAr: '',
                          },
                      ),
                    })
                  }
                />
                {r.next.length > 0 && (r.type === 'decision' || r.next.length > 1) && (
                  <Popover
                    trigger="click"
                    title={t('modeler:quick.conditions')}
                    content={conditions(r)}
                  >
                    <Button size="small" type="dashed">
                      {r.next.some((n) => n.labelEn || n.labelAr)
                        ? t('modeler:quick.conditionsSet', {
                            count: r.next.filter((n) => n.labelEn || n.labelAr).length,
                          })
                        : t('modeler:quick.conditions')}
                    </Button>
                  </Popover>
                )}
              </Flex>
            ),
          },
          ...(canEdit
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 120,
                  fixed: 'right' as const,
                  render: (_: unknown, r: QuickRow, i: number) => (
                    <Space size={0}>
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowUpOutlined />}
                        disabled={i === 0}
                        aria-label={t('modeler:quick.moveUp')}
                        title={t('modeler:quick.moveUp')}
                        onClick={() => move(i, -1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowDownOutlined />}
                        disabled={i === rows.length - 1}
                        aria-label={t('modeler:quick.moveDown')}
                        title={t('modeler:quick.moveDown')}
                        onClick={() => move(i, 1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<PlusOutlined />}
                        aria-label={t('modeler:quick.insert')}
                        title={t('modeler:quick.insert')}
                        onClick={() => insertAfter(i)}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('delete')}
                        title={t('delete')}
                        onClick={() => remove(r.key)}
                      />
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {pasteOpen && (
        <PasteModal
          typeLabels={
            Object.fromEntries(
              STEP_TYPES.map((s) => [
                s,
                [
                  i18n.getFixedT('en')(`modeler:quick.types.${s}`),
                  i18n.getFixedT('ar')(`modeler:quick.types.${s}`),
                ],
              ]),
            ) as TypeLabels
          }
          roles={roles.data?.items ?? []}
          systems={systems.data?.items ?? []}
          hasRows={rows.length > 0}
          onClose={() => setPasteOpen(false)}
          onApply={(pasted, mode) => {
            setPasteOpen(false);
            setAll(mode === 'replace' ? pasted : [...rows, ...pasted]);
            message.success(t('modeler:quick.pasted', { count: pasted.length }));
          }}
        />
      )}
    </div>
  );
}

function PasteModal({
  typeLabels,
  roles,
  systems,
  hasRows,
  onClose,
  onApply,
}: {
  typeLabels: TypeLabels;
  roles: { id: string; nameEn: string; nameAr: string }[];
  systems: { id: string; nameEn: string; nameAr: string }[];
  hasRows: boolean;
  onClose: () => void;
  onApply: (rows: QuickRow[], mode: 'replace' | 'append') => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const result: PasteResult | null = useMemo(
    () => (text.trim() ? rowsFromPaste(text, { roles, systems, typeLabels }) : null),
    [text, roles, systems, typeLabels],
  );
  const count = result?.rows.length ?? 0;
  return (
    <Modal
      open
      width={760}
      title={t('modeler:quick.pasteTitle')}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('cancel')}
        </Button>,
        hasRows && (
          <Button
            key="append"
            disabled={!count}
            onClick={() => result && onApply(result.rows, 'append')}
          >
            {t('modeler:quick.pasteAppend')}
          </Button>
        ),
        <Button
          key="replace"
          type="primary"
          disabled={!count}
          onClick={() => result && onApply(result.rows, 'replace')}
        >
          {hasRows ? t('modeler:quick.pasteReplace') : t('modeler:quick.pasteUse')}
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary">{t('modeler:quick.pasteHint')}</Typography.Paragraph>
      <pre className="ph-quick-columns" dir="ltr">
        {t('modeler:quick.pasteColumns')}
      </pre>
      <Input.TextArea
        rows={8}
        autoFocus
        aria-label={t('modeler:quick.pasteTitle')}
        placeholder={t('modeler:quick.pastePlaceholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result && (
        <Space direction="vertical" style={{ marginTop: 12, width: '100%' }}>
          <Typography.Text>{t('modeler:quick.pasteCount', { count })}</Typography.Text>
          {result.unknownSystems.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('modeler:quick.unknownSystems', {
                names: result.unknownSystems.join(', '),
              })}
            />
          )}
          {result.unknownNext.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('modeler:quick.unknownNext', {
                refs: result.unknownNext.map((u) => `${u.row}: ${u.text}`).join(' · '),
              })}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}

/** Needs the texts of both languages (bilingual labels / printing in either language). */
export const QuickModelView = withAllLanguages(QuickModelViewInner);
