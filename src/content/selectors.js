/**
 * selectors.js — EVERY Workday-specific selector, automation id and label pattern.
 *
 * Fix selectors here without touching the fill logic. A field spec looks like:
 *   { ids: [...], labels: [/regex/], exclude: [/regex/], selectors: ['css'] }
 *
 * For each id the resolver tries, in order:
 *   [data-automation-id="formField-<id>"]   (Workday's field wrapper)
 *   [data-automation-id="<id>"]
 *   [id="<id>"]  and  [id$="--<id>"]        (newer Workday: "workExperience-3--jobTitle")
 *   [name="<id>"]
 * then the label patterns (tested against the field's visible label, "*" stripped),
 * then any raw CSS `selectors`. The first visible match wins.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.SELECTORS = {
    /** Wrapper Workday puts around each question/field. */
    containers: {
      field: '[data-automation-id^="formField-"]',
    },

    /** How each control type is recognised inside a field wrapper. */
    controls: {
      dropdownButton: 'button[aria-haspopup="listbox"]',
      promptInput: [
        'input[data-uxi-widget-type="selectinput"]',
        'input[data-automation-id="searchBox"]',
        '[data-automation-id="multiselectInputContainer"] input',
        'input[role="combobox"]',
      ].join(', '),
      dateMonth: 'input[data-automation-id="dateSectionMonth-input"]',
      dateDay: 'input[data-automation-id="dateSectionDay-input"]',
      dateYear: 'input[data-automation-id="dateSectionYear-input"]',
      dateAny: 'input[data-automation-id^="dateSection"]',
      fileInput: 'input[type="file"]',
    },

    /** Button-dropdown popup (renders at the end of <body>). */
    listbox: {
      root: '[role="listbox"]',
      option: '[role="option"]',
      /** Chosen-value pills are also role=listbox — never treat them as a dropdown's list. */
      exclude: '[data-automation-id="selectedItemList"], [data-automation-id="selectedItem"]',
    },

    /** Searchable / multiselect "prompt" widgets. */
    prompt: {
      option: '[data-automation-id="promptOption"]',
      fallbackOption:
        '[data-automation-id="activeListContainer"] [role="option"], [role="listbox"] [role="option"]',
      popup: '[data-automation-id="activeListContainer"], [role="listbox"]',
      selectedItem:
        '[data-automation-id="selectedItem"], [data-automation-id="promptSelectionLabel"], [data-automation-id="selectedItemList"] [role="option"]',
      deletePill: '[data-automation-id="DELETE_charm"]',
      noItems: /no items|no results|no matches/i,
    },

    /** Resume upload confirmation. */
    upload: {
      uploaded:
        '[data-automation-id="file-upload-successful"], [data-automation-id="file-upload-item"], [data-automation-id="file-upload-item-name"]',
      success: '[data-automation-id="file-upload-successful"]',
    },

    /** Dropdown button text that means "nothing chosen yet". */
    placeholder: /^(select one|select\.{0,3}|choose one|choose\.{0,3}|please select|-+|)$/i,

    /** Option text that means "decline to answer" (voluntary disclosures). */
    declinePatterns: [
      /not\s+(wish|want|like)\s+to\s+(answer|disclose|self[\s-]?identify|provide|specify|say|respond)/i,
      /\bdecline/i,
      /prefer\s+not/i,
      /choose\s+not/i,
      /rather\s+not/i,
      /not\s+(to\s+)?(disclose|declare|specified|answer)/i,
      /don'?t\s+wish/i,
    ],

    /**
     * SAFETY: the extension must never navigate or submit. Every click goes through
     * WDA.assertClickable(), which refuses anything matching these.
     */
    nav: {
      blockedIds: [
        'pageFooterNextButton',
        'pageFooterBackButton',
        'bottom-navigation-next-button',
        'bottom-navigation-previous-button',
        'bottom-navigation-save-continue',
        'bottom-navigation-footer-button',
        'wd-CommandButton_next',
        'createAccountSubmitButton',
        'createAccountLink',
        'signInSubmitButton',
        'signInLink',
        'utilityButtonSignIn',
        'applyManually',
        'autofillWithResume',
        'useMyLastApplication',
        'adventureButton',
      ],
      blockedText:
        /^(next|back|submit|submit application|save and continue|save & continue|continue|apply|apply now|apply manually|sign in|create account|review|finish)$/i,
      blockedZones: '[data-automation-id="pageFooter"], [data-automation-id="bottom-navigation"]',

      // ---- Auto-advance only (opt-in toggle). Used by autoAdvance.js, nowhere else. ----
      nextIds: ['bottom-navigation-next-button', 'pageFooterNextButton', 'bottom-navigation-save-continue', 'wd-CommandButton_next'],
      nextText: /^(next|save and continue|save & continue|continue)$/i,
      /** Auto-advance never clicks a button whose text matches this. */
      neverText: /submit/i,
      /** Workday validation messages shown after clicking Next. */
      errors: '[data-automation-id="errorMessage"], [data-automation-id="inputAlert"], [data-automation-id="errorBanner"], [role="alert"]',
    },

    /** "Add" / "Add Another" buttons in repeatable sections. */
    addButton: {
      ids: ['Add', 'add-button', 'addButton', 'Add Another'],
      text: /^add( another)?$/i,
      ariaText: /^add\b/i,
    },

    /** Step detection: checked against the progress bar first, then page headings. */
    stepIndicators: ['[data-automation-id="progressBarActiveStep"]', '[aria-current="step"]'],
    headingSelector: 'h1, h2',
    steps: [
      { key: 'selfIdentify', label: 'Self Identify', pattern: /self[\s-]?identif/i },
      { key: 'disclosures', label: 'Voluntary Disclosures', pattern: /voluntary\s+disclosure/i },
      {
        key: 'questions',
        label: 'Application Questions',
        pattern: /application\s+questions?|additional\s+questions|questionnaire|screening\s+questions/i,
      },
      { key: 'resume', label: 'Autofill with Resume', pattern: /autofill\s+with\s+resume|upload\s+(your\s+)?resume/i },
      { key: 'myExperience', label: 'My Experience', pattern: /my\s+experience|\bexperience\b/i },
      {
        key: 'myInformation',
        label: 'My Information',
        pattern: /my\s+information|personal\s+information|contact\s+information/i,
      },
      { key: 'review', label: 'Review', pattern: /\breview\b/i },
    ],

    /** Single (non-repeating) fields. */
    fields: {
      // ---- My Information ----
      country: {
        ids: ['countryDropdown', 'country--country', 'addressSection_country'],
        labels: [/^country(\s*\/\s*(territory|region))?$/i],
      },
      source: {
        ids: ['source', 'sourcePrompt', 'source--source'],
        labels: [/how did you hear/i],
      },
      previousWorker: {
        ids: ['candidateIsPreviousWorker', 'previousWorker'],
        labels: [/previously (worked|been employed)|former (employee|worker)|worked (here|for us) before/i],
      },
      firstName: {
        ids: ['legalNameSection_firstName', 'name--legalName--firstName', 'legalName--firstName'],
        labels: [/^(legal )?(first|given) name/i],
      },
      lastName: {
        ids: ['legalNameSection_lastName', 'name--legalName--lastName', 'legalName--lastName'],
        labels: [/^(legal )?(last|family) name|^surname/i],
      },
      preferredNameCheckbox: {
        ids: ['preferredNameCheckbox', 'name--preferredCheck', 'preferredCheck'],
        labels: [/i have a preferred name/i],
      },
      preferredFirstName: {
        // ids only: its label ("First Name") would collide with the legal first name
        ids: ['preferredNameSection_firstName', 'name--preferredName--firstName', 'preferredName--firstName'],
      },
      address1: {
        ids: ['addressSection_addressLine1', 'address--addressLine1', 'addressLine1'],
        labels: [/^address line 1|^street/i],
      },
      address2: {
        ids: ['addressSection_addressLine2', 'address--addressLine2', 'addressLine2'],
        labels: [/^address line 2/i],
      },
      city: {
        ids: ['addressSection_city', 'address--city', 'city'],
        labels: [/^(city|town|municipality)/i],
      },
      state: {
        ids: ['addressSection_countryRegion', 'address--countryRegion', 'countryRegion'],
        labels: [/^(state|province|region|county|prefecture|territory)/i],
      },
      postalCode: {
        ids: ['addressSection_postalCode', 'address--postalCode', 'postalCode'],
        labels: [/^(postal|zip|post) ?code/i],
      },
      email: {
        ids: ['email', 'emailAddress--emailAddress', 'emailAddress'],
        labels: [/^e-?mail/i],
      },
      phoneDeviceType: {
        ids: ['phone-device-type', 'phoneNumber--phoneType', 'phoneType'],
        labels: [/phone device type|phone type/i],
      },
      phoneCode: {
        ids: ['country-phone-code', 'phoneNumber--countryPhoneCode', 'countryPhoneCode'],
        labels: [/country phone code|phone code/i],
      },
      phoneNumber: {
        ids: ['phone-number', 'phoneNumber--phoneNumber'],
        labels: [/^phone number/i],
      },
      phoneExtension: {
        ids: ['phone-extension', 'phoneNumber--extension'],
        labels: [/^(phone )?extension/i],
      },

      // ---- My Experience (non-repeating) ----
      linkedin: {
        ids: ['linkedinQuestion', 'linkedInAccount', 'socialNetworkAccounts--linkedInAccount'],
        labels: [/linkedin/i],
      },
      skills: {
        ids: ['skills', 'skills--skills'],
        labels: [/^(type to add )?skills/i],
      },
      resume: {
        ids: ['file-upload-input-ref', 'resumeAttachments--attachments', 'attachments'],
        labels: [/resume|\bcv\b/i],
        selectors: ['input[type="file"]'],
      },

      // ---- Voluntary Disclosures ----
      disclosures: {
        gender: {
          ids: ['gender', 'personalInfoUS--gender', 'personalInfoPerson--gender'],
          labels: [/^gender|^sex\b/i],
        },
        hispanicLatino: {
          ids: ['hispanicOrLatino', 'personalInfoUS--hispanicOrLatino'],
          labels: [/hispanic or latino/i],
        },
        ethnicity: {
          ids: ['ethnicityDropdown', 'ethnicity', 'personalInfoUS--ethnicity', 'ethnicityMulti'],
          labels: [/\bethnicity\b|\brace\b/i],
        },
        veteran: {
          ids: ['veteranStatus', 'personalInfoUS--veteranStatus'],
          labels: [/veteran/i],
        },
        disability: {
          ids: ['disability', 'disabilityStatus'],
          labels: [/disabilit/i],
        },
      },

      // ---- Self Identify (disability form) ----
      selfIdName: {
        ids: ['selfIdentifiedDisabilityData--name', 'name'],
        labels: [/^(your )?name$/i],
      },
      selfIdDate: {
        ids: ['selfIdentifiedDisabilityData--dateSignedOn', 'dateSignedOn', 'todaysDate'],
        labels: [/^date$|today'?s date|date signed/i],
      },
      selfIdDisability: {
        ids: ['selfIdentifiedDisabilityData--disabilityStatus', 'disabilityStatus'],
        labels: [/disability status|please check one|do you have a disability/i],
      },
    },

    /** Repeatable sections on My Experience. */
    sections: {
      experience: {
        ids: ['workExperienceSection'],
        heading: /^work experience$/i,
        blockIdPattern: /^workExperience-\d+$/,
        blockHeading: /^work experience \d+$/i,
      },
      education: {
        ids: ['educationSection'],
        heading: /^education$/i,
        blockIdPattern: /^education-\d+$/,
        blockHeading: /^education \d+$/i,
      },
      languages: {
        ids: ['languageSection'],
        heading: /^languages?$/i,
        blockIdPattern: /^language-\d+$/,
        blockHeading: /^languages? \d+$/i,
      },
      websites: {
        ids: ['websiteSection'],
        heading: /^websites?$/i,
        blockIdPattern: /^(website|webAddress)-\d+$/,
        blockHeading: /^websites? \d+$/i,
      },
    },

    /** Fields inside one block of a repeatable section (resolved within that block only). */
    blockFields: {
      experience: {
        jobTitle: { ids: ['jobTitle'], labels: [/^job title/i] },
        company: { ids: ['company', 'companyName'], labels: [/^company/i] },
        location: { ids: ['location'], labels: [/^location/i] },
        current: { ids: ['currentlyWorkHere'], labels: [/currently work here/i] },
        startDate: { ids: ['startDate'], labels: [/^from\b|^start date/i] },
        endDate: { ids: ['endDate'], labels: [/^to\b|^end date/i] },
        description: { ids: ['description', 'roleDescription'], labels: [/description/i] },
      },
      education: {
        school: { ids: ['school', 'schoolName', 'school-name'], labels: [/^(school|university|institution|college)/i] },
        degree: { ids: ['degree'], labels: [/^degree/i] },
        fieldOfStudy: { ids: ['field-of-study', 'fieldOfStudy'], labels: [/field of study|major|discipline/i] },
        gpa: { ids: ['gpa', 'gradeAverage'], labels: [/gpa|grade average|overall result/i] },
        startDate: { ids: ['firstYearAttended', 'startDate'], labels: [/^from\b|^start|first year/i] },
        endDate: { ids: ['lastYearAttended', 'endDate'], labels: [/^to\b|^end|last year|graduation/i] },
      },
      languages: {
        language: { ids: ['language'], labels: [/^language$/i] },
        fluent: { ids: ['nativeLanguage', 'isFluent'], labels: [/fluent|native/i] },
        /** Every dropdown in the block whose label matches this gets the proficiency value. */
        proficiencyLabel: /proficiency|reading|writing|speaking|comprehension|overall/i,
      },
      websites: {
        url: { ids: ['url', 'website', 'webAddress'], labels: [/url|website/i] },
      },
    },

    /** Built-in answers for Application Questions (saved answers always win). */
    questionPatterns: {
      sponsorship: /sponsor/i,
      withoutSponsorship: /without\b.{0,40}sponsor/i,
      authorized:
        /(authori[sz]ed|eligible|permitted|entitled|allowed|legally able)\s+to\s+work|work\s+authori[sz]ation|right\s+to\s+work|work\s+permit/i,
      relocate: /relocat/i,
      previouslyWorked: /previously (worked|been employed)|former (employee|worker)|worked (here|for us) before/i,
      howDidYouHear: /how did you hear/i,
      linkedin: /linkedin/i,
      github: /github/i,
      portfolio: /portfolio|personal website/i,
    },

    /**
     * Synonym groups for dropdown/prompt matching. If your value equals any entry, the
     * other entries are tried too (in this order) after your own "|" alternatives.
     * Generic names come first so a specific-but-wrong degree isn't picked early.
     */
    synonyms: [
      [
        "Bachelor's Degree", 'Bachelors Degree', 'Bachelors', "Bachelor's", 'Undergraduate Degree',
        'Bachelor of Engineering', 'BEng', 'B.Eng', 'Bachelor of Applied Science', 'BASc', 'B.A.Sc',
        'Bachelor of Science', 'BS', 'B.S.', 'BSc', 'B.Sc', 'BSE',
      ],
      [
        "Master's Degree", 'Masters Degree', 'Masters', "Master's",
        'Master of Engineering', 'MEng', 'M.Eng', 'Master of Applied Science', 'MASc',
        'Master of Science', 'MS', 'M.S.', 'MSc', 'M.Sc',
      ],
      ['Doctorate', 'Doctoral Degree', 'PhD', 'Ph.D.', 'Doctor of Philosophy'],
      ["Associate's Degree", 'Associates Degree', 'Associate Degree', 'Associates', 'College Diploma'],
      ['High School Diploma', 'High School', 'Secondary School', 'GED'],
      ['Mobile', 'Cell', 'Cell Phone', 'Mobile Phone', 'Cellular'],
      // Schools known under several names (add your own the same way)
      ['Western University', 'University of Western Ontario', 'The University of Western Ontario', 'Western Ontario', 'UWO'],
    ],

    /** Extra names used to spot a country inside a question's text. */
    countryAliases: {
      'united states': ['united states of america', 'usa', 'u s', 'u s a'],
      'united kingdom': ['uk', 'u k', 'great britain', 'britain'],
    },
  };
})();
