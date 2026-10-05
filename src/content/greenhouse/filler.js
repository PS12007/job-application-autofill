/**
 * Greenhouse filler: the whole application is one page. Fills contact details,
 * location, resume, education, employment, links, EEOC disclosures, then answers
 * the remaining custom questions from saved answers. Never clicks Submit.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /** 9 → "September|Sep|09|9" so month dropdowns/inputs of any style match. */
  function monthValue(m) {
    const n = Number(m);
    if (!n || n < 1 || n > 12) return '';
    const name = MONTHS[n - 1];
    return [name, name.slice(0, 3), String(n).padStart(2, '0'), String(n)].join('|');
  }

  /** Click "+ Add another" in a section until row i exists (identified by its first field). */
  async function ensureRow(cfg, i, firstSpec) {
    if (WDA.resolve(firstSpec(i))) return true;
    const section = WDA.findSection(cfg);
    if (!section) return false;
    const before = section.querySelectorAll('input, select, textarea').length;
    const btn = [...section.querySelectorAll('button, a, [role="button"]')]
      .filter((b) => WDA.isVisible(b) && WDA.SELECTORS.addButton.text.test(WDA.clean(b.innerText)))
      .pop();
    if (!btn) return false;
    WDA.safeClick(btn);
    return !!(await WDA.waitFor(
      () => WDA.resolve(firstSpec(i)) || section.querySelectorAll('input, select, textarea').length > before,
      { timeout: 5000 }
    ));
  }

  async function fillRows(ctx, key, entries, cfg, spec, fields) {
    for (let i = 0; i < entries.length; i++) {
      const tag = `${key} ${i + 1}`;
      if (!(await ensureRow(cfg, i, spec[fields[0][0]]))) {
        if (i > 0) ctx.record(tag, null, { status: 'failed', reason: 'could not add another row' });
        break;
      }
      await WDA.waitForSettle(200, 1200);
      for (const [field, label, valueOf] of fields) {
        await ctx.fill(`${tag} · ${label}`, spec[field](i), valueOf(entries[i]));
      }
    }
  }

  WDA.fillers.greenhouse = async (ctx) => {
    const G = WDA.GH;
    const F = G.fields;
    const p = ctx.profile;
    const P = p.personal;

    await ctx.fill('First name', F.firstName, P.firstName);
    await ctx.fill('Last name', F.lastName, P.lastName);
    await ctx.fill('Preferred name', F.preferredName, P.preferredName);
    await ctx.fill('Email', F.email, P.email);
    await ctx.fill('Phone country', F.phoneCountry, [P.phoneCountry, P.phoneCode].filter(Boolean).join('|'));
    await ctx.fill('Phone', F.phone, P.phoneNumber);

    const loc = [
      [P.city, P.state, P.country],
      [P.city, P.state],
      [P.city],
    ].map((parts) => parts.filter(Boolean).join(', ')).filter(Boolean);
    await ctx.fill('Location', F.location, [...new Set(loc)].join('|'));

    await ctx.fill('Resume', F.resume, p.resume);

    // ---- Education ----
    const E = G.education;
    await fillRows(ctx, 'education', p.education, G.sections.education, E, [
      ['school', 'school', (e) => e.school],
      ['degree', 'degree', (e) => e.degree],
      ['discipline', 'discipline', (e) => e.fieldOfStudy],
      ['startMonth', 'start month', (e) => monthValue(e.startMonth)],
      ['startYear', 'start year', (e) => e.startYear],
      ['endMonth', 'end month', (e) => monthValue(e.endMonth)],
      ['endYear', 'end year', (e) => e.endYear],
    ]);

    // ---- Employment ----
    const M = G.employment;
    await fillRows(ctx, 'employment', p.experience, G.sections.employment, M, [
      ['company', 'company', (e) => e.company],
      ['title', 'title', (e) => e.title],
      ['current', 'current role', (e) => !!e.current],
      ['startMonth', 'start month', (e) => monthValue(e.startMonth)],
      ['startYear', 'start year', (e) => e.startYear],
      ['endMonth', 'end month', (e) => (e.current ? '' : monthValue(e.endMonth))],
      ['endYear', 'end year', (e) => (e.current ? '' : e.endYear)],
    ]);

    // ---- Links ----
    await ctx.fill('LinkedIn', F.linkedin, p.links.linkedin);
    await ctx.fill('GitHub', F.github, p.links.github);
    await ctx.fill('Portfolio / website', F.portfolio, p.links.portfolio);

    // ---- EEOC (voluntary) ----
    const labels = { gender: 'Gender', hispanicLatino: 'Hispanic / Latino', ethnicity: 'Race', veteran: 'Veteran status', disability: 'Disability status' };
    for (const key of Object.keys(labels)) {
      const d = p.disclosures[key];
      if (d && d.mode === 'blank') continue;
      const value = !d || d.mode === 'decline' ? '__decline__' : d.answer;
      const res = await ctx.fill(labels[key], G.disclosures[key], value);
      if (key === 'hispanicLatino' && res && res.status === 'filled') await WDA.waitForSettle(300, 1500); // race may appear
    }

    // ---- Everything else: custom questions ----
    await WDA.fillQuestions(ctx, { markUnmatched: true });
    ctx.note = ctx.note || 'Greenhouse is a single page: review everything, then click Submit yourself.';
  };
})();
