/**
 * main.js — entry point: runs a fill for the detected step and answers popup messages.
 * The extension never clicks Next / Save and Continue / Submit (see WDA.assertClickable).
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  if (WDA.mainLoaded) return; // guard against double injection
  WDA.mainLoaded = true;

  let running = false;
  let lastResult = null;

  async function runFill() {
    if (running) return { error: 'A fill is already running on this page.' };
    running = true;
    const started = Date.now();
    try {
      const [profile, settings] = await Promise.all([WDA.storage.getProfile(), WDA.storage.getSettings()]);
      WDA.settings = settings;
      WDA.clearMarks();

      const step = WDA.detectStep();
      WDA.log(`fill started: ${step.label} (${step.source})`, { overwrite: settings.overwrite });

      const ctx = WDA.createContext(profile, settings);
      if (!profile.personal.firstName && !profile.personal.email) {
        ctx.note = 'Your profile looks empty — open Profile settings first.';
      }
      const filler = WDA.fillers[step.key] || WDA.fillers.unknown;
      try {
        await WDA.withTimeout(filler(ctx), settings.totalTimeout, 'Whole-page timeout hit; partial results kept.');
      } catch (e) {
        ctx.note = e.message || String(e);
      }
      WDA.closePopups();

      lastResult = { step: step.label, stepKey: step.key, ...ctx.summary(), note: ctx.note, ms: Date.now() - started };
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
