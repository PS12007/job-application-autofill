/**
 * bridge.js — lets the Python runner (../runner) drive the extension.
 *
 * The runner writes a command into chrome.storage.local under "runnerCmd_<id>" (from the
 * extension's own runner tab), then dispatches a "wda-runner" event on the page's
 * document whose detail is just {"id": "<id>"}. This script picks the command up, deletes
 * it, runs it, and writes the reply into the data-wda-runner attribute on <html>.
 * Pages can't write extension storage, so a website can't trigger a fill or a dump.
 *
 * Commands: ping (site, step, form score), fill (runFill with overrides), dump.
 */
(() => {
  const WDA = globalThis.WDA;
  if (!WDA || !WDA.mainLoaded || WDA.bridgeLoaded) return;
  WDA.bridgeLoaded = true;

  const root = document.documentElement;
  const reply = (id, data) => root.setAttribute('data-wda-runner', JSON.stringify({ id, ...data }));

  const score = () => {
    try {
      return WDA.site === 'generic' ? WDA.formScore() : 1000 + WDA.formScore();
    } catch (_) {
      return 0;
    }
  };

  document.addEventListener('wda-runner', async (e) => {
    let id;
    try {
      id = JSON.parse(e.detail).id;
    } catch (_) {
      return;
    }
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return;
    const key = `runnerCmd_${id}`;
    const msg = (await chrome.storage.local.get(key))[key];
    if (!msg) return; // not from the runner
    await chrome.storage.local.remove(key);

    try {
      if (msg.cmd === 'ping') {
        const app = WDA.site !== 'generic' || WDA.looksLikeApplication();
        reply(id, { done: true, site: WDA.site, step: WDA.detectStep(), score: score(), app });
      } else if (msg.cmd === 'dump') {
        reply(id, { done: true, ...WDA.dumpFields() });
      } else if (msg.cmd === 'fill') {
        reply(id, { done: false });
        const result = await WDA.runFill(msg.overrides || {});
        reply(id, { done: true, result });
      } else {
        reply(id, { done: true, error: `unknown command ${msg.cmd}` });
      }
    } catch (err) {
      reply(id, { done: true, error: err.message || String(err) });
    }
  });

  root.setAttribute('data-wda-bridge', chrome.runtime.getManifest().version);
})();
