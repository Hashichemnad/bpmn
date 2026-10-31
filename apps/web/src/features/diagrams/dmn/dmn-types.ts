/** Minimal typings of the dmn-js API used by ProcessHub. */
export interface DmnView {
  type: 'drd' | 'decisionTable' | 'literalExpression' | 'boxedExpression' | string;
  element: { id: string; name?: string; $attrs?: Record<string, string> };
}

export interface DmnInstance {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(opts?: { format?: boolean }): Promise<{ xml: string }>;
  getViews(): DmnView[];
  getActiveView(): DmnView | null;
  open(view: DmnView): Promise<unknown>;
  getActiveViewer(): {
    get<T = unknown>(name: string, strict?: boolean): T;
    saveSVG?(): Promise<{ svg: string }>;
  } | null;
  on(event: string, cb: (e: unknown) => void): void;
  off(event: string, cb: (e: unknown) => void): void;
  destroy(): void;
}

/** Bilingual name of a DMN element (ph:nameEn / ph:nameAr, then name). */
export function dmnName(el: DmnView['element'], locale: string): string {
  const attrs = el.$attrs ?? {};
  const own = locale === 'ar' ? attrs['ph:nameAr'] : attrs['ph:nameEn'];
  return own || el.name || attrs['ph:nameEn'] || attrs['ph:nameAr'] || el.id;
}
