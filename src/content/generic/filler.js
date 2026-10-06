/**
 * Generic filler: any site without dedicated support. Scans the page for fields,
 * fills the ones it recognises from the profile (name, contact, address, links,
 * resume, current job, most recent education, EEO disclosures) and answers the rest
 * from saved answers. Repeatable sections only get the first entry. Never submits.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  const NAMES = {
    preferredName: 'Preferred name', firstName: 'First name', lastName: 'Last name', fullName: 'Full name',
    email: 'Email', phoneCountry: 'Phone country code', phoneExt: 'Phone extension', phone: 'Phone',
    address1: 'Address line 1', address2: 'Address line 2', city: 'City', state: 'State / province',
    postalCode: 'Postal code', country: 'Country', location: 'Location', linkedin: 'LinkedIn', github: 'GitHub',
    portfolio: 'Website', resume: 'Resume', company: 'Current company', title: 'Current title', school: 'School',
    degree: 'Degree', discipline: 'Field of study', gpa: 'GPA', gradYear: 'Graduation date',
    hispanicLatino: 'Hispanic / Latino', ethnicity: 'Race / ethnicity', gender: 'Gender', veteran: 'Veteran status',
    disability: 'Disability status',
  };
  const DISCLOSURES = ['hispanicLatino', 'ethnicity', 'gender', 'veteran', 'disability'];
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Value for a recognised field, or undefined when the profile has nothing for it. */
  function valueFor(key, t, p) {
    const P = p.personal;
    const job = p.experience.find((e) => e.current) || p.experience[0] || {};
    const edu = p.education[0] || {};
    switch (key) {
      case 'preferredName': return P.preferredName;
      case 'firstName': return P.firstName;
      case 'lastName': return P.lastName;
      case 'fullName': return [P.firstName, P.lastName].filter(Boolean).join(' ');
      case 'email': return P.email;
      case 'phoneCountry': return [P.phoneCountry, P.phoneCode].filter(Boolean).join('|');
      case 'phoneExt': return P.phoneExtension;
      case 'phone': return P.phoneNumber;
      case 'address1': return P.address1;
      case 'address2': return P.address2;
      case 'city': return P.city;
      case 'state': return P.state;
      case 'postalCode': return P.postalCode;
      case 'country': return P.country;
      case 'location': {
        const loc = [[P.city, P.state, P.country], [P.city, P.state], [P.city]].map((x) => x.filter(Boolean).join(', ')).filter(Boolean);
        return [...new Set(loc)].join('|');
      }
      case 'linkedin': return p.links.linkedin;
      case 'github': return p.links.github;
      case 'portfolio': return p.links.portfolio;
      case 'resume': return p.resume;
      case 'company': return job.company;
      case 'title': return job.title;
      case 'school': return edu.school;
      case 'degree': return edu.degree;
      case 'discipline': return edu.fieldOfStudy;
      case 'gpa': return edu.gpa;
      case 'gradYear': {
        if (!edu.endYear) return '';
        const mm = pad2(edu.endMonth || 1);
        if (t.el.matches('input[type="month"]')) return `${edu.endYear}-${mm}`;
        if (t.el.matches('input[type="date"]')) return `${edu.endYear}-${mm}-01`;
        return String(edu.endYear);
      }
      default: return undefined;
    }
  }

  /** Free-text autocompletes (no react-select): if no suggestion matched, keep the typed text. */
  async function fillWithFallback(ctx, name, t, value, opts) {
    const res = await ctx.fillTarget(name, t, value, opts);
    if (res && res.status === 'failed' && t.kind === 'combobox' && typeof value === 'string' && !t.container.querySelector('[class*="select__control"]')) {
      const typed = await WDA.fillTarget({ ...t, kind: 'text' }, value, ctx);
      if (typed.status === 'filled') {
        WDA.pressKey(t.control, 'Escape');
        ctx.record(name, t, { status: 'skipped', reason: 'typed as free text (no suggestion matched): check it' }, { replace: true });
      }
    }
    return res;
  }

  async function fillField(ctx, t, state) {
    const p = ctx.profile;
    const key = WDA.genericKey(t);
    const name = key && NAMES[key] ? NAMES[key] : WDA.shortLabel(t.label || key || t.kind);

    if (key === 'skip' || key === 'coverLetter') return;

    if (t.kind === 'file') {
      // the first file input that isn't clearly something else gets the resume
      if (key === 'resume' || (!state.resumeDone && !WDA.GEN.notResume.test(t.label || ''))) {
        state.resumeDone = true;
        await ctx.fillTarget('Resume', t, p.resume);
      }
      return;
    }

    if (DISCLOSURES.includes(key)) {
      const d = p.disclosures[key];
      if (d && d.mode === 'blank') return ctx.handled.add(t.container);
      const value = !d || d.mode === 'decline' ? '__decline__' : d.answer;
      const res = await ctx.fillTarget(name, t, value);
      if (key === 'hispanicLatino' && res && res.status === 'filled') await WDA.waitForSettle(300, 1500);
      return;
    }

    if (key) {
      const value = valueFor(key, t, p);
      if (value !== undefined) return fillWithFallback(ctx, name, t, value);
    }

    // Not a profile field: treat it as a question
    if (!t.label) return;
    const ans = WDA.answerFor(t.label, p);
    if (ans) return fillWithFallback(ctx, name, t, ans.value, { source: ans.source });
    if (!WDA.hasValue(t)) {
      ctx.handled.add(t.container);
      ctx.record(name, t, { status: 'skipped', reason: 'no saved answer matches' });
    }
  }

  WDA.fillers.generic = async (ctx) => {
    const state = { resumeDone: false };
    const seen = new Set();
    // Two passes: answers can reveal follow-up questions (e.g. race after Hispanic/Latino)
    for (let pass = 0; pass < 2; pass++) {
      const fields = WDA.scanFields().filter((t) => !seen.has(t.el) && !ctx.handled.has(t.container));
      if (!fields.length) break;
      for (const t of fields) {
        seen.add(t.el);
        if (!t.el.isConnected || ctx.handled.has(t.container)) continue;
        await fillField(ctx, t, state);
      }
      await WDA.waitForSettle(300, 1500);
    }
    if (!seen.size) ctx.note = 'No form fields found on this page.';
    else ctx.note = ctx.note || 'Review every field, then submit yourself.';
  };
})();
