import { Tag, Tooltip } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type ImportOriginDto } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';

/** "Imported" flag of an item created by an Import Center batch (M15): batch and source file. */
export function ImportedTag({ origin }: { origin: ImportOriginDto | null | undefined }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  if (!origin) return null;
  const tag = (
    <Tag icon={<CloudUploadOutlined />} color="purple" data-testid="imported-tag">
      {t('imports:flag', { number: origin.number })}
    </Tag>
  );
  return (
    <Tooltip title={origin.source ? t('imports:flagSource', { source: origin.source }) : undefined}>
      {can(PERMISSIONS.IMPORT_MANAGE) ? (
        <Link to={`/admin/imports/${origin.batchId}`}>{tag}</Link>
      ) : (
        tag
      )}
    </Tooltip>
  );
}
