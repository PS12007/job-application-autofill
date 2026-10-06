/**
 * reactSelect.js — Greenhouse's searchable dropdowns (react-select).
 *
 * Strategy per search term: open the menu (ArrowDown + mousedown on the control),
 * pick from the full list if a match is already there; otherwise type the term
 * (React-safe), wait for the filtered / async results, and click the best option.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const RS = () => WDA.GH.reactSelect;
  const { ok, skip, fail } = WDA.result;

  /**
   * Values currently chosen in a react-select container. Other autocompletes (no
   * react-select control) show the chosen value in the input itself.
   */
  WDA.comboValues = (box, input) => {
    if (!box) return [];
    const vals = [...box.querySelectorAll(RS().value)].map((e) => WDA.clean(e.innerText)).filter(Boolean);
    if (!vals.length && input && !box.querySelector(RS().control) && (input.value || '').trim()) vals.push(input.value.trim());
    return vals;
  };

  function menuOptions(input) {
    const id = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const owned = id && document.getElementById(id);
    const scope = owned || document;
    return [...scope.querySelectorAll(RS().option)].filter(
      (o) => WDA.isVisible(o) && !o.closest(WDA.SELECTORS.listbox.exclude) && !o.matches('[aria-disabled="true"]')
    );
  }

  const noOptionsShown = () =>
    [...document.querySelectorAll(RS().menu)].some((m) => WDA.isVisible(m) && RS().noOptions.test(m.innerText || '') && !m.querySelector('[role="option"]'));

  function openMenu(input, box) {
    WDA.focusEl(input);
    WDA.pressKey(input, 'ArrowDown');
    const control = box.querySelector(RS().control);
    if (control && !menuOptions(input).length) {
      try {
        WDA.safeMouse(control);
      } catch (_) {
        /* guarded click refused — typing still works */
      }
    }
  }

  async function clickOption(opt, input, box) {
    const label = WDA.clean(opt.innerText);
    const chosen = () => WDA.comboValues(box, input).some((v) => WDA.norm(v).includes(WDA.norm(label)) || WDA.norm(label).includes(WDA.norm(v)));
    WDA.safeClick(opt);
    if (await WDA.waitFor(chosen, { timeout: 1500 })) return label;
    if (opt.isConnected) {
      WDA.safeMouse(opt);
      if (await WDA.waitFor(chosen, { timeout: 1500 })) return label;
    }
    // Some single-line autocompletes (e.g. location) just write the text into the input
    if (WDA.norm(input.value).includes(WDA.norm(label))) return label;
    return null;
  }

  /** One attempt with a search term. Returns the selected label or null. */
  async function tryTerm(input, box, term, pick) {
    openMenu(input, box);
    const full = await WDA.waitFor(() => (menuOptions(input).length ? menuOptions(input) : null), { timeout: 1200 });
    if (full) {
      const hit = pick(full);
      if (hit) return clickOption(hit, input, box);
    }
    // Type to filter / trigger async search
    WDA.focusEl(input);
    WDA.setNativeValue(input, term);
    const started = Date.now();
    let noneSince = 0;
    const hit = await WDA.waitFor(
      () => {
        const opts = menuOptions(input);
        const m = pick(opts);
        if (m) return m;
        if (!opts.length && noOptionsShown()) {
          noneSince = noneSince || Date.now();
          if (Date.now() - noneSince > 1500 && Date.now() - started > 2500) return 'none';
        } else noneSince = 0;
        return null;
      },
      { timeout: 7000 }
    );
    if (!hit || hit === 'none') {
      WDA.log(`combobox: no usable option for "${term}"`, menuOptions(input).map((o) => WDA.clean(o.innerText)).slice(0, 8));
      WDA.setNativeValue(input, '');
      return null;
    }
    return clickOption(hit, input, box);
  }

  WDA.fillCombobox = async (t, value, ctx) => {
    const input = t.control;
    const box = t.container;
    const current = WDA.comboValues(box, input);
    if (current.some((c) => WDA.bestMatch([c], value))) return ok('already set');
    if (current.length && !ctx.settings.overwrite) return skip(`has value "${current[0]}"`);

    const optText = (o) => o.innerText;
    const { alts, key } = WDA.searchPlan(value);
    try {
      for (const term of alts) {
        const label = await tryTerm(input, box, term, (opts) => WDA.bestMatch(opts, term, optText, value));
        if (label) {
          const exact = alts.some((a) => WDA.norm(a) === WDA.norm(label));
          return ok(exact ? label : `closest match used: ${WDA.firstAlt(value)} → ${label}`);
        }
      }
      if (key) {
        const pick = (opts) =>
          WDA.bestMatch(opts, value, optText) ||
          opts.filter((o) => ` ${WDA.norm(o.innerText)} `.includes(` ${key} `)).sort((a, b) => a.innerText.length - b.innerText.length)[0];
        const label = await tryTerm(input, box, key, pick);
        if (label) return ok(`closest match used: ${WDA.firstAlt(value)} → ${label}`);
      }
      return fail(`no option matches "${WDA.firstAlt(value)}". Add alternatives with | (e.g. "…|Other")`);
    } finally {
      WDA.pressKey(input, 'Escape');
      WDA.blurEl(input);
    }
  };
})();
