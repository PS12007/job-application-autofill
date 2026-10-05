/**
 * log.js — console logging gated by the "Debug logging" toggle.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const PREFIX = '%c[WD-Autofill]';
  const STYLE = 'color:#2563eb;font-weight:bold';

  WDA.settings = WDA.settings || WDA.defaultSettings();

  WDA.log = (...args) => {
    if (WDA.settings.debug) console.log(PREFIX, STYLE, ...args);
  };

  WDA.warn = (...args) => {
    if (WDA.settings.debug) console.warn(PREFIX, STYLE, ...args);
  };
})();
