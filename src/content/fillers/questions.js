/**
 * Application Questions step: match each question's label against saved answers
 * (then a few built-in profile answers). Unmatched empty questions are marked yellow.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  /** Innermost field wrappers, plus fieldsets that aren't inside/around one. */
  WDA.questionContainers = () => {
    const fieldSel = WDA.SELECTORS.containers.field;
    const fields = [...document.querySelectorAll(fieldSel)].filter((b) => WDA.isVisible(b) && !b.querySelector(fieldSel));
    const sets = [...document.querySelectorAll('fieldset')].filter(
      (f) => WDA.isVisible(f) && !f.closest(fieldSel) && !f.querySelector(fieldSel)
    );
    return [...fields, ...sets].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  };

  function pickAuthorization(label, list) {
    if (!list.length) return null;
    const q = ` ${WDA.norm(label)} `;
    const aliases = WDA.SELECTORS.countryAliases;
    const hit = list.find((a) => {
      const c = WDA.norm(a.country);
      if (!c) return false;
      const names = [c, ...(aliases[c] || [])];
      return names.some((n) => q.includes(` ${n} `));
    });
    return hit || list[0];
  }

  /** Answer for a question label, or null. Saved answers win over built-ins. */
  WDA.answerFor = (label, profile) => {
    const sa = WDA.matchSavedAnswer(label, profile.savedAnswers);
    if (sa) return { value: sa.answer, source: `saved answer [${sa.keywords}]` };

    const Q = WDA.SELECTORS.questionPatterns;
    const wa = profile.workAuth || {};
    const auth = pickAuthorization(label, wa.authorizations || []);
    const authSrc = auth ? `work authorization (${auth.country || 'first entry'})` : '';
    const L = profile.links || {};
    const rules = [
      [Q.sponsorshipNeed, auth && auth.sponsorship, authSrc],
      [Q.authorized, auth && auth.authorized, authSrc],
      [Q.sponsorship, auth && auth.sponsorship, authSrc],
      [Q.relocate, wa.willingToRelocate, 'willing to relocate'],
      [Q.previouslyWorked, profile.application.previouslyWorkedHere, 'previously worked here'],
      [Q.howDidYouHear, profile.application.howDidYouHear, 'how did you hear'],
      [Q.linkedin, L.linkedin, 'LinkedIn'],
      [Q.github, L.github, 'GitHub'],
      [Q.portfolio, L.portfolio, 'portfolio'],
    ];
    for (const [re, value, source] of rules) {
      if (re.test(label) && value) return { value, source };
    }
    return null;
  };

  /** Generic pass over every visible question not already handled in this run. */
  WDA.fillQuestions = async (ctx, { markUnmatched = true } = {}) => {
    for (const box of WDA.questionContainers()) {
      if ([...ctx.handled].some((h) => h === box || (h.isConnected && (box.contains(h) || h.contains(box))))) continue;
      const target = WDA.buildTarget(box);
      if (target.kind === 'unknown' || target.kind === 'file' || !target.label) continue;
      const name = WDA.shortLabel(target.label);
      const ans = WDA.answerFor(target.label, ctx.profile);
      if (!ans) {
        if (markUnmatched && !WDA.hasValue(target)) {
          ctx.handled.add(box);
          ctx.record(name, target, { status: 'skipped', reason: 'no saved answer matches' });
        }
        continue;
      }
      WDA.log(`question "${name}" → ${ans.source}`);
      await ctx.fillTarget(name, target, ans.value);
    }
  };

  WDA.fillers.questions = (ctx) => WDA.fillQuestions(ctx, { markUnmatched: true });

  /** Unknown step: only answer questions we have answers for; mark nothing else. */
  WDA.fillers.unknown = async (ctx) => {
    ctx.note = 'Unknown step — only saved answers were tried.';
    await WDA.fillQuestions(ctx, { markUnmatched: false });
  };

  WDA.fillers.review = async (ctx) => {
    ctx.note = 'Review step — nothing to fill. Check everything, then submit yourself.';
  };
})();
