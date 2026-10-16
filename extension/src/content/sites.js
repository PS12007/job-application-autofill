/**
 * sites.js — which job site this page is: Workday, Greenhouse, or anything else
 * ("generic", handled by src/content/generic/). On Greenhouse the field-wrapper
 * selector is swapped for Greenhouse's, so field lookup, question scanning and
 * highlighting all work unchanged.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  const WORKDAY = /(^|\.)(myworkdayjobs|myworkday|myworkdaysite)\.com$/i;
  WDA.site = WDA.GH.host.test(location.hostname) ? 'greenhouse' : WORKDAY.test(location.hostname) ? 'workday' : 'generic';

  if (WDA.site === 'greenhouse') {
    WDA.SELECTORS.containers = { ...WDA.SELECTORS.containers, ...WDA.GH.containers };
  }
})();
