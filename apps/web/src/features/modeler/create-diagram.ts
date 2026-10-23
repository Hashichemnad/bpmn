import Modeler from 'bpmn-js/lib/Modeler';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import Viewer from 'bpmn-js/lib/Viewer';
import type { BpmnInstance } from './bpmn-types';
import { phModdleDescriptor } from './phModdle';
import { DIAGRAM_CONFIG, phRendererModule } from './renderer';

/** modeler: editable; navigated: read-only with pan/zoom; viewer: static (print, snapshots). */
export type DiagramKind = 'modeler' | 'navigated' | 'viewer';

const CONSTRUCTORS = { modeler: Modeler, navigated: NavigatedViewer, viewer: Viewer };

/**
 * Every diagram in the app (modeler, viewers, portal, print, compare) is created here, so they
 * all share the ProcessHub look: renderer, fonts and the ph: moddle extension.
 */
export function createDiagram(
  kind: DiagramKind,
  options: {
    container: HTMLElement;
    additionalModules?: unknown[];
    config?: Record<string, unknown>;
  },
): BpmnInstance {
  const Ctor = CONSTRUCTORS[kind];
  return new Ctor({
    container: options.container,
    moddleExtensions: { ph: phModdleDescriptor },
    ...DIAGRAM_CONFIG,
    ...options.config,
    additionalModules: [phRendererModule, ...(options.additionalModules ?? [])],
  } as never) as unknown as BpmnInstance;
}

let fontsReady: Promise<unknown> | null = null;

/**
 * Loads the diagram fonts before the first import: bpmn-js measures label text when it renders,
 * so measuring with a fallback font would wrap labels differently from what is shown.
 */
export function diagramFontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return (fontsReady ??= Promise.all([
    document.fonts.load('12px Inter'),
    document.fonts.load('600 12px Inter'),
    document.fonts.load("12px 'IBM Plex Sans Arabic'", 'ب'),
    document.fonts.load("600 12px 'IBM Plex Sans Arabic'", 'ب'),
  ]).catch(() => undefined));
}

/** importXML after the fonts are available. */
export async function importDiagram(instance: BpmnInstance, xml: string) {
  await diagramFontsReady();
  return instance.importXML(xml);
}
