/**
 * generic/fields.js — find every fillable field on an arbitrary page, with no
 * site-specific selectors: group radios/checkboxes into questions, find each field's
 * wrapper and label, and classify it (WDA.genericKey) against generic/selectors.js.
 *
 * A scanned target has the same shape the fillers in inputs.js expect:
 *   { el, container, control, kind, label, via, attrs, required }
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const G = () => WDA.GEN;

  const CHECKABLE = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]';
  const SKIP_TYPES = /^(hidden|submit|button|reset|image|password|search|range|color)$/i;

  /** Native select replaced by select2/chosen: fill the hidden native one instead. */
  const isEnhancedSelect = (el) =>
    el.matches('select') &&
    (el.classList.contains('select2-hidden-accessible') ||
      !!el.nextElementSibling?.matches('.select2, .select2-container, .chosen-container'));

  function usable(el) {
    if (el.closest(G().outside) || el.disabled) return false;
    if (el.matches('input') && SKIP_TYPES.test(el.type)) return false;
    if (el.matches('input[type="file"]')) return true;
    if (isEnhancedSelect(el)) return true;
    if (!WDA.visibleish(el)) return false;
    if (el.matches(CHECKABLE)) return true;
    // hidden helper inputs (react-select's "requiredInput", honeypots)
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' && el.tabIndex < 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return !(el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0);
  }

  /** "job_application[firstName]" → "job_application_first_name" */
  const normAttr = (s) =>
    String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const humanize = (s) => normAttr(s).replace(/_/g, ' ').trim();

  function lowestCommonAncestor(nodes) {
    let box = nodes[0].parentElement || nodes[0];
    while (box && !nodes.every((n) => box.contains(n))) box = box.parentElement;
    return box || document.body;
  }

  /** Climb from the field (or group's common ancestor) while no other field is inside, to include the label. */
  function wrapperOf(nodes, all) {
    let box = nodes.length > 1 ? lowestCommonAncestor(nodes) : nodes[0];
    const isOther = (c) => all.has(c) && !nodes.some((n) => n === c || n.contains(c) || c.contains(n));
    for (let i = 0; i < 4; i++) {
      const p = box.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      if ([...p.querySelectorAll(G().controls)].some(isOther)) break;
      box = p;
    }
    return box;
  }

  const visibleText = (el) => (el && WDA.isVisible(el) ? WDA.clean(el.innerText || el.textContent || '') : '');

  /** Text of a <label> that wraps its control, without the control's own text (select options). */
  function wrappingLabelText(label) {
    if (!label.querySelector('select, textarea, [role="listbox"]')) return WDA.clean(label.innerText);
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select, textarea, input, [role="listbox"], [role="option"]').forEach((n) => n.remove());
    return WDA.clean(copy.textContent);
  }

  /** Nearest visible text before `stop` inside `box` (usually the question/label). */
  function textBefore(box, stop) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (stop.contains(n) || stop.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      const p = n.parentElement;
      if (!p || p.closest('script, style, noscript, option, [role="option"], #wda-fab-host')) continue;
      if (WDA.clean(n.nodeValue).length >= 2 && WDA.isVisible(p)) last = p;
    }
    if (!last) return '';
    const t = visibleText(last.contains(stop) ? null : last);
    return t.length <= 250 ? t : '';
  }

  /** Text just above the wrapper (a heading/paragraph sibling with no controls in it). */
  function textAbove(box) {
    let sib = box.previousElementSibling;
    for (let i = 0; sib && i < 2; i++, sib = sib.previousElementSibling) {
      if (sib.matches(G().controls) || sib.querySelector(G().controls)) return '';
      const t = visibleText(sib);
      if (t) return t.length <= 250 ? t : '';
    }
    return '';
  }

  function controlOwnLabel(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = WDA.textOfIds(by);
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && WDA.clean(l.innerText)) return WDA.clean(l.innerText);
    }
    const wrap = el.closest('label');
    if (wrap && wrappingLabelText(wrap)) return wrappingLabelText(wrap);
    const al = el.getAttribute('aria-label');
    return al ? WDA.clean(al) : '';
  }

  function groupLabel(box, first) {
    const set = first.closest('fieldset');
    const legend = set && box.contains(set) ? set.querySelector('legend') : null;
    if (legend && visibleText(legend)) return visibleText(legend);
    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const t = WDA.textOfIds(group.getAttribute('aria-labelledby')) || WDA.clean(group.getAttribute('aria-label'));
      if (t) return t;
    }
    return textBefore(box, first) || textAbove(box);
  }

  function singleLabel(el, box) {
    return (
      controlOwnLabel(el) ||
      textBefore(box, el) ||
      textAbove(box) ||
      WDA.clean(el.getAttribute('placeholder')) ||
      WDA.clean(el.getAttribute('title')) ||
      humanize(el.getAttribute('name') || el.id)
    );
  }

  function kindOf(el) {
    if (el.matches('input[type="file"]')) return 'file';
    if (el.matches('select')) return 'select';
    if (el.matches('input[role="combobox"], input[aria-autocomplete="list"][aria-controls], input[aria-autocomplete="both"][aria-controls]')) return 'combobox';
    if (el.matches('input') && el.closest('[role="combobox"]')) return 'combobox';
    if (el.matches('[role="combobox"], button[aria-haspopup="listbox"]')) return 'dropdown';
    if (el.matches('textarea, input')) return 'text';
    return 'unknown';
  }

  /** Group key for radios/checkboxes that form one question. */
  function groupKey(el) {
    if (el.matches('input[name]') && el.name) return `n:${el.name}`;
    const g = el.closest('[role="radiogroup"], [role="group"], fieldset');
    return g ? g : null;
  }

  /** Every usable field on the page, in document order. */
  WDA.scanFields = (root = document.body) => {
    if (!root) return [];
    const controls = [...root.querySelectorAll(G().controls)].filter(usable);
    // custom widgets often wrap a native input: keep the outer widget, except a
    // combobox wrapper around a text input (ARIA 1.1), where the input is the field
    const typeable = (c) => c.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    const list = controls.filter((c) => {
      if (c.matches('[role="combobox"]:not(input)') && [...c.querySelectorAll('input')].some((i) => controls.includes(i) && typeable(i))) return false;
      return !controls.some((o) => o !== c && o.contains(c) && !(o.matches('[role="combobox"]') && typeable(c)));
    });
    const all = new Set(list);

    const groups = new Map();
    const order = [];
    for (const el of list) {
      if (el.matches(CHECKABLE)) {
        const k = groupKey(el);
        if (k) {
          if (!groups.has(k)) {
            groups.set(k, []);
            order.push({ group: k });
          }
          groups.get(k).push(el);
          continue;
        }
      }
      order.push({ el });
    }

    const out = [];
    for (const item of order) {
      const nodes = item.group ? groups.get(item.group) : [item.el];
      const first = nodes[0];
      const box = wrapperOf(nodes, all);
      let t;
      if (first.matches(CHECKABLE)) {
        const isRadio = first.matches('input[type="radio"], [role="radio"]');
        if (nodes.length > 1 || isRadio) {
          t = { el: first, container: box, control: box, kind: 'choice', label: groupLabel(box, first) };
          // a lone radio/checkbox with no question text: use the option text
          if (!t.label) t.label = controlOwnLabel(first);
        } else {
          t = { el: first, container: box, control: first, kind: 'checkbox', label: controlOwnLabel(first) || textBefore(box, first) };
        }
      } else {
        t = { el: first, container: box, control: first, kind: kindOf(first), label: singleLabel(first, box) };
      }
      if (t.kind === 'unknown') continue;
      t.via = 'page scan';
      t.attrs = ['name', 'id', 'data-qa', 'data-testid', 'data-automation-id', 'aria-label', 'placeholder']
        .map((a) => normAttr(first.getAttribute(a)))
        .filter(Boolean);
      const ownBox = ![...box.querySelectorAll(G().controls)].some((c) => all.has(c) && !nodes.includes(c));
      t.required =
        nodes.some((n) => n.required || n.getAttribute('aria-required') === 'true') ||
        box.getAttribute('aria-required') === 'true' ||
        (ownBox && /[*✱]/.test((box.innerText || '').slice(0, 300)));
      out.push(t);
    }
    return out;
  };

  /** Profile key for a scanned field (see generic/selectors.js), or null. */
  WDA.genericKey = (t) => {
    const rules = G().rules.filter((r) => !r.kinds || r.kinds.includes(t.kind));
    const label = t.label || '';
    const notOther = (r) => !G().personalKeys.includes(r.key) || !G().otherPerson.test(label);
    const auto = (t.el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    const passes = [
      (r) => r.auto && r.auto.some((a) => auto.includes(a)),
      (r) => r.label && label && label.length <= (r.maxLabel || 60) && r.label.test(label),
      (r) => r.attr && t.attrs.some((a) => r.attr.test(a)),
      (r) => r.type && t.el.matches(`input[type="${r.type}"]`),
    ];
    for (const pass of passes) {
      const r = rules.find((x) => notOther(x) && pass(x));
      if (r) return r.key;
    }
    return null;
  };

  /** How much this frame looks like an application form (the popup fills the best frame). */
  WDA.formScore = () => {
    const n = document.querySelectorAll('input, select, textarea').length;
    if (n < 2 || n > 600) return 0;
    const fields = WDA.scanFields();
    const known = fields.filter((t) => {
      const k = WDA.genericKey(t);
      return k && k !== 'skip';
    }).length;
    return fields.length + known * 5;
  };

  /** Whether to show the floating Fill button on this (generic) page. */
  WDA.looksLikeApplication = () => {
    const n = document.querySelectorAll('input, select, textarea').length;
    if (n < 2 || n > 600) return false;
    const keys = new Set(WDA.scanFields().map(WDA.genericKey).filter((k) => k && k !== 'skip' && k !== 'coverLetter'));
    const contact = ['firstName', 'lastName', 'fullName', 'email', 'phone'].filter((k) => keys.has(k)).length;
    return contact >= 2 || (contact >= 1 && keys.has('resume'));
  };
})();
