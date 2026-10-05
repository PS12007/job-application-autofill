/**
 * main.js — entry point: fills the detected step (and, with the opt-in Auto-advance
 * toggle, clicks Next and keeps going until Review / a problem) and answers popup
 * messages. Submit is never clicked: the only navigation click lives in autoAdvance.js.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  if (WDA.mainLoaded) return; // guard against double injection
  WDA.mainLoaded = true;

  const MAX_STEPS = 12;
  let running = false;
  let lastResult = null;

  /** Fill whatever step is on screen. Returns { step, ctx }. */
  async function fillCurrentStep(profile, settings) {
    WDA.clearMarks();
    const step = WDA.detectStep();
    WDA.log(`fill started: ${step.label} (${step.source})`, { overwrite: settings.overwrite, autoAdvance: settings.autoAdvance });
    const ctx = WDA.createContext(profile, settings);
    const filler = WDA.fillers[step.key] || WDA.fillers.unknown;
    try {
      await WDA.withTimeout(filler(ctx), settings.totalTimeoutMs, 'Whole-page timeout hit; partial results kept.');
    } catch (e) {
      ctx.note = e.message || String(e);
    }
    WDA.closePopups();
    return { step, ctx };
  }

  async function runFill() {
    if (running) return { error: 'A fill is already running on this page.' };
    running = true;
    const started = Date.now();
    try {
      const [profile, settings] = await Promise.all([WDA.storage.getProfile(), WDA.storage.getSettings()]);
      WDA.settings = settings;
      const total = { filled: 0, skipped: 0, failed: 0, details: [] };
      const labels = [];
      let note = '';
      if (!profile.personal.firstName && !profile.personal.email) note = 'Your profile looks empty: open Profile settings first.';

      for (let i = 0; i < MAX_STEPS; i++) {
        const { step, ctx } = await fillCurrentStep(profile, settings);
        labels.push(step.label);

        // Decide whether to continue BEFORE summarising (the blocker may add red marks).
        const blocker = settings.autoAdvance ? WDA.advanceBlocker(step, ctx) : null;
        const s = ctx.summary();
        total.filled += s.filled;
        total.skipped += s.skipped;
        total.failed += s.failed;
        const prefix = settings.autoAdvance ? `${step.label}: ` : '';
        total.details.push(...s.details.map((d) => ({ ...d, field: prefix + d.field })));
        note = ctx.note || note;

        if (!settings.autoAdvance) break;
        if (blocker) {
          note = blocker;
          break;
        }
        const adv = await WDA.clickNextAndWait(step);
        if (!adv.ok) {
          note = adv.reason;
          break;
        }
        if (i === MAX_STEPS - 1) note = `Stopped after ${MAX_STEPS} steps.`;
      }

      const step = labels.length > 1 ? labels.join(' → ') : labels[0];
      lastResult = { step, ...total, note, ms: Date.now() - started };
    } catch (e) {
      lastResult = { error: e.message || String(e) };
    } finally {
      running = false;
    }
    WDA.log('fill finished', lastResult);
    return lastResult;
  }
  WDA.runFill = runFill;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.type) {
      case 'WDA_PING':
        sendResponse({ ok: true, step: WDA.detectStep(), running, last: lastResult });
        return false;
      case 'WDA_FILL':
        runFill().then(sendResponse);
        return true; // async response
      case 'WDA_DUMP':
        try {
          sendResponse({ ok: true, ...WDA.dumpFields() });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return false;
      default:
        return false;
    }
  });

  WDA.storage.getSettings().then((s) => (WDA.settings = s));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) WDA.settings = { ...WDA.defaultSettings(), ...(changes.settings.newValue || {}) };
  });

  WDA.initFloatingButton();
})();
