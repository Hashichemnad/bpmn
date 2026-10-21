import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutoComplete, Input } from 'antd';
import { FileTextOutlined, PartitionOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSearch } from '@/api/docs';
import { useLocalized } from '@/components/i18n-helpers';
import { hitLink } from './links';

/** Header search box with quick results; Enter opens the full search page. */
export function GlobalSearch() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(id);
  }, [value]);
  const result = useSearch({ q: debounced, pageSize: 8 }, debounced.length >= 2);

  const options = (result.data?.items ?? []).map((h) => ({
    value: hitLink(h),
    label: (
      <span className="ph-quick-hit">
        {h.type === 'page' ? <FileTextOutlined /> : <PartitionOutlined />}{' '}
        {h.code && (
          <span className="ph-tree-code" dir="ltr">
            {h.code}{' '}
          </span>
        )}
        {loc(h, 'title')}
        {h.space && <span className="ph-muted"> · {loc(h.space)}</span>}
      </span>
    ),
  }));

  return (
    <AutoComplete
      className="ph-global-search"
      value={value}
      options={options}
      onChange={setValue}
      onSelect={(link: string) => {
        setValue('');
        navigate(link);
      }}
      popupMatchSelectWidth={420}
    >
      <Input
        prefix={<SearchOutlined />}
        placeholder={t('search:quick')}
        aria-label={t('search:quick')}
        allowClear
        onPressEnter={() =>
          value.trim() && navigate(`/search?q=${encodeURIComponent(value.trim())}`)
        }
      />
    </AutoComplete>
  );
}
