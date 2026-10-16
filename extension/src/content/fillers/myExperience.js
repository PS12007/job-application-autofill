/**
 * My Experience step: work experience, education, languages, websites (repeatable),
 * skills, LinkedIn and resume upload.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  WDA.fillers.myExperience = async (ctx) => {
    const S = WDA.SELECTORS;
    const F = S.fields;
    const B = S.blockFields;
    const p = ctx.profile;

    // ---- Work experience ----
    await WDA.fillRepeatable(ctx, 'experience', p.experience, async (block, e, tag) => {
      const X = B.experience;
      await ctx.fill(`${tag} · job title`, X.jobTitle, e.title, block);
      await ctx.fill(`${tag} · company`, X.company, e.company, block);
      await ctx.fill(`${tag} · location`, X.location, e.location, block);
      const cur = await ctx.fill(`${tag} · currently work here`, X.current, !!e.current, block);
      if (cur && cur.status === 'filled' && cur.reason !== 'already set') await WDA.waitForSettle(250, 1500);
      await ctx.fill(`${tag} · start date`, X.startDate, { month: e.startMonth, year: e.startYear }, block);
      if (!e.current) await ctx.fill(`${tag} · end date`, X.endDate, { month: e.endMonth, year: e.endYear }, block);
      await ctx.fill(`${tag} · description`, X.description, e.description, block);
    });

    // ---- Education ----
    await WDA.fillRepeatable(ctx, 'education', p.education, async (block, ed, tag) => {
      const X = B.education;
      await ctx.fill(`${tag} · school`, X.school, ed.school, block);
      await ctx.fill(`${tag} · degree`, X.degree, ed.degree, block);
      await ctx.fill(`${tag} · field of study`, X.fieldOfStudy, ed.fieldOfStudy, block);
      await ctx.fill(`${tag} · GPA`, X.gpa, ed.gpa, block);
      await ctx.fill(`${tag} · start`, X.startDate, { month: ed.startMonth, year: ed.startYear }, block);
      await ctx.fill(`${tag} · end`, X.endDate, { month: ed.endMonth, year: ed.endYear }, block);
    });

    // ---- Languages ----
    await WDA.fillRepeatable(ctx, 'languages', p.languages, async (block, l, tag) => {
      const X = B.languages;
      await ctx.fill(`${tag} · language`, X.language, l.language, block);
      await ctx.fill(`${tag} · fluent`, X.fluent, !!l.fluent, block);
      const root = block();
      if (!root) return;
      const boxes = [...root.querySelectorAll(S.containers.field)].filter(
        (b) => X.proficiencyLabel.test(WDA.labelFor(b)) && !ctx.handled.has(b)
      );
      for (const b of boxes) {
        const t = WDA.buildTarget(b);
        if (t.kind === 'dropdown' || t.kind === 'prompt') await ctx.fillTarget(`${tag} · ${WDA.shortLabel(t.label, 30)}`, t, l.proficiency);
      }
    });

    // ---- Skills (multiselect prompt) ----
    await ctx.fill('Skills', F.skills, p.skills, document, { multi: true });

    // ---- LinkedIn + websites ----
    const hasLinkedInField = !!WDA.resolve(F.linkedin);
    await ctx.fill('LinkedIn', F.linkedin, p.links.linkedin);
    const urls = [hasLinkedInField ? '' : p.links.linkedin, p.links.github, p.links.portfolio].filter(Boolean);
    await WDA.fillRepeatable(ctx, 'websites', urls, async (block, url, tag) => {
      await ctx.fill(`${tag} · URL`, B.websites.url, url, block);
    });

    // ---- Resume ----
    await ctx.fill('Resume', F.resume, p.resume);
  };

  /** "Autofill with Resume" step: only upload the resume (Workday parses it). */
  WDA.fillers.resume = async (ctx) => {
    await ctx.fill('Resume', WDA.SELECTORS.fields.resume, ctx.profile.resume);
  };
})();
