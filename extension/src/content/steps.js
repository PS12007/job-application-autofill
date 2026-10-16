/**
 * steps.js — work out which application step is on screen, using the progress bar's
 * active step first and the page headings second.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.detectStep = () => {
    if (WDA.site === 'greenhouse') return { key: 'greenhouse', label: 'Greenhouse application', source: location.hostname };
    if (WDA.site === 'generic') {
      const heading = [...document.querySelectorAll('h1, h2, [role="heading"]')].filter(WDA.isVisible).map((h) => WDA.clean(h.innerText));
      const review = heading.find((h) => /^review\b|review (and submit|your application)/i.test(h));
      if (review) return { key: 'review', label: 'Review', source: `heading: "${review}"` };
      return { key: 'generic', label: 'Application form', source: location.hostname };
    }
    const S = WDA.SELECTORS;
    const sources = [];
    for (const sel of S.stepIndicators) {
      document.querySelectorAll(sel).forEach((el) => {
        if (WDA.isVisible(el)) sources.push({ from: 'progress bar', text: WDA.clean(el.innerText) });
      });
    }
    document.querySelectorAll(S.headingSelector).forEach((el) => {
      if (WDA.isVisible(el)) sources.push({ from: 'heading', text: WDA.clean(el.innerText) });
    });

    for (const src of sources) {
      if (!src.text) continue;
      for (const step of S.steps) {
        if (step.pattern.test(src.text)) return { key: step.key, label: step.label, source: `${src.from}: "${src.text}"` };
      }
    }
    return {
      key: 'unknown',
      label: 'Unknown step',
      source: sources.map((s) => s.text).filter(Boolean).slice(0, 3).join(' | ') || 'no heading found',
    };
  };
})();
