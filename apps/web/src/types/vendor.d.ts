declare module 'bpmn-js-differ' {
  export interface ModdleElement {
    id: string;
    $type: string;
    name?: string;
    get(name: string): unknown;
  }
  export interface DiffResult {
    _added: Record<string, ModdleElement>;
    _removed: Record<string, ModdleElement>;
    _changed: Record<
      string,
      { model: ModdleElement; attrs: Record<string, { oldValue: unknown; newValue: unknown }> }
    >;
    _layoutChanged: Record<string, ModdleElement>;
  }
  export function diff(oldDefinitions: unknown, newDefinitions: unknown): DiffResult;
}

declare module 'bpmn-moddle' {
  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>);
    fromXML(xml: string): Promise<{ rootElement: unknown; warnings: unknown[] }>;
  }
}

declare module 'bpmn-js-color-picker' {
  /** bpmn-js module: "Set color" context pad entry and the "color-picker" popup menu. */
  const module: Record<string, unknown>;
  export default module;
}
