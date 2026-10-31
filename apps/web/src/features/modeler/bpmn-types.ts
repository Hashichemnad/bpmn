/** Minimal typings for the bpmn-js / diagram-js services used by the modeler. */
export interface BusinessObject {
  id: string;
  $type: string;
  name?: string;
  incoming?: unknown[];
  outgoing?: unknown[];
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

export interface DiagramElement {
  id: string;
  type: string;
  businessObject: BusinessObject;
  parent?: DiagramElement;
  label?: DiagramElement;
  labelTarget?: DiagramElement;
  collapsed?: boolean;
}

export interface ElementRegistry {
  get(id: string): DiagramElement | undefined;
  getAll(): DiagramElement[];
  filter(fn: (el: DiagramElement) => boolean): DiagramElement[];
}

export interface EventBus {
  on(event: string | string[], callback: (e: never) => void): void;
  on(event: string | string[], priority: number, callback: (e: never) => void): void;
  off(event: string | string[], callback?: (e: never) => void): void;
  fire(event: string, payload?: unknown): void;
}

export interface Modeling {
  updateLabel(element: DiagramElement, text: string | null): void;
  updateModdleProperties(
    element: DiagramElement,
    bo: BusinessObject,
    props: Record<string, unknown>,
  ): void;
}

export interface CommandStack {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  inner: { x: number; y: number; width: number; height: number };
  outer: { width: number; height: number };
}

export interface Canvas {
  zoom(level?: 'fit-viewport' | number, center?: 'auto'): number;
  viewbox(box?: { x: number; y: number; width: number; height: number }): Viewbox;
  scrollToElement(element: DiagramElement): void;
  resized(): void;
  /** Moves the diagram by a delta in screen pixels. */
  scroll(delta: { dx: number; dy: number }): void;
  addMarker(element: DiagramElement | string, marker: string): void;
  removeMarker(element: DiagramElement | string, marker: string): void;
}

export interface Overlays {
  add(
    element: DiagramElement | string,
    type: string,
    overlay: { position: Record<string, number>; html: HTMLElement },
  ): string;
  remove(filter: { type?: string; element?: DiagramElement | string }): void;
}

export interface Selection {
  select(element: DiagramElement | null): void;
  get(): DiagramElement[];
}

export interface BpmnInstance {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(opts?: { format?: boolean }): Promise<{ xml?: string }>;
  saveSVG(): Promise<{ svg: string }>;
  get<T = unknown>(service: string, strict?: boolean): T;
  destroy(): void;
}

/** Any diagram-js based instance (bpmn-js, the graph notations): service lookup only. */
export type DiagramServices = Pick<BpmnInstance, 'get'>;

/** Shape geometry (diagram coordinates). */
export interface ShapeElement extends DiagramElement {
  x: number;
  y: number;
  width: number;
  height: number;
}
