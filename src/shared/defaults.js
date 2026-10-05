/**
 * defaults.js — profile schema, blank list entries, settings defaults and
 * normalisation. Shared by the options page, the popup and the content scripts.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  const disclosure = () => ({ mode: 'decline', answer: '' }); // mode: decline | blank | answer

  WDA.defaultProfile = () => ({
    personal: {
      firstName: '',
      lastName: '',
      preferredName: '',
      email: '',
      phoneDeviceType: 'Mobile',
      phoneCountry: '', // e.g. "Canada" — used to pick the country phone code
      phoneCode: '', // e.g. "+1" — fallback if the country name doesn't match
      phoneNumber: '',
      phoneExtension: '',
      address1: '',
      address2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
    application: {
      howDidYouHear: '',
      previouslyWorkedHere: 'No',
    },
    workAuth: {
      authorizations: [], // [{ country, authorized: 'Yes'|'No', sponsorship: 'Yes'|'No' }]
      willingToRelocate: '',
    },
    education: [],
    experience: [],
    skills: [],
    languages: [],
    links: { linkedin: '', github: '', portfolio: '' },
    resume: null, // { name, type, size, data (base64) }
    disclosures: {
      gender: disclosure(),
      hispanicLatino: disclosure(),
      ethnicity: disclosure(),
      veteran: disclosure(),
      disability: disclosure(),
    },
    savedAnswers: [], // [{ keywords: 'sponsorship, visa', answer: 'No' }]
  });

  /** Factories for one blank item of each repeatable list. */
  WDA.blankEntry = {
    authorizations: () => ({ country: '', authorized: 'Yes', sponsorship: 'No' }),
    education: () => ({
      school: '', degree: '', fieldOfStudy: '', gpa: '',
      startMonth: '', startYear: '', endMonth: '', endYear: '', expected: false,
    }),
    experience: () => ({
      title: '', company: '', location: '', current: false,
      startMonth: '', startYear: '', endMonth: '', endYear: '', description: '',
    }),
    languages: () => ({ language: '', proficiency: '', fluent: false }),
    savedAnswers: () => ({ keywords: '', answer: '' }),
  };

  WDA.defaultSettings = () => ({
    overwrite: false, // overwrite fields that already have a value
    debug: false, // console logging with the [WD-Autofill] prefix
    showFloatingButton: true,
    fieldDelay: 150, // ms pause between fields so Workday can re-render
    fieldTimeoutMs: 60000, // max ms for a single field (search fields may try several names)
    totalTimeoutMs: 600000, // max ms for a whole page
  });

  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function mergeObj(def, src) {
    if (!isPlain(src)) return def;
    const out = { ...def };
    for (const k of Object.keys(src)) {
      out[k] = isPlain(def[k]) ? mergeObj(def[k], src[k]) : src[k];
    }
    return out;
  }

  const listOf = (v, make) =>
    (Array.isArray(v) ? v : []).filter(isPlain).map((x) => ({ ...make(), ...x }));

  /** Fill in missing keys so older/partial profiles (e.g. imports) are safe to use. */
  WDA.normalizeProfile = (p) => {
    const out = mergeObj(WDA.defaultProfile(), p || {});
    out.education = listOf(out.education, WDA.blankEntry.education);
    out.experience = listOf(out.experience, WDA.blankEntry.experience);
    out.languages = listOf(out.languages, WDA.blankEntry.languages);
    out.savedAnswers = listOf(out.savedAnswers, WDA.blankEntry.savedAnswers);
    out.workAuth.authorizations = listOf(out.workAuth.authorizations, WDA.blankEntry.authorizations);
    out.skills = (Array.isArray(out.skills) ? out.skills : String(out.skills || '').split(/[\n,]/))
      .map((s) => String(s).trim())
      .filter(Boolean);
    for (const k of Object.keys(out.disclosures)) {
      const d = out.disclosures[k];
      if (typeof d === 'string') out.disclosures[k] = d ? { mode: 'answer', answer: d } : disclosure();
    }
    if (!isPlain(out.resume) || !out.resume.data) out.resume = null;
    return out;
  };
})();
