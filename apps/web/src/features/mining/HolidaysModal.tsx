import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Flex,
  Input,
  Modal,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { HolidayEntry } from '@processhub/shared';
import { useHolidays, useSaveHolidays } from '@/api/simulation';
import { useErrorMessage } from '@/components/i18n-helpers';

/**
 * Central public holiday list (D-143), maintained by admins each year; every simulation scenario uses
 * it unless the scenario has its own list. Islamic holidays stay "expected" until the moon sighting.
 */
export function HolidaysModal({
  onClose,
  readOnly = false,
}: {
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const list = useHolidays();
  const save = useSaveHolidays();
  const [rows, setRows] = useState<HolidayEntry[]>([]);
  useEffect(() => {
    if (list.data) setRows(list.data);
  }, [list.data]);
  const set = (i: number, patch: Partial<HolidayEntry>) =>
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const dup = rows.some((r, i) => rows.findIndex((x) => x.date === r.date) !== i);
  return (
    <Modal
      open
      width="min(900px, 96vw)"
      title={t('mining:holidays.title')}
      onCancel={onClose}
      okText={t('mining:sim.save')}
      okButtonProps={{ disabled: readOnly || dup, hidden: readOnly }}
      confirmLoading={save.isPending}
      onOk={() =>
        save
          .mutateAsync(rows)
          .then(() => {
            void message.success(t('mining:holidays.saved'));
            onClose();
          })
          .catch((e: unknown) => void message.error(errorMessage(e)))
      }
    >
      <Typography.Paragraph type="secondary">{t('mining:holidays.help')}</Typography.Paragraph>
      {dup && <Typography.Text type="danger">{t('mining:holidays.duplicate')}</Typography.Text>}
      <Table<HolidayEntry>
        size="small"
        rowKey={(_, i) => String(i)}
        loading={list.isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ y: 420 }}
        data-testid="holidays-table"
        columns={[
          {
            title: t('mining:holidays.date'),
            width: 150,
            render: (_, r, i) =>
              readOnly ? (
                r.date
              ) : (
                <DatePicker
                  size="small"
                  allowClear={false}
                  value={dayjs(r.date)}
                  onChange={(d) => d && set(i, { date: d.format('YYYY-MM-DD') })}
                />
              ),
          },
          {
            title: t('mining:fields.nameEn'),
            render: (_, r, i) =>
              readOnly ? (
                r.nameEn
              ) : (
                <Input
                  size="small"
                  value={r.nameEn}
                  onChange={(e) => set(i, { nameEn: e.target.value })}
                />
              ),
          },
          {
            title: t('mining:fields.nameAr'),
            render: (_, r, i) =>
              readOnly ? (
                r.nameAr
              ) : (
                <Input
                  size="small"
                  dir="rtl"
                  value={r.nameAr}
                  onChange={(e) => set(i, { nameAr: e.target.value })}
                />
              ),
          },
          {
            title: t('mining:holidays.status'),
            width: 190,
            render: (_, r, i) =>
              readOnly ? (
                <Tag color={r.expected ? 'gold' : 'green'}>
                  {r.expected ? t('mining:holidays.expected') : t('mining:holidays.confirmed')}
                </Tag>
              ) : (
                <Checkbox
                  checked={r.expected}
                  onChange={(e) => set(i, { expected: e.target.checked })}
                  data-testid={`holiday-expected-${r.date}`}
                >
                  {t('mining:holidays.expected')}
                </Checkbox>
              ),
          },
          ...(readOnly
            ? []
            : [
                {
                  title: '',
                  width: 50,
                  render: (_: unknown, __: HolidayEntry, i: number) => (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('mining:log.delete')}
                      onClick={() => setRows((r) => r.filter((_, k) => k !== i))}
                    />
                  ),
                },
              ]),
        ]}
      />
      {!readOnly && (
        <Flex style={{ marginBlockStart: 8 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() =>
              setRows((r) => [
                ...r,
                { date: dayjs().format('YYYY-MM-DD'), nameEn: '', nameAr: '', expected: false },
              ])
            }
            data-testid="holiday-add"
          >
            {t('mining:holidays.add')}
          </Button>
        </Flex>
      )}
    </Modal>
  );
}
