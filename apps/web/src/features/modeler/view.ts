import type { Canvas } from './bpmn-types';

/** Space kept around the diagram when fitting it (screen pixels). */
const MARGIN = 24;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Fits the diagram to the width of the canvas, never above `maxZoom` (100 %): wide diagrams are
 * readable instead of shrinking to fit their height as well. The top of the diagram is shown;
 * a diagram lower than the canvas is centred vertically (`align: 'top'`: kept at the top).
 */
export function fitWidth(canvas: Canvas, maxZoom = 1, align: 'center' | 'top' = 'center'): void {
  canvas.resized();
  const { inner, outer } = canvas.viewbox();
  if (!inner.width || !inner.height || !outer.width || !outer.height) return;
  const zoom = clamp(Math.min(maxZoom, (outer.width - 2 * MARGIN) / inner.width));
  const width = outer.width / zoom;
  const height = outer.height / zoom;
  const fitsHeight = align === 'center' && inner.height * zoom + 2 * MARGIN <= outer.height;
  canvas.viewbox({
    x: inner.x + inner.width / 2 - width / 2,
    y: fitsHeight ? inner.y + inner.height / 2 - height / 2 : inner.y - MARGIN / zoom,
    width,
    height,
  });
}

/** Shows the whole diagram (never above `maxZoom`), centred. */
export function fitPage(canvas: Canvas, maxZoom = 1): void {
  canvas.resized();
  const { inner, outer } = canvas.viewbox();
  if (!inner.width || !inner.height || !outer.width || !outer.height) return;
  const zoom = clamp(
    Math.min(
      maxZoom,
      (outer.width - 2 * MARGIN) / inner.width,
      (outer.height - 2 * MARGIN) / inner.height,
    ),
  );
  const width = outer.width / zoom;
  const height = outer.height / zoom;
  canvas.viewbox({
    x: inner.x + inner.width / 2 - width / 2,
    y: inner.y + inner.height / 2 - height / 2,
    width,
    height,
  });
}

/** Zooms around the centre of the visible area. */
export function zoomTo(canvas: Canvas, level: number): void {
  canvas.zoom(clamp(level));
}

export function zoomBy(canvas: Canvas, factor: number): void {
  canvas.zoom(clamp(canvas.zoom() * factor));
}

/** Runs `fn` once the browser has laid out the canvas. */
export const afterLayout = (fn: () => void) => requestAnimationFrame(() => fn());
