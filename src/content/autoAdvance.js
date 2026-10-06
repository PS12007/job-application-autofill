/**
 * autoAdvance.js — OPT-IN "Auto-advance" mode: after a step is filled cleanly, click
 * Next / Save and Continue and wait for the next step.
 *
 * Safety rules (all enforced here, the only place that clicks a navigation button):
 *  - never on the Review step, never on an unknown step
 *  - never a button whose text matches nav.neverText (Submit)
 *  - only when nothing failed and no required field is left empty
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const N = () => WDA.SELECTORS.nav;

  /** Raw label text (keeps the "*" Workday uses to mark required fields). */
  const rawLabel = (box) => {
    const lab = box.querySelector('legend, label, [data-automation-id="formLabel"]');
    return lab ? lab.innerText || lab.textContent || '' : '';
  };

  /** Visible required questions that still have no value. */
  WDA.emptyRequired = () => {
    if (WDA.site === 'generic') return WDA.scanFields().filter((t) => t.required && !WDA.hasValue(t));
    const out = [];
    for (const box of WDA.questionContainers()) {
      const required = box.querySelector('[aria-required="true"], [required]') || rawLabel(box).includes('*');
      if (!required) continue;
      const t = WDA.buildTarget(box);
      if (t.kind === 'unknown') continue;
      if (!WDA.hasValue(t)) out.push(t);
    }
    return out;
  };

  /** Reason to stop instead of advancing, or null if it's safe to click Next. */
  WDA.advanceBlocker = (step, ctx) => {
    if (step.key === 'review') return 'Reached Review: check everything, then click Submit yourself.';
    if (step.key === 'unknown') return 'Unknown step: auto-advance stopped.';
    const failed = ctx.summary().failed;
    if (failed) return `Stopped on ${step.label}: ${failed} field(s) failed. Fix them, then press Fill again.`;
    const empty = WDA.emptyRequired();
    if (empty.length) {
      for (const t of empty) {
        ctx.record(WDA.shortLabel(t.label), t, { status: 'failed', reason: 'required, needs your input' }, { replace: true });
      }
      return `Stopped on ${step.label}: ${empty.length} required field(s) need your input. Fill them, then press Fill again.`;
    }
    if (step.key === 'greenhouse') return 'Greenhouse is a single page: review everything, then click Submit yourself.';
    return null;
  };

  function findNextButton() {
    const visible = (b) => WDA.isVisible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    for (const id of N().nextIds) {
      const b = [...document.querySelectorAll(`[data-automation-id="${id}"]`)].find(visible);
      if (b) return b.closest('button, [role="button"]') || b;
    }
    const byText = [...document.querySelectorAll('button, [role="button"]')].filter(
      (b) => visible(b) && N().nextText.test(WDA.clean(b.innerText || b.getAttribute('aria-label') || ''))
    );
    return byText.pop() || null;
  }

  const visibleErrors = () =>
    [...document.querySelectorAll(N().errors)]
      .filter((e) => WDA.isVisible(e) && WDA.clean(e.innerText))
      .map((e) => WDA.shortLabel(e.innerText, 80));

  /** Changes when Workday shows a different step/page. */
  const fingerprint = () => {
    const step = WDA.detectStep();
    const labels = (WDA.site === 'generic'
      ? WDA.scanFields().slice(0, 4).map((t) => t.label)
      : WDA.questionContainers().slice(0, 4).map((b) => WDA.labelFor(b))
    ).join('|');
    return `${location.pathname}#${step.source}#${labels}`;
  };

  /** Click Next and wait for the page to change. Returns { ok, reason }. */
  WDA.clickNextAndWait = async (step) => {
    if (step.key === 'review' || step.key === 'greenhouse') return { ok: false, reason: 'Review the page and submit yourself.' };
    const btn = findNextButton();
    if (!btn) return { ok: false, reason: `Stopped on ${step.label}: could not find the Next button.` };
    const text = WDA.clean(btn.innerText || btn.getAttribute('aria-label') || '');
    if (N().neverText.test(text)) return { ok: false, reason: `Stopped before "${text}": click it yourself.` };

    const before = fingerprint();
    const errorsBefore = visibleErrors().length;
    WDA.log(`auto-advance: clicking "${text}" on ${step.label}`);
    btn.click();

    const res = await WDA.waitFor(
      () => (fingerprint() !== before ? 'moved' : visibleErrors().length > errorsBefore ? 'errors' : null),
      { timeout: 20000, interval: 250 }
    );
    if (res === 'moved') {
      await WDA.waitForSettle(800, 6000);
      const fieldsShown = () => (WDA.site === 'generic' ? WDA.scanFields().length : WDA.questionContainers().length);
      await WDA.waitFor(() => fieldsShown() || WDA.detectStep().key === 'review', { timeout: 5000 });
      return { ok: true };
    }
    if (res === 'errors') {
      return { ok: false, reason: `The page showed errors on ${step.label}: ${visibleErrors().slice(0, 3).join('; ')}` };
    }
    return { ok: false, reason: `Clicked "${text}" on ${step.label} but the page did not change.` };
  };
})();
