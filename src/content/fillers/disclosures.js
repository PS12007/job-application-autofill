/**
 * Voluntary Disclosures and Self Identify steps.
 * Each disclosure has a mode: "decline" (pick the "I don't wish to answer" option),
 * "blank" (leave untouched) or "answer" (use the given text).
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  const LABELS = {
    gender: 'Gender',
    hispanicLatino: 'Hispanic or Latino',
    ethnicity: 'Ethnicity / race',
    veteran: 'Veteran status',
    disability: 'Disability',
  };

  function disclosureValue(d) {
    if (!d || d.mode === 'decline') return '__decline__';
    if (d.mode === 'answer') return d.answer || '';
    return null; // blank
  }

  WDA.fillers.disclosures = async (ctx) => {
    const specs = WDA.SELECTORS.fields.disclosures;
    for (const key of Object.keys(LABELS)) {
      const value = disclosureValue(ctx.profile.disclosures[key]);
      if (value === null) {
        const t = WDA.resolve(specs[key]);
        if (t && !ctx.handled.has(t.container)) {
          ctx.handled.add(t.container);
          ctx.record(LABELS[key], t, { status: 'skipped', reason: 'left blank (your setting)' });
        }
        continue;
      }
      await ctx.fill(LABELS[key], specs[key], value);
    }
    // Anything else on the page that a saved answer covers (terms checkbox is left to you)
    await WDA.fillQuestions(ctx, { markUnmatched: false });
  };

  WDA.fillers.selfIdentify = async (ctx) => {
    const F = WDA.SELECTORS.fields;
    const P = ctx.profile.personal;
    const now = new Date();
    await ctx.fill('Name', F.selfIdName, [P.firstName, P.lastName].filter(Boolean).join(' '));
    await ctx.fill('Date', F.selfIdDate, { month: now.getMonth() + 1, day: now.getDate(), year: now.getFullYear() });
    const value = disclosureValue(ctx.profile.disclosures.disability);
    if (value === null) {
      const t = WDA.resolve(F.selfIdDisability);
      if (t) ctx.record('Disability status', t, { status: 'skipped', reason: 'left blank (your setting)' });
    } else {
      await ctx.fill('Disability status', F.selfIdDisability, value);
    }
  };
})();
