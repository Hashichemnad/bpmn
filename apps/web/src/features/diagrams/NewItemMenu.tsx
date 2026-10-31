import { useState } from 'react';
import { Button, Dropdown } from 'antd';
import { PartitionOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DIAGRAM_TYPES, PERMISSIONS, type DiagramType } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { ProcessFormModal } from '@/features/processes/ProcessFormModal';
import { DiagramTypeIcon } from './DiagramTypeIcon';
import { NewDiagramModal } from './NewDiagramModal';

/** "New" menu of the repository: a BPMN process or a diagram of each other type. */
export function NewItemMenu({ processId }: { processId?: string | null }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [creating, setCreating] = useState<'PROCESS' | DiagramType | null>(null);
  if (!can(PERMISSIONS.PROCESSES_CREATE)) return null;
  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'PROCESS', icon: <PartitionOutlined />, label: t('diagrams:new.PROCESS') },
            { type: 'divider' },
            ...DIAGRAM_TYPES.map((type) => ({
              key: type,
              icon: <DiagramTypeIcon type={type} />,
              label: t(`diagrams:type.${type}`),
            })),
          ],
          onClick: ({ key }) => setCreating(key as 'PROCESS' | DiagramType),
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          style={{ marginBottom: 12 }}
          data-testid="new-item"
        >
          {t('diagrams:new.button')}
        </Button>
      </Dropdown>
      {creating === 'PROCESS' && (
        <ProcessFormModal open mode="create" onClose={() => setCreating(null)} />
      )}
      {creating && creating !== 'PROCESS' && (
        <NewDiagramModal
          type={creating}
          defaultProcessId={processId}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}
