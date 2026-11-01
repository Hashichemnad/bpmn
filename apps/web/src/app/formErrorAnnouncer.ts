/**
 * Announces form validation errors to screen readers when they appear (WCAG 3.3.1). Ant Design links
 * an error to its field (`aria-invalid`, `aria-describedby`) but does not announce it, so a user who
 * presses Save does not hear why nothing happened. One visually hidden live region for the whole app
 * receives the texts of newly shown errors (already translated), debounced so that a form with
 * several errors is read once (final session, part A).
 */
const ERROR = '.ant-form-item-explain-error';

export function startFormErrorAnnouncer(doc: Document = document): () => void {
  const region = doc.createElement('div');
  region.className = 'ph-sr-only';
  region.setAttribute('aria-live', 'assertive');
  region.setAttribute('aria-atomic', 'true');
  region.dataset.testid = 'form-error-announcer';
  doc.body.appendChild(region);

  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const text = [...pending].join('. ');
    pending = new Set();
    // Clearing first makes screen readers repeat the same message after a second failed save.
    region.textContent = '';
    if (text) setTimeout(() => (region.textContent = text), 50);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records)
      for (const node of r.addedNodes) {
        if (!(node instanceof Element)) continue;
        const errors = node.matches(ERROR) ? [node] : [...node.querySelectorAll(ERROR)];
        for (const e of errors) {
          const t = e.textContent?.trim();
          if (t) pending.add(t);
        }
      }
    if (pending.size) {
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
    region.remove();
  };
}
