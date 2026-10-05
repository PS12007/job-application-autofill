/**
 * sites.js — which job site this page is (Workday or Greenhouse). On Greenhouse the
 * generic field-wrapper selector is swapped for Greenhouse's, so field lookup,
 * question scanning and highlighting all work unchanged.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.site = WDA.GH.host.test(location.hostname) ? 'greenhouse' : 'workday';

  if (WDA.site === 'greenhouse') {
    WDA.SELECTORS.containers = { ...WDA.SELECTORS.containers, ...WDA.GH.containers };
  }
})();
