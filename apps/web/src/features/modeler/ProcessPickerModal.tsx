import { useState } from 'react';
import { Modal, TreeSelect, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ProcessSummaryDto } from '@processhub/shared';
import { useProcessTreeOptions } from './process-tree-options';

/** Chooses the repository process a "Link to sub-process" step calls. */
export function ProcessPickerModal({
  open,
  processId,
  onPick,
  onClose,
}: {
  open: boolean;
  /** The process being modelled (cannot call itself). */
  processId: string;
  onPick: (process: ProcessSummaryDto) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { options, processes, loading } = useProcessTreeOptions(processId);
  const [value, setValue] = useState<string>();
  return (
    <Modal
      open={open}
      title={t('modeler:palette.ready.subProcessLink.pickTitle')}
      okText={t('modeler:palette.ready.subProcessLink.pick')}
      cancelText={t('modeler:palette.ready.subProcessLink.later')}
      okButtonProps={{ disabled: !value }}
      onOk={() => {
        const p = processes.find((x) => x.id === value);
        if (p) onPick(p);
        setValue(undefined);
      }}
      onCancel={() => {
        setValue(undefined);
        onClose();
      }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t('modeler:palette.ready.subProcessLink.pickHint')}
      </Typography.Paragraph>
      <TreeSelect
        showSearch
        autoFocus
        style={{ width: '100%' }}
        treeNodeFilterProp="title"
        treeData={options}
        loading={loading}
        value={value}
        placeholder={t('modeler:chooseProcess')}
        onChange={(v: string) => setValue(v)}
      />
    </Modal>
  );
}
