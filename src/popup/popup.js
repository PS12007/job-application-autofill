/**
 * popup.js — Fill / Dump / Settings buttons, the two toggles and the result status.
 */
(() => {
  const WDA = globalThis.WDA;
  const $ = (id) => document.getElementById(id);
  const WORKDAY_URL = /^https:\/\/([^/]+\.)?(myworkdayjobs|myworkday|myworkdaysite)\.com\//i;

  let tabId = null;

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

  /** Make sure the content scripts are running in the tab (inject if the tab predates install). */
  async function ensureContent() {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'WDA_PING' });
      if (r && r.ok) return r;
    } catch (_) {
      /* not injected yet */
    }
    const cs = chrome.runtime.getManifest().content_scripts[0];
    await chrome.scripting.insertCSS({ target: { tabId }, files: cs.css });
    await chrome.scripting.executeScript({ target: { tabId }, files: cs.js });
    return chrome.tabs.sendMessage(tabId, { type: 'WDA_PING' });
  }

  async function init() {
    const settings = await WDA.storage.getSettings();
    $('overwrite').checked = settings.overwrite;
    $('debug').checked = settings.debug;
    $('autoAdvance').checked = settings.autoAdvance;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !WORKDAY_URL.test(tab.url || '')) {
      setStatus('Open a Workday application page to use this.');
      return;
    }
    tabId = tab.id;
    try {
      const r = await ensureContent();
      $('step').textContent = r.step ? r.step.label : '—';
      $('fill').disabled = false;
      $('dump').disabled = false;
      if (r.running) setStatus('A fill is running on this page…');
      else if (r.last) showResult(r.last);
      else setStatus('Ready.');
    } catch (e) {
      setStatus(`<span class="err">Could not reach the page: ${esc(e.message)}. Try reloading the tab.</span>`);
    }
  }

  $('fill').addEventListener('click', async () => {
    $('fill').disabled = true;
    $('details').innerHTML = '';
    setStatus('Filling… (you can close this popup; the fill keeps running)');
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'WDA_FILL' });
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
      const r = await chrome.tabs.sendMessage(tabId, { type: 'WDA_DUMP' });
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
