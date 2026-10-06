/**
 * floatingButton.js — small draggable "Fill" pill on application pages (shadow DOM so page
 * styles can't touch it). Can be hidden from the options page.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const HOST_ID = 'wda-fab-host';
  let host = null;

  const STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; right: 16px; z-index: 2147483646; display: flex; align-items: center; gap: 8px;
            font: 12px/1.3 system-ui, -apple-system, Segoe UI, sans-serif; }
    .fab { border: 0; border-radius: 999px; padding: 7px 14px; background: #111827; color: #fff; cursor: pointer;
           font: 600 12px system-ui, -apple-system, Segoe UI, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.25);
           touch-action: none; user-select: none; }
    .fab:hover { background: #1f2937; }
    .fab:disabled { opacity: .6; cursor: default; }
    .toast { background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 10px;
             box-shadow: 0 2px 8px rgba(0,0,0,.12); max-width: 260px; }
    .toast[hidden] { display: none; }
    .err { color: #b91c1c; }
  `;

  function unmount() {
    document.getElementById(HOST_ID)?.remove();
    host = null;
  }

  async function mount() {
    if (host && host.isConnected) return;
    unmount(); // also removes a stale button left by a previous extension load
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="wrap"><div class="toast" hidden></div>
      <button class="fab" title="Autofill: fill this page (drag to move)">Fill</button></div>`;
    document.documentElement.appendChild(host);

    const wrap = root.querySelector('.wrap');
    const fab = root.querySelector('.fab');
    const toast = root.querySelector('.toast');

    const { fabTop } = await chrome.storage.local.get('fabTop');
    const setTop = (frac) => {
      const top = Math.min(Math.max(frac * window.innerHeight, 8), window.innerHeight - 48);
      wrap.style.top = `${top}px`;
    };
    setTop(typeof fabTop === 'number' ? fabTop : 0.85);

    // Vertical drag; a press without movement counts as a click.
    let drag = null;
    fab.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, top: wrap.getBoundingClientRect().top, moved: false };
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) setTop((drag.top + dy) / window.innerHeight);
    });
    fab.addEventListener('pointerup', () => {
      if (drag && drag.moved) {
        chrome.storage.local.set({ fabTop: wrap.getBoundingClientRect().top / window.innerHeight });
        fab.dataset.justDragged = '1';
      }
      drag = null;
    });

    let toastTimer = null;
    const showToast = (html) => {
      toast.innerHTML = html;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), 6000);
    };

    fab.addEventListener('click', async () => {
      if (fab.dataset.justDragged) {
        delete fab.dataset.justDragged;
        return;
      }
      fab.disabled = true;
      fab.textContent = 'Filling…';
      try {
        const r = await WDA.runFill();
        if (r.error) showToast(`<span class="err">${escapeHtml(r.error)}</span>`);
        else
          showToast(
            `<b>${escapeHtml(r.step)}</b><br>Filled ${r.filled} · Skipped ${r.skipped} · ` +
              `<span class="${r.failed ? 'err' : ''}">Failed ${r.failed}</span>` +
              (r.note ? `<br>${escapeHtml(r.note)}` : '')
          );
      } catch (e) {
        showToast(`<span class="err">${escapeHtml(e.message)}</span>`);
      } finally {
        fab.disabled = false;
        fab.textContent = 'Fill';
      }
    });
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  WDA.initFloatingButton = async () => {
    const settings = await WDA.storage.getSettings();
    if (settings.showFloatingButton) mount();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const s = changes.settings.newValue || {};
      s.showFloatingButton === false ? unmount() : mount();
    });
  };
})();
