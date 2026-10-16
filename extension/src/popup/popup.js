/**
 * popup.js — Fill / Dump / Settings buttons, the toggles and the result status.
 */
(() => {
  const WDA = globalThis.WDA;
  const $ = (id) => document.getElementById(id);
  let tabId = null;
  let frameId = 0; // the frame holding the form (embedded forms live in iframes)
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg, { frameId });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function setStatus(html) {
    $('status').innerHTML = html;
  }

  function showResult(r) {
    $('details').innerHTML = '';
    if (!r) return;
    if (r.error) {
      setStatus(`<span class="err">${esc(r.error)}</span>`);
      return;
    }
    setStatus(
      `Filled <b>${r.filled}</b> · Skipped <b>${r.skipped}</b> · ` +
        `<span class="${r.failed ? 'err' : ''}">Failed <b>${r.failed}</b></span>` +
        (r.step && r.step.includes(' → ') ? `<div class="note">${esc(r.step)}</div>` : '') +
        (r.note ? `<div class="note">${esc(r.note)}</div>` : '')
    );
    const items = (r.details || []).filter((d) => d.status !== 'filled' || / from /.test(' ' + d.reason));
    const rank = { failed: 0, skipped: 1, filled: 2 };
    items.sort((a, b) => rank[a.status] - rank[b.status]);
    $('details').innerHTML = items
      .map((d) => `<li class="${d.status}" title="${esc(d.reason)}">${esc(d.field)} — ${esc(d.reason)}</li>`)
      .join('');
  }

  /** Score every frame (null = content scripts not loaded there). */
  async function scoreFrames() {
    const res = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const W = globalThis.WDA;
        if (!W || !W.mainLoaded) return null;
        try {
          return W.site === 'generic' ? W.formScore() : 1000 + W.formScore();
        } catch (_) {
          return 0;
        }
      },
    });
    return res.filter((r) => r && typeof r.frameId === 'number');
  }

  /**
   * Make sure the content scripts run in the tab (inject into frames that predate the
   * install), then pick the frame that looks most like an application form.
   */
  async function ensureContent() {
    let frames = await scoreFrames();
    const missing = frames.filter((f) => f.result === null).map((f) => f.frameId);
    if (missing.length) {
      const cs = chrome.runtime.getManifest().content_scripts[0];
      const target = { tabId, frameIds: missing };
      await chrome.scripting.insertCSS({ target, files: cs.css }).catch(() => {});
      await chrome.scripting.executeScript({ target, files: cs.js }).catch(() => {});
      frames = await scoreFrames();
    }
    const best = frames.filter((f) => f.result != null).sort((a, b) => b.result - a.result || a.frameId - b.frameId)[0];
    if (!best) throw new Error('no response from the page');
    frameId = best.frameId;
    return send({ type: 'WDA_PING' });
  }

  async function init() {
    const settings = await WDA.storage.getSettings();
    $('overwrite').checked = settings.overwrite;
    $('debug').checked = settings.debug;
    $('autoAdvance').checked = settings.autoAdvance;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return setStatus('No active tab.');
    tabId = tab.id;
    try {
      const r = await ensureContent();
      if (!r || !r.ok) throw new Error('no response from the page');
      $('step').textContent = r.step ? r.step.label : '—';
      $('fill').disabled = false;
      $('dump').disabled = false;
      if (r.running) setStatus('A fill is running on this page…');
      else if (r.last) showResult(r.last);
      else setStatus('Ready.');
    } catch (e) {
      setStatus(
        /^https?:/i.test(tab.url || '')
          ? `<span class="err">Could not reach the page: ${esc(e.message)}. Try reloading the tab.</span>`
          : 'This page cannot be filled. Open a job application.'
      );
    }
  }

  $('fill').addEventListener('click', async () => {
    $('fill').disabled = true;
    $('details').innerHTML = '';
    setStatus('Filling… (you can close this popup; the fill keeps running)');
    try {
      const r = await send({ type: 'WDA_FILL' });
      showResult(r);
      if (r && r.step) $('step').textContent = r.step.split(' → ').pop();
    } catch (e) {
      setStatus(`<span class="err">${esc(e.message)}</span>`);
    } finally {
      $('fill').disabled = false;
    }
  });

  $('dump').addEventListener('click', async () => {
    try {
      const r = await send({ type: 'WDA_DUMP' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'no response');
      try {
        await navigator.clipboard.writeText(r.json);
        $('dumpOut').hidden = true;
        setStatus(`Copied ${r.count} fields to the clipboard. Paste them into the chat.`);
      } catch (_) {
        $('dumpOut').value = r.json;
        $('dumpOut').hidden = false;
        $('dumpOut').select();
        setStatus('Clipboard blocked: the dump is selected below. Press Ctrl+C.');
      }
    } catch (e) {
      setStatus(`<span class="err">Dump failed: ${esc(e.message)}</span>`);
    }
  });

  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('overwrite').addEventListener('change', (e) => WDA.storage.saveSettings({ overwrite: e.target.checked }));
  $('debug').addEventListener('change', (e) => WDA.storage.saveSettings({ debug: e.target.checked }));
  $('autoAdvance').addEventListener('change', (e) => WDA.storage.saveSettings({ autoAdvance: e.target.checked }));

  init();
})();
