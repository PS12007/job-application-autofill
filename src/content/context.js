/**
 * context.js — one "fill run": holds the profile/settings, fills fields one at a time
 * with a per-field timeout, records results and highlights them.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  function isEmptyValue(v) {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') {
      if ('data' in v) return !v.data; // resume
      if ('year' in v || 'month' in v) return !v.year && !v.month; // date
    }
    return false;
  }

  WDA.createContext = (profile, settings) => {
    const tally = { filled: 0, skipped: 0, failed: 0 };
    const details = [];
    const handled = new Set();

    const ctx = {
      profile,
      settings,
      handled,
      note: '',

      /** Record a result for a target (or for no element, e.g. "could not add a block"). */
      record(name, target, res) {
        tally[res.status] = (tally[res.status] || 0) + 1;
        details.push({ field: name, status: res.status, reason: res.reason || '' });
        if (target) WDA.mark(target.container || target.el, res.status, `${name}: ${res.reason || res.status}`);
        const line = `${res.status.toUpperCase()} ${name}${res.reason ? ' — ' + res.reason : ''}`;
        if (res.status === 'failed') WDA.warn(line, target || '');
        else WDA.log(line, target ? target.control : '');
      },

      /** Find a field by spec and fill it. scope may be an element or a function returning one. */
      async fill(name, spec, value, scope = document, opts = {}) {
        const root = typeof scope === 'function' ? scope() : scope;
        const target = root ? WDA.resolve(spec, root) : null;
        if (!target) {
          WDA.log(`not on page: ${name}`);
          return null;
        }
        if (handled.has(target.container)) {
          WDA.log(`${name}: field already handled in this run, skipping`, target.container);
          return null;
        }
        return ctx.fillTarget(name, target, value, opts);
      },

      /** Fill an already-located target. */
      async fillTarget(name, target, value, opts = {}) {
        handled.add(target.container);
        if (isEmptyValue(value)) {
          const res = { status: 'skipped', reason: 'no data in profile' };
          ctx.record(name, target, res);
          return res;
        }
        WDA.log(`filling ${name} [${target.kind}, found by ${target.via || 'container'}] with`, value);
        let res;
        try {
          res = await WDA.withTimeout(
            WDA.fillTarget(target, value, ctx, opts),
            settings.fieldTimeout,
            `timed out after ${Math.round(settings.fieldTimeout / 1000)}s`
          );
        } catch (e) {
          res = { status: 'failed', reason: e.message || String(e) };
          WDA.closePopups();
        }
        if (opts.source) res = { ...res, reason: [res.reason, `from ${opts.source}`].filter(Boolean).join(' · ') };
        ctx.record(name, target, res);
        await WDA.sleep(settings.fieldDelay);
        return res;
      },

      summary() {
        return { ...tally, details };
      },
    };
    return ctx;
  };
})();
