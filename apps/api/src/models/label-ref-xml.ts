import { JSDOM } from 'jsdom';
import type { ElementLabelDto, RenameElementDto } from '@processhub/shared';

const PH_NS = 'http://processhub.io/schema/bpmn';

let dom: JSDOM | null = null;
const window = () => (dom ??= new JSDOM('')).window;

/**
 * Sets the labels of every element linked to `objectId` (`ph:labelRef`) to the object's new names:
 * ph:nameEn / ph:nameAr, and `name` (English first, like the modeler's export). Elements whose
 * labels already match are left alone. Returns the XML unchanged (same string) when nothing changed
 * or the XML does not parse.
 */
export function renameLabelRefs(
  xml: string,
  objectId: string,
  names: ElementLabelDto,
): { xml: string; elements: RenameElementDto[] } {
  const w = window();
  const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return { xml, elements: [] };
  const after: ElementLabelDto = {
    nameEn: names.nameEn || names.nameAr,
    nameAr: names.nameAr || names.nameEn,
  };
  const elements: RenameElementDto[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.getAttributeNS(PH_NS, 'labelRef') !== objectId) continue;
    const before: ElementLabelDto = {
      nameEn: el.getAttributeNS(PH_NS, 'nameEn') ?? '',
      nameAr: el.getAttributeNS(PH_NS, 'nameAr') ?? '',
    };
    if (before.nameEn === after.nameEn && before.nameAr === after.nameAr) continue;
    const prefix = el.lookupPrefix(PH_NS) ?? 'ph';
    el.setAttributeNS(PH_NS, `${prefix}:nameEn`, after.nameEn);
    el.setAttributeNS(PH_NS, `${prefix}:nameAr`, after.nameAr);
    el.setAttribute('name', after.nameEn || after.nameAr);
    elements.push({ elementId: el.getAttribute('id') ?? '', before, after });
  }
  if (!elements.length) return { xml, elements };
  return { xml: new w.XMLSerializer().serializeToString(doc), elements };
}
