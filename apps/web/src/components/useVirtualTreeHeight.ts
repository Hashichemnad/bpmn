import { useEffect, useState } from 'react';

/** Trees with more nodes than this render virtually (only the visible rows are in the DOM). */
export const VIRTUAL_TREE_THRESHOLD = 300;

type Nodes = readonly { children?: readonly unknown[] }[] | undefined;

const countNodes = (nodes: Nodes): number =>
  (nodes ?? []).reduce((n, x) => n + 1 + countNodes(x.children as Nodes), 0);

/** Browser window height, updated on resize. */
export function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return h;
}

/**
 * Value for an Ant Design Tree's `height` prop, which turns on virtual scrolling: the viewport
 * height minus `offset` for large trees, undefined (normal rendering) for small ones. A process
 * house of 2,000 processes stays smooth this way (final session, part A).
 */
export function virtualTreeHeight(nodes: Nodes, viewport: number, offset = 240) {
  return countNodes(nodes) > VIRTUAL_TREE_THRESHOLD ? Math.max(320, viewport - offset) : undefined;
}
