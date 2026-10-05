/**
 * dump.js — "Dump fields (debug)": a compact JSON snapshot of every visible control on
 * the current step, for pasting back so selectors can be fixed.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  const trunc = (s, n = 100) => {
    s = String(s ?? '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  /** Drop undefined / empty values so each line stays short. */
  const prune = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === undefined || v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(prune(v)).length)) delete o[k];
    }
    return o;
  };

  function valueOf(el) {
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return el.checked;
    if (el.matches('[role="checkbox"], [role="radio"]')) return el.getAttribute('aria-checked');
    if (el.matches('input[type="file"]')) return el.files ? `${el.files.length} file(s)` : '';
    if (el.matches('input[type="password"]')) return el.value ? '***' : '';
    if (el.matches('input, textarea, select')) return trunc(el.value, 80);
    return trunc(WDA.clean(el.innerText), 80);
  }

  WDA.dumpFields = () => {
    const fieldSel = WDA.SELECTORS.containers.field;
    const sel = [
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button[aria-haspopup]',
      '[role="combobox"]:not(input)',
      '[role="radio"]:not(input)',
      '[role="checkbox"]:not(input)',
      '[role="spinbutton"]:not(input)',
    ].join(', ');

    const fields = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!WDA.visibleish(el) || el.closest('#wda-fab-host')) continue;
      const box = el.closest(fieldSel);
      const attr = (n) => el.getAttribute(n) || undefined;
      fields.push(
        prune({
          tag: el.tagName.toLowerCase(),
          type: el.tagName === 'INPUT' ? el.type : attr('role'),
          aid: attr('data-automation-id'),
          id: el.id || undefined,
          name: attr('name'),
          box: box ? box.getAttribute('data-automation-id') : undefined,
          label: trunc(box ? WDA.labelFor(box) : WDA.controlLabel(el)),
          opt: el.matches('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]') ? trunc(WDA.controlLabel(el), 80) : undefined,
          value: valueOf(el),
          uxi: attr('data-uxi-widget-type'),
          aria: {
            label: attr('aria-label') && trunc(attr('aria-label'), 80),
            haspopup: attr('aria-haspopup'),
            expanded: attr('aria-expanded'),
            required: attr('aria-required'),
            invalid: attr('aria-invalid'),
            role: el.tagName === 'INPUT' ? attr('role') : undefined,
          },
        })
      );
    }

    const headings = [...document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')]
      .filter(WDA.isVisible)
      .map((h) => `${h.tagName.toLowerCase()}: ${trunc(WDA.clean(h.innerText), 60)}`)
      .filter((t) => !/: $/.test(t))
      .slice(0, 40);

    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => WDA.isVisible(b) && !b.matches('[aria-haspopup]') && !b.closest('#wda-fab-host'))
      .map((b) => prune({ text: trunc(WDA.clean(b.innerText), 40), aid: b.getAttribute('data-automation-id') || undefined, aria: b.getAttribute('aria-label') || undefined }))
      .filter((b) => b.text || b.aid)
      .slice(0, 40);

    const sections = [...new Set(
      [...document.querySelectorAll('[data-automation-id]')]
        .map((e) => e.getAttribute('data-automation-id'))
        .filter((a) => /section|^(workExperience|education|language|website|webAddress)-?\d*$|progressBar/i.test(a))
    )].slice(0, 40);

    const step = WDA.detectStep();
    const meta = {
      site: WDA.site,
      page: location.hostname + location.pathname,
      step: step.label,
      stepSource: step.source,
      when: new Date().toISOString(),
      extension: chrome.runtime.getManifest().version,
      fieldCount: fields.length,
    };

    const json =
      '{\n' +
      `"meta": ${JSON.stringify(meta)},\n` +
      `"headings": ${JSON.stringify(headings)},\n` +
      `"sections": ${JSON.stringify(sections)},\n` +
      `"buttons": [\n${buttons.map((b) => '  ' + JSON.stringify(b)).join(',\n')}\n],\n` +
      `"fields": [\n${fields.map((f) => '  ' + JSON.stringify(f)).join(',\n')}\n]\n` +
      '}';
    WDA.log('field dump:\n' + json);
    return { json, count: fields.length };
  };
})();
