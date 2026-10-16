/**
 * highlight.js — outline fields on the page: green = filled, yellow = skipped / no data,
 * red = failed. The reason is stored in data-wda-reason (and the tooltip when free).
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const CLASSES = ['wda-filled', 'wda-skipped', 'wda-failed'];

  WDA.mark = (el, status, reason) => {
    if (!el || !el.classList) return;
    // hidden inputs (file, custom checkboxes) can't show an outline — mark their parent
    if (!WDA.isVisible(el) && el.parentElement) el = el.parentElement;
    el.classList.remove(...CLASSES);
    el.classList.add(`wda-${status}`);
    el.setAttribute('data-wda-reason', reason || status);
    if (!el.hasAttribute('title') || el.hasAttribute('data-wda-title')) {
      el.setAttribute('title', `Autofill: ${reason || status}`);
      el.setAttribute('data-wda-title', '');
    }
  };

  WDA.clearMarks = () => {
    document.querySelectorAll('.wda-filled, .wda-skipped, .wda-failed').forEach((el) => {
      el.classList.remove(...CLASSES);
      el.removeAttribute('data-wda-reason');
      if (el.hasAttribute('data-wda-title')) {
        el.removeAttribute('title');
        el.removeAttribute('data-wda-title');
      }
    });
  };
})();
