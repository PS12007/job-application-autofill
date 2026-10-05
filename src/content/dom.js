/**
 * dom.js — low-level DOM helpers: waiting, visibility, labels, React-safe value
 * setting, guarded clicks and synthetic key presses.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Resolve with the first truthy value returned by fn(). Re-checks on DOM mutations
   * (throttled) and on a short poll. Resolves null when the timeout expires — never rejects.
   */
  WDA.waitFor = (fn, { timeout = 5000, interval = 100 } = {}) =>
    new Promise((resolve) => {
      let settled = false;
      let obs = null;
      let poll = null;
      let timer = null;
      let scheduled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        if (obs) obs.disconnect();
        clearInterval(poll);
        clearTimeout(timer);
        resolve(v);
      };
      const check = () => {
        if (settled) return;
        let v = null;
        try {
          v = fn();
        } catch (_) {
          v = null;
        }
        if (v) finish(v);
      };
      check();
      if (settled) return;
      obs = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          check();
        }, 30);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      poll = setInterval(check, interval);
      timer = setTimeout(() => finish(null), timeout);
    });

  /** Wait until the DOM has been quiet for `quiet` ms (or `max` ms passed). */
  WDA.waitForSettle = (quiet = 400, max = 3000) =>
    new Promise((resolve) => {
      const start = Date.now();
      let last = Date.now();
      const obs = new MutationObserver(() => {
        last = Date.now();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const iv = setInterval(() => {
        const now = Date.now();
        if (now - last >= quiet || now - start >= max) {
          clearInterval(iv);
          obs.disconnect();
          resolve();
        }
      }, 50);
    });

  /** Reject with `message` if the promise doesn't settle within ms. */
  WDA.withTimeout = (promise, ms, message = 'timed out') =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms);
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });

  WDA.isVisible = (el) => {
    if (!el || !el.isConnected || el.nodeType !== 1) return false;
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  /** Visible, or a hidden-by-design input (file / custom-styled checkbox) inside something visible. */
  WDA.visibleish = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.matches('input[type="file"]')) return true;
    if (WDA.isVisible(el)) return true;
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return WDA.isVisible(el.parentElement);
    return false;
  };

  /** Normalise label text: drop required "*", collapse whitespace. */
  WDA.clean = (t) =>
    String(t || '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(?required\)?\s*$/i, '')
      .trim();

  WDA.textOfIds = (ids) =>
    WDA.clean(
      String(ids || '')
        .split(/\s+/)
        .map((id) => id && document.getElementById(id))
        .filter(Boolean)
        .map((e) => e.innerText || e.textContent)
        .join(' ')
    );

  /** Label of a field wrapper / fieldset (the question text). */
  WDA.labelFor = (node) => {
    if (!node || node.nodeType !== 1) return '';
    const by = node.getAttribute('aria-labelledby');
    if (by) {
      const t = WDA.textOfIds(by);
      if (t) return t;
    }
    const lab = node.querySelector('legend, label, [data-automation-id="formLabel"]');
    if (lab) {
      const t = WDA.clean(lab.innerText || lab.textContent);
      if (t) return t;
    }
    const al = node.getAttribute('aria-label');
    return al ? WDA.clean(al) : '';
  };

  /** Label of a single control (e.g. one radio option). */
  WDA.controlLabel = (el) => {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && WDA.clean(l.innerText)) return WDA.clean(l.innerText);
    }
    const parentLabel = el.closest('label');
    if (parentLabel && WDA.clean(parentLabel.innerText)) return WDA.clean(parentLabel.innerText);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = WDA.textOfIds(by);
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al) return WDA.clean(al);
    if (el.matches('input[type="checkbox"], input[type="radio"]') && el.parentElement) {
      const sib = el.parentElement.querySelector('label');
      if (sib) return WDA.clean(sib.innerText);
      return WDA.clean(el.parentElement.innerText);
    }
    return WDA.clean(el.innerText || el.value || '');
  };

  /**
   * React-safe value set: use the native prototype setter (bypasses React's value
   * tracker), then fire input + change so React's onChange runs.
   */
  WDA.setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  WDA.blurEl = (el) => {
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.blur();
  };

  /** Focus, set value (native setter + input/change), then blur. */
  WDA.setText = (el, value, { blur = true } = {}) => {
    el.focus();
    WDA.setNativeValue(el, value);
    if (blur) WDA.blurEl(el);
  };

  /** Fallback typing via execCommand — produces real input events React always accepts. */
  WDA.typeText = (el, value) => {
    el.focus();
    if (typeof el.select === 'function') el.select();
    if (value === '') document.execCommand('delete');
    else document.execCommand('insertText', false, value);
  };

  /** Throws if el is (inside) a navigation / submit / sign-in control. */
  WDA.assertClickable = (el) => {
    const N = WDA.SELECTORS.nav;
    if (el.closest(N.blockedZones)) throw new Error('Refused to click inside the page navigation footer');
    if (el.closest('[role="option"], [role="listbox"], [data-automation-id="promptOption"]')) return;
    const btn = el.closest('button, a, [role="button"], input[type="submit"], input[type="button"]');
    if (!btn) return;
    const aid = btn.getAttribute('data-automation-id') || '';
    const text = WDA.clean(btn.innerText || btn.value || btn.getAttribute('aria-label') || '');
    if (N.blockedIds.includes(aid) || N.blockedText.test(text)) {
      throw new Error(`Refused to click navigation button "${text || aid}"`);
    }
  };

  /** Guarded plain click. */
  WDA.safeClick = (el) => {
    WDA.assertClickable(el);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
  };

  /** Guarded full pointer/mouse sequence, for widgets that ignore a bare click(). */
  WDA.safeMouse = (el) => {
    WDA.assertClickable(el);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  };

  const KEYCODES = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 };

  WDA.pressKey = (el, key) => {
    const target = el || document.activeElement || document.body;
    const init = { key, code: key, keyCode: KEYCODES[key], which: KEYCODES[key], bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  };
})();
