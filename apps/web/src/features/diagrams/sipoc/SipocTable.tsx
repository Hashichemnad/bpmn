import { useTranslation } from 'react-i18next';
import { SIPOC_COLUMNS, type SipocContent } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';

/** Read-only SIPOC table: five columns, steps numbered (portal, review, print, handbook preview). */
export function SipocTable({
  content,
  markers,
}: {
  content: SipocContent;
  markers?: Record<string, string[]>;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const markerOf = (id: string) =>
    Object.entries(markers ?? {})
      .filter(([, ids]) => ids.includes(id))
      .map(([cls]) => cls)
      .join(' ');
  return (
    <div className="ph-sipoc" role="table" aria-label="SIPOC">
      {SIPOC_COLUMNS.map((col) => (
        <div key={col} className={`ph-sipoc-col ph-sipoc-${col}`} role="rowgroup">
          <div className="ph-sipoc-head" role="columnheader">
            <span className="ph-sipoc-letter" aria-hidden="true">
              {t(`diagrams:sipoc.letter.${col}`)}
            </span>
            {t(`diagrams:sipoc.columns.${col}`)}
          </div>
          <ol className="ph-sipoc-items">
            {content.columns[col].map((item, i) => (
              <li key={item.id} className={markerOf(item.id)} data-element-id={item.id}>
                {col === 'steps' && <span className="ph-sipoc-num">{i + 1}</span>}
                <span>{loc(item) || '—'}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
