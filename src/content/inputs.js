/**
 * inputs.js — find a field (by automation id, then label) and fill it according to
 * its control type: text, button-dropdown, searchable prompt, radio/checkbox group,
 * single checkbox, date (split or single) and file upload.
 *
 * Every filler returns { status: 'filled' | 'skipped' | 'failed', reason }.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const S = () => WDA.SELECTORS;

  const ok = (reason = '') => ({ status: 'filled', reason });
  const skip = (reason) => ({ status: 'skipped', reason });
  const fail = (reason) => ({ status: 'failed', reason });
  WDA.result = { ok, skip, fail };

  const show = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

  /* =========================================================================
   * Locating fields
   * ======================================================================= */

  function idSelectors(id) {
    return [
      `[data-automation-id="formField-${id}"]`,
      `[data-automation-id="${id}"]`,
      `[id="${id}"]`,
      `[id$="--${id}"]`,
      `[name="${id}"]`,
    ];
  }

  function firstVisible(scope, sel) {
    try {
      return [...scope.querySelectorAll(sel)].find(WDA.visibleish) || null;
    } catch (e) {
      WDA.warn('bad selector', sel, e);
      return null;
    }
  }

  /**
   * Find a field by its spec within scope. Returns a target or null. A match with no
   * fillable control (e.g. read-only text) is only returned if nothing better is found.
   */
  WDA.resolve = (spec, scope = document) => {
    if (!spec || !scope) return null;
    let readOnly = null;
    const consider = (el, via) => {
      if (!el) return null;
      const t = WDA.buildTarget(el, via);
      if (t.kind !== 'unknown') return t;
      readOnly = readOnly || t;
      return null;
    };
    for (const id of spec.ids || []) {
      for (const sel of idSelectors(id)) {
        const t = consider(firstVisible(scope, sel), `id "${id}"`);
        if (t) return t;
      }
    }
    if (spec.labels && spec.labels.length) {
      const t = consider(findByLabel(spec.labels, scope, spec.exclude), 'label');
      if (t) return t;
    }
    for (const sel of spec.selectors || []) {
      const t = consider(firstVisible(scope, sel), `selector ${sel}`);
      if (t) return t;
    }
    return readOnly;
  };

  function findByLabel(patterns, scope, exclude = []) {
    const fieldSel = S().containers.field;
    const root = scope === document ? document.body : scope;
    for (const node of root.querySelectorAll(`${fieldSel}, fieldset, label`)) {
      if (!WDA.isVisible(node)) continue;
      let text;
      let target;
      if (node.tagName === 'LABEL') {
        if (node.closest(fieldSel)) continue; // the wrapper is checked instead
        target =
          (node.htmlFor && document.getElementById(node.htmlFor)) || node.querySelector('input, textarea, button');
        if (target && target.matches('input[type="radio"]')) continue; // radio option, not a question
        text = WDA.clean(node.innerText);
      } else {
        if (node.querySelector(fieldSel)) continue; // only the innermost wrapper
        text = WDA.labelFor(node);
        target = node;
      }
      if (!text || !target || !root.contains(target)) continue;
      if (patterns.some((p) => p.test(text)) && !exclude.some((p) => p.test(text))) return target;
    }
    return null;
  }

  /** Wrap any element (control or field wrapper) into a target with a detected kind. */
  WDA.buildTarget = (el, via = '') => {
    const container = el.closest(S().containers.field) || el.closest('fieldset') || el;
    const { kind, control } = classify(el, container);
    return {
      el,
      container,
      control,
      kind,
      via,
      label: WDA.labelFor(container) || WDA.controlLabel(control || el),
    };
  };

  /** Greenhouse/other sites: a role=combobox <input> is an autocomplete (Workday's are "prompts"). */
  const isReactSelectInput = (el) => WDA.site !== 'workday' && el.matches('input[role="combobox"]');

  function classify(el, container) {
    const C = S().controls;
    if (el.matches(C.fileInput)) return { kind: 'file', control: el };
    if (el.matches('select')) return { kind: 'select', control: el };
    if (isReactSelectInput(el)) return { kind: 'combobox', control: el };
    if (el.matches(C.dateAny)) {
      const root = container !== el ? container : el.parentElement?.parentElement?.parentElement || el;
      return { kind: 'date', control: root };
    }
    if (el.matches(C.dropdownButton)) return { kind: 'dropdown', control: el };
    if (el.matches(C.promptInput)) return { kind: 'prompt', control: el };
    if (el.matches('input[type="radio"], [role="radio"]')) return { kind: 'choice', control: container };
    if (el.matches('input[type="checkbox"], [role="checkbox"]')) {
      const n = container.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length;
      return n > 1 && container !== el ? { kind: 'choice', control: container } : { kind: 'checkbox', control: el };
    }
    if (el.matches('textarea, input')) return { kind: 'text', control: el };
    return classifyContainer(el);
  }

  function classifyContainer(box) {
    const C = S().controls;
    const q = (s) => box.querySelector(s);
    let c;
    if ((c = q(C.fileInput))) return { kind: 'file', control: c };
    if ((c = q('select'))) return { kind: 'select', control: c };
    if (WDA.site !== 'workday' && (c = q('input[role="combobox"]'))) return { kind: 'combobox', control: c };
    if (q(C.dateAny)) return { kind: 'date', control: box };
    if ((c = q(C.dropdownButton))) return { kind: 'dropdown', control: c };
    if ((c = q(C.promptInput))) return { kind: 'prompt', control: c };
    if (box.querySelector('input[type="radio"], [role="radio"]')) return { kind: 'choice', control: box };
    const cbs = box.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
    if (cbs.length > 1) return { kind: 'choice', control: box };
    if (cbs.length === 1) return { kind: 'checkbox', control: cbs[0] };
    if ((c = q('textarea'))) return { kind: 'text', control: c };
    if ((c = q('input:not([type="hidden"]):not([type="button"]):not([type="submit"])'))) return { kind: 'text', control: c };
    return { kind: 'unknown', control: box };
  }

  /* =========================================================================
   * Current-value checks (for the "don't overwrite" rule)
   * ======================================================================= */

  const isChecked = (el) => el.checked === true || el.getAttribute('aria-checked') === 'true';

  function promptBox(t) {
    if (t.container && t.container !== t.control) return t.container;
    const input = t.control;
    return input.closest('[data-automation-id="multiselectInputContainer"]')?.parentElement || input.parentElement?.parentElement || input;
  }

  function selectedTexts(box) {
    return [...box.querySelectorAll(S().prompt.selectedItem)]
      .map((el) => WDA.clean(el.getAttribute('data-automation-label') || el.innerText))
      .filter(Boolean);
  }

  function choiceOptions(box) {
    return [...box.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')]
      .filter((el) => !(el.matches('[role]') && !el.matches('input') && el.querySelector('input')))
      .map((el) => ({ el, text: WDA.controlLabel(el) }));
  }

  WDA.hasValue = (t) => {
    const C = S().controls;
    switch (t.kind) {
      case 'text':
        return !!(t.control.value || '').trim();
      case 'dropdown':
        return !WDA.isPlaceholder(t.control.innerText);
      case 'prompt':
        return selectedTexts(promptBox(t)).length > 0;
      case 'checkbox':
        return isChecked(t.control);
      case 'choice':
        return choiceOptions(t.control).some((o) => isChecked(o.el));
      case 'date':
        return [...t.control.querySelectorAll(`${C.dateAny}, input`)].some((i) => (i.value || '').trim() && !/^(mm|dd|yyyy)$/i.test(i.value));
      case 'file':
        return (
          !!(t.control.files && t.control.files.length) ||
          !!(t.container && t.container.querySelector(`${S().upload.uploaded}, ${WDA.GH.uploaded}`))
        );
      case 'select': {
        const o = t.control.selectedOptions && t.control.selectedOptions[0];
        return !!(o && o.value !== '' && !WDA.isPlaceholder(o.text));
      }
      case 'combobox':
        return WDA.comboValues(t.container, t.control).length > 0;
      default:
        return false;
    }
  };

  /* =========================================================================
   * Dispatcher
   * ======================================================================= */

  WDA.fillTarget = async (t, value, ctx, opts = {}) => {
    switch (t.kind) {
      case 'text':
        return fillText(t, value, ctx);
      case 'dropdown':
        return fillDropdown(t, value, ctx);
      case 'prompt':
        return fillPrompt(t, value, ctx, opts);
      case 'choice':
        return fillChoice(t, value, ctx);
      case 'checkbox':
        return fillCheckbox(t, value, ctx);
      case 'date':
        return fillDate(t, value, ctx);
      case 'file':
        return fillFile(t, value, ctx);
      case 'select':
        return fillSelect(t, value, ctx);
      case 'combobox':
        return WDA.fillCombobox(t, value, ctx);
      default:
        return skip('not an editable field on this page (probably read-only)');
    }
  };

  /* =========================================================================
   * Text / textarea
   * ======================================================================= */

  async function fillText(t, value, ctx) {
    const el = t.control;
    const want = typeof value === 'string' ? WDA.firstAlt(value) : String(value);
    const cur = (el.value || '').trim();
    const same = (a) => a.trim() === want.trim() || (/\d/.test(want) && a.replace(/\D/g, '') === want.replace(/\D/g, '') && /^[\d\s()+.\-]+$/.test(want));
    if (same(cur)) return ok('already set');
    if (el.readOnly || el.disabled) return skip('field is read-only');
    if (cur && !ctx.settings.overwrite) return skip(`has existing value "${WDA.shortLabel(cur, 30)}"`);

    WDA.setText(el, want);
    await WDA.sleep(30);
    if (!same(el.value || '')) {
      WDA.log('native setter did not stick, retrying with execCommand', el);
      WDA.typeText(el, want);
      WDA.blurEl(el);
      await WDA.sleep(30);
    }
    return same(el.value || '') ? ok() : fail(`value didn't stick (field shows "${WDA.shortLabel(el.value || '', 30)}")`);
  }

  /* =========================================================================
   * Native <select> (legacy Greenhouse; select2 listens to the native change event)
   * ======================================================================= */

  async function fillSelect(t, value, ctx) {
    const sel = t.control;
    if (typeof value === 'string' && value.includes('>')) value = value.split('>').pop().trim();
    const options = [...sel.options].filter((o) => o.value !== '' && !WDA.isPlaceholder(o.text));
    const cur = sel.selectedOptions && sel.selectedOptions[0];
    const hasCur = cur && cur.value !== '' && !WDA.isPlaceholder(cur.text);
    const want = WDA.bestMatch(options, value, (o) => o.text);
    if (!want) return fail(`no option matches "${show(value)}" (options: ${options.slice(0, 8).map((o) => o.text.trim()).join(' / ')})`);
    if (hasCur && cur === want) return ok('already set');
    if (hasCur && !ctx.settings.overwrite) return skip(`has value "${cur.text.trim()}"`);
    if (sel.disabled) return skip('field is disabled');

    WDA.focusEl(sel);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, want.value);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    WDA.blurEl(sel);
    return sel.value === want.value ? ok(want.text.trim()) : fail(`selected "${want.text.trim()}" but it did not stick`);
  }

  /* =========================================================================
   * Button dropdown → listbox popup
   * ======================================================================= */

  /**
   * Popup listboxes only. Workday also renders the chosen-value "pills" of prompts as
   * role=listbox inside the field — those must never be mistaken for a dropdown's list.
   */
  const isPopupListbox = (l) => !l.closest(S().listbox.exclude) && !l.querySelector(S().listbox.exclude);
  const visibleListboxes = () =>
    [...document.querySelectorAll(S().listbox.root)].filter(
      (l) => isPopupListbox(l) && WDA.isVisible(l) && l.querySelector(S().listbox.option)
    );

  /** Open the dropdown and return the listbox that belongs to it (never a stale one). */
  async function openListbox(btn) {
    if (visibleListboxes().length) {
      closePopups();
      await WDA.waitFor(() => !visibleListboxes().length, { timeout: 1500 });
    }
    const stale = new Set(visibleListboxes());
    const fresh = () => {
      const id = btn.getAttribute('aria-controls') || btn.getAttribute('aria-owns');
      const owned = id && document.getElementById(id);
      if (owned && WDA.isVisible(owned) && owned.querySelector(S().listbox.option)) {
        return owned.matches(S().listbox.root) ? owned : owned.querySelector(S().listbox.root) || owned;
      }
      return visibleListboxes().filter((l) => !stale.has(l)).pop();
    };
    WDA.safeClick(btn);
    let lb = await WDA.waitFor(fresh, { timeout: 2500 });
    if (!lb) {
      WDA.log('listbox did not open on click(), trying mouse sequence');
      WDA.safeMouse(btn);
      lb = await WDA.waitFor(fresh, { timeout: 2500 });
    }
    return lb;
  }

  function scrollParent(el) {
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      if (n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }

  /** Find the best option, scrolling the list in case it is virtualised. */
  async function findOption(lb, value) {
    const pick = () =>
      WDA.bestMatch([...lb.querySelectorAll(S().listbox.option)], value, (o) => o.getAttribute('data-automation-label') || o.innerText);
    let hit = pick();
    if (hit) return hit;
    const scroller = scrollParent(lb);
    for (let i = 0; scroller && i < 40; i++) {
      const prev = scroller.scrollTop;
      scroller.scrollTop += Math.max(scroller.clientHeight - 20, 100);
      await WDA.sleep(60);
      hit = pick();
      if (hit) return hit;
      if (scroller.scrollTop === prev) break;
    }
    return null;
  }

  const openPromptPopups = () =>
    [...document.querySelectorAll(S().prompt.popup)].filter((p) => isPopupListbox(p) && WDA.isVisible(p));

  function closePopups() {
    if (visibleListboxes().length || openPromptPopups().length) {
      WDA.pressKey(document.activeElement || document.body, 'Escape');
    }
  }
  WDA.closePopups = closePopups;

  async function fillDropdown(t, value, ctx) {
    if (typeof value === 'string' && value.includes('>')) value = value.split('>').pop().trim();
    const getBtn = () => (t.control.isConnected ? t.control : t.container.querySelector(S().controls.dropdownButton)) || t.control;
    const cur = WDA.clean(getBtn().innerText);
    if (!WDA.isPlaceholder(cur)) {
      if (WDA.bestMatch([cur], value)) return ok('already set');
      if (!ctx.settings.overwrite) return skip(`has value "${cur}"`);
    }

    const lb = await openListbox(getBtn());
    if (!lb) return fail('dropdown list did not open');

    const opt = await findOption(lb, value);
    if (!opt) {
      closePopups();
      return fail(`no option matches "${show(value)}"`);
    }
    const optText = WDA.clean(opt.getAttribute('data-automation-label') || opt.innerText);
    if (typeof opt.scrollIntoView === 'function') opt.scrollIntoView({ block: 'nearest' });

    const registered = () => WDA.norm(getBtn().innerText).includes(WDA.norm(optText));
    WDA.safeClick(opt);
    let done = await WDA.waitFor(registered, { timeout: 2500 });
    if (!done && opt.isConnected) {
      WDA.log('option click did not register, trying mouse sequence');
      WDA.safeMouse(opt);
      done = await WDA.waitFor(registered, { timeout: 2500 });
    }
    if (visibleListboxes().length) closePopups();
    return done ? ok(optText) : fail(`selected "${optText}" but the dropdown did not update`);
  }

  /* =========================================================================
   * Searchable / multiselect prompt
   * ======================================================================= */

  function promptOptions() {
    const P = S().prompt;
    const usable = (o) => WDA.isVisible(o) && isPopupListbox(o);
    let opts = [...document.querySelectorAll(P.option)].filter(usable);
    if (!opts.length) opts = [...document.querySelectorAll(P.fallbackOption)].filter(usable);
    return opts;
  }
  const optText = (o) => WDA.clean(o.getAttribute('data-automation-label') || o.innerText);

  function noItemsShown() {
    return openPromptPopups().some((p) => S().prompt.noItems.test(p.innerText || ''));
  }

  function isSelected(box, label) {
    const nl = WDA.norm(label);
    if (!nl) return false;
    if (selectedTexts(box).some((s) => WDA.norm(s).includes(nl) || nl.includes(WDA.norm(s)))) return true;
    return WDA.norm(box.innerText).includes(nl);
  }

  function liveInput(input, box) {
    return input.isConnected ? input : box.querySelector(S().controls.promptInput) || input;
  }

  /** Results seen by the last search — shown in the failure reason to aid debugging. */
  let promptSeen = [];

  /**
   * Search-term variants for institution names: "X University" ↔ "University of X",
   * with and without a leading "The".
   */
  function nameVariants(term) {
    const t = term.replace(/^the\s+/i, '').trim();
    const out = [];
    let m;
    if ((m = t.match(/^(.+?)\s+(university|college)$/i))) out.push(`${m[2]} of ${m[1]}`);
    if ((m = t.match(/^(university|college)\s+of\s+(.+)$/i))) out.push(`${m[2]} ${m[1]}`);
    if (t !== term) out.push(t);
    else if (/^(university|college)\s+of\b/i.test(t)) out.push(`The ${t}`);
    return out;
  }

  /**
   * Type a term, press Enter, wait for results, click the option chosen by pick()
   * (default: best match for the term). Follows sub-menus up to 3 levels.
   * Returns the selected option's label, or null.
   */
  async function searchPrompt(input, box, term, pick = (opts) => WDA.bestMatch(opts, term, optText)) {
    input = liveInput(input, box);
    WDA.safeClick(input);
    WDA.focusEl(input);
    WDA.setNativeValue(input, term);
    WDA.pressKey(input, 'Enter');

    for (let level = 0; level < 3; level++) {
      // Workday may flash "No Items." before results arrive, so only trust it once it
      // has stayed on screen for a while; otherwise keep waiting for results.
      const started = Date.now();
      let noneSince = 0;
      const hit = await WDA.waitFor(
        () => {
          const opts = promptOptions();
          for (const o of opts.slice(0, 6)) if (!promptSeen.includes(optText(o)) && promptSeen.length < 8) promptSeen.push(optText(o));
          const m = pick(opts);
          if (m) return m;
          if (!opts.length && noItemsShown()) {
            noneSince = noneSince || Date.now();
            if (Date.now() - noneSince > 1500 && Date.now() - started > 2000) {
              return 'none';
            }
          } else noneSince = 0;
          return null;
        },
        { timeout: 7000 }
      );
      if (!hit || hit === 'none') {
        WDA.log(`prompt: no usable result for "${term}"`, promptSeen);
        return null;
      }
      const label = optText(hit);
      const before = promptOptions().map(optText).join('|');
      WDA.safeClick(hit);
      const res = await WDA.waitFor(
        () => (isSelected(box, label) ? 'selected' : promptOptions().map(optText).join('|') !== before ? 'changed' : null),
        { timeout: 2500 }
      );
      if (res === 'selected') return label;
      if (res === 'changed' && promptOptions().length) continue; // opened a sub-menu; match again
      // click didn't register: try the inner radio/checkbox or a full mouse sequence
      if (hit.isConnected) {
        WDA.safeMouse(hit.querySelector('input[type="radio"], input[type="checkbox"]') || hit);
        if (await WDA.waitFor(() => isSelected(box, label), { timeout: 2000 })) return label;
      }
      return null;
    }
    return null;
  }

  /** "Category > Sub > Option": open the list and click through each level. */
  async function browsePromptPath(input, box, path) {
    input = liveInput(input, box);
    WDA.safeClick(input);
    for (let i = 0; i < path.length; i++) {
      const hit = await WDA.waitFor(() => WDA.bestMatch(promptOptions(), path[i], optText), { timeout: 4000 });
      if (!hit) {
        WDA.log(`prompt: no option "${path[i]}" at level ${i + 1}`);
        return false;
      }
      const label = optText(hit);
      const before = promptOptions().map(optText).join('|');
      WDA.safeClick(hit);
      if (i === path.length - 1) return (await WDA.waitFor(() => isSelected(box, label), { timeout: 2500 })) ? label : null;
      await WDA.waitFor(() => promptOptions().map(optText).join('|') !== before, { timeout: 3000 });
    }
    return null;
  }

  const STOPWORDS = new Set([
    'and', 'of', 'the', 'in', 'for', 'with', 'at',
    'engineering', 'science', 'sciences', 'studies', 'technology', 'general',
    'university', 'college', 'school', 'institute', 'polytechnic', 'state',
  ]);

  /**
   * Search terms for a value: its "|" alternatives + synonyms + institution name
   * variants, and the most distinctive word for a closest-match fallback (or null).
   */
  WDA.searchPlan = (value) => {
    const alts = WDA.expandAlternatives(value);
    for (const a of [...alts]) {
      for (const v of nameVariants(a)) if (!alts.some((x) => WDA.norm(x) === WDA.norm(v))) alts.push(v);
    }
    const words = WDA.norm(alts[0] || '').split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    const key = words.sort((a, b) => b.length - a.length)[0] || null;
    return { alts, key: key && key !== WDA.norm(alts[0]) ? key : null };
  };

  /**
   * Returns the selected label or null. Tries: each "|" alternative (plus built-in
   * synonyms), then — if nothing matched — searches the value's most distinctive word
   * ("Mechatronics") and takes the closest result containing it.
   */
  async function selectInPrompt(input, box, value) {
    const path = String(value).split('>').map((s) => s.trim()).filter(Boolean);
    if (path.length > 1) return browsePromptPath(input, box, path);
    const clearSearch = () => {
      const live = liveInput(input, box);
      if (live.value) WDA.setNativeValue(live, '');
    };
    const { alts, key } = WDA.searchPlan(value);
    for (const term of alts) {
      const label = await searchPrompt(input, box, term);
      if (label) return label;
      clearSearch();
    }
    // Closest-match fallback on the first alternative's most distinctive word
    if (key) {
      WDA.log(`prompt: no exact result for "${alts[0]}", trying closest match on "${key}"`);
      const pick = (opts) =>
        WDA.bestMatch(opts, value, optText) || opts.filter((o) => ` ${WDA.norm(optText(o))} `.includes(` ${key} `)).sort((a, b) => optText(a).length - optText(b).length)[0];
      const label = await searchPrompt(input, box, key, pick);
      if (label) return label;
      clearSearch();
    }
    return null;
  }

  async function clearPromptSelection(box) {
    for (const x of [...box.querySelectorAll(S().prompt.deletePill)]) {
      WDA.safeClick(x);
      await WDA.sleep(150);
    }
  }

  async function fillPrompt(t, value, ctx, opts) {
    const multi = Array.isArray(value) || !!opts.multi;
    const values = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
    const box = promptBox(t);
    let existing = selectedTexts(box);

    if (!multi) {
      if (existing.some((s) => WDA.bestMatch([s], values[0]))) return ok('already set');
      if (existing.length && !ctx.settings.overwrite) return skip(`has value "${existing[0]}"`);
      if (existing.length) await clearPromptSelection(box);
    }

    const added = [];
    const missing = [];
    const substituted = []; // "wanted → picked" when the closest match differs
    try {
      for (const v of values) {
        if (multi && existing.some((s) => WDA.bestMatch([s], v))) {
          added.push(v);
          continue;
        }
        promptSeen = [];
        const label = await selectInPrompt(t.control, box, v);
        if (label) {
          added.push(v);
          const exact = WDA.expandAlternatives(v).some((a) => WDA.norm(a) === WDA.norm(label));
          if (!exact) substituted.push(`${WDA.firstAlt(v)} → ${label}`);
        } else missing.push(v);
        existing = selectedTexts(box);
        await WDA.sleep(ctx.settings.fieldDelay);
      }
    } finally {
      closePopups();
      const live = liveInput(t.control, box);
      if (live) WDA.blurEl(live);
    }

    const subNote = substituted.length ? `closest match used: ${substituted.join('; ')}` : '';
    if (!missing.length) return ok(subNote || (multi ? `${added.length} selected` : ''));
    const seen = promptSeen.length ? ` Last results seen: ${promptSeen.join(' / ')}.` : ' No results appeared.';
    if (!multi) return fail(`no search result matches "${WDA.firstAlt(values[0])}".${seen} Add alternatives with | (e.g. "…|Other")`);
    return skip(`${added.length} added; no match for: ${missing.join(', ')}`);
  }

  /* =========================================================================
   * Radio / checkbox groups and single checkboxes
   * ======================================================================= */

  async function clickChoice(el, wantChecked = true) {
    WDA.safeClick(el);
    if (await WDA.waitFor(() => isChecked(el) === wantChecked, { timeout: 800 })) return true;
    const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (lab) {
      WDA.safeClick(lab);
      if (await WDA.waitFor(() => isChecked(el) === wantChecked, { timeout: 800 })) return true;
    }
    WDA.safeMouse(el);
    return !!(await WDA.waitFor(() => isChecked(el) === wantChecked, { timeout: 800 }));
  }

  /** "Select all that apply" checkbox groups: answer "A; B; C" checks each listed option. */
  async function fillChoiceMulti(opts, wanted, ctx) {
    const picks = [];
    const missing = [];
    for (const w of wanted) {
      const m = WDA.bestMatch(opts, w, (o) => o.text);
      m ? picks.includes(m) || picks.push(m) : missing.push(w);
    }
    if (!picks.length) return fail(`no options match "${wanted.join('; ')}" (options: ${opts.map((o) => o.text).join(' / ')})`);
    const extra = opts.filter((o) => isChecked(o.el) && !picks.includes(o));
    if (picks.every((p) => isChecked(p.el)) && !extra.length) return ok('already set');
    if (extra.length && !ctx.settings.overwrite) return skip(`already answered "${extra[0].text}"`);
    for (const o of extra) await clickChoice(o.el, false);
    const failed = [];
    for (const p of picks) if (!isChecked(p.el) && !(await clickChoice(p.el, true))) failed.push(p.text);
    if (failed.length) return fail(`could not check: ${failed.join(', ')}`);
    const picked = picks.map((p) => p.text).join('; ');
    return missing.length ? skip(`checked ${picked}; no option for: ${missing.join(', ')}`) : ok(picked);
  }

  async function fillChoice(t, value, ctx) {
    const opts = choiceOptions(t.control);
    if (!opts.length) return fail('no options found');
    const isCheckboxGroup = opts.some((o) => o.el.matches('input[type="checkbox"], [role="checkbox"]'));
    if (isCheckboxGroup && typeof value === 'string' && value.includes(';')) {
      return fillChoiceMulti(opts, value.split(';').map((s) => s.trim()).filter(Boolean), ctx);
    }
    const want = WDA.bestMatch(opts, value, (o) => o.text);
    if (!want) return fail(`no option matches "${show(value)}" (options: ${opts.map((o) => o.text).join(' / ')})`);
    if (isChecked(want.el)) return ok('already set');

    const current = opts.filter((o) => isChecked(o.el));
    if (current.length && !ctx.settings.overwrite) return skip(`already answered "${current[0].text}"`);
    for (const c of current) {
      if (c.el.matches('input[type="checkbox"], [role="checkbox"]')) await clickChoice(c.el, false);
    }
    const done = await clickChoice(want.el, true);
    const verified =
      done || choiceOptions(t.control).some((o) => o.text === want.text && isChecked(o.el));
    return verified ? ok(want.text) : fail(`clicked "${want.text}" but it did not register`);
  }

  async function fillCheckbox(t, value, ctx) {
    const el = t.control;
    const want = WDA.isYes(value);
    if (isChecked(el) === want) return ok('already set');
    if (isChecked(el) && !want && !ctx.settings.overwrite) return skip('already checked');
    return (await clickChoice(el, want)) ? ok(want ? 'checked' : 'unchecked') : fail('checkbox click did not register');
  }

  /* =========================================================================
   * Dates (split month/day/year inputs or one text input)
   * ======================================================================= */

  const pad2 = (n) => String(n).padStart(2, '0');
  const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
  const sameNum = (a, b) => String(a ?? '').trim() !== '' && Number(a) === Number(b);

  WDA.parseDate = (v) => {
    if (v && typeof v === 'object') return { month: num(v.month), day: num(v.day), year: num(v.year) };
    const s = String(v ?? '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null };
    if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) return { month: +m[1], year: +m[2], day: null };
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { month: +m[1], day: +m[2], year: +m[3] };
    if ((m = s.match(/^(\d{4})$/))) return { year: +m[1], month: null, day: null };
    return null;
  };

  async function setDatePart(el, val) {
    try {
      WDA.safeClick(el);
    } catch (_) {
      /* focus below is enough */
    }
    WDA.focusEl(el);
    WDA.setNativeValue(el, val);
    if (!sameNum(el.value, val)) WDA.typeText(el, val);
    WDA.blurEl(el);
  }

  async function fillDate(t, value, ctx) {
    const d = WDA.parseDate(value);
    if (!d || (!d.year && !d.month)) return skip('no date in profile');
    const C = S().controls;
    const root = t.control;
    const parts = [
      ['month', root.querySelector(C.dateMonth)],
      ['day', root.querySelector(C.dateDay)],
      ['year', root.querySelector(C.dateYear)],
    ].filter(([, el]) => el);

    if (parts.length) {
      const want = { month: d.month && pad2(d.month), day: d.day && pad2(d.day), year: d.year && String(d.year) };
      if (parts.every(([k, el]) => !want[k] || sameNum(el.value, want[k]))) return ok('already set');
      const hasAny = parts.some(([, el]) => (el.value || '').trim() && !/^(mm|dd|yyyy)$/i.test(el.value));
      if (hasAny && !ctx.settings.overwrite) return skip('has existing date');

      const missing = [];
      for (const [k, el] of parts) {
        if (!want[k]) {
          missing.push(k);
          continue;
        }
        await setDatePart(el, want[k]);
        await WDA.sleep(80);
      }
      const bad = parts.filter(([k, el]) => want[k] && !sameNum(el.value, want[k])).map(([k]) => k);
      if (bad.length) return fail(`date ${bad.join('/')} didn't stick`);
      return missing.length ? skip(`no ${missing.join('/')} in profile`) : ok();
    }

    // Single input: build the string from its placeholder (default MM/YYYY)
    const input = root.matches('input') ? root : root.querySelector('input:not([type="hidden"])');
    if (!input) return fail('no date input found');
    const fmt = (input.getAttribute('placeholder') || 'MM/YYYY').toUpperCase();
    const str = fmt
      .replace('YYYY', d.year ? String(d.year) : '')
      .replace('MM', d.month ? pad2(d.month) : '')
      .replace('DD', d.day ? pad2(d.day) : '');
    return fillText({ ...t, control: input, kind: 'text' }, str, ctx);
  }

  /* =========================================================================
   * File upload (resume)
   * ======================================================================= */

  WDA.base64ToFile = (r) => {
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], r.name || 'resume.pdf', { type: r.type || 'application/pdf', lastModified: Date.now() });
  };

  async function fillFile(t, resume, ctx) {
    if (!resume || !resume.data) return skip('no resume saved in profile');
    const input = t.control;
    const area =
      input.closest('[data-automation-id^="formField-"], [data-automation-id*="ttachment"], [data-automation-id*="esume"], section') ||
      input.parentElement?.parentElement?.parentElement ||
      document.body;
    const areaHasName = () => (area.innerText || '').includes(resume.name);

    if (areaHasName()) return ok('already uploaded');
    if (area.querySelector(S().upload.uploaded) && !ctx.settings.overwrite) return skip('a file is already uploaded');

    const dt = new DataTransfer();
    dt.items.add(WDA.base64ToFile(resume));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // other sites may never show the file name, so don't wait as long there
    const timeout = WDA.site === 'generic' ? 5000 : 15000;
    const done = await WDA.waitFor(() => areaHasName() || document.querySelector(S().upload.success), { timeout });
    return done ? ok(resume.name) : skip('file attached but upload not confirmed — check the page');
  }
})();
