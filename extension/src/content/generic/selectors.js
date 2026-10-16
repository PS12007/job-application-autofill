/**
 * generic/selectors.js — patterns for sites with no dedicated support (Lever, Ashby,
 * SmartRecruiters, iCIMS, company career pages, …).
 *
 * Each rule is tried in passes over every field: the autocomplete attribute first,
 * then the visible label (only labels up to maxLabel chars, so long questions that
 * merely mention "city" don't match), then name/id attributes, then the input type.
 * Within a pass, the first rule that matches wins, so order matters.
 *
 * Attribute values are normalised before testing: "job_application[firstName]" →
 * "job_application_first_name". attr() builds a regex that matches whole "_" words.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const attr = (s) => new RegExp(`(^|_)(${s})(_|$)`);
  const CHOICE = ['select', 'dropdown', 'choice', 'combobox'];

  WDA.GEN = {
    /** Controls the scanner looks at. */
    controls:
      'input, select, textarea, [role="combobox"]:not(input), button[aria-haspopup="listbox"], [role="radio"]:not(input), [role="checkbox"]:not(input)',

    /** Controls inside these are never form fields. */
    outside: [
      'header', 'nav', 'footer', '[role="search"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '[role="listbox"]', '[role="menu"]', '#wda-fab-host',
      '.select2-container', '.select2-dropdown', '.chosen-container',
      '[class*="captcha" i]', '[id*="captcha" i]',
    ].join(', '),

    /** Labels that describe someone else (never fill your own name/email/phone there). */
    otherPerson: /emergency|referr|reference|manager|supervisor|recruiter|parent|guardian|spouse|next of kin/i,

    rules: [
      // value-less keys: recognised so they aren't treated as unanswered questions
      { key: 'skip', label: /^middle (name|initial)|password|captcha|^search\b/i, attr: attr('middle(_?name)?|mname|password|captcha|g_recaptcha_response|search') },
      { key: 'coverLetter', label: /cover letter/i, attr: attr('cover(_?letter)?') },

      { key: 'preferredName', auto: ['nickname'], label: /^(preferred|nick) ?(first )?name/i, attr: attr('preferred(_first)?_?name|nick_?name') },
      { key: 'firstName', auto: ['given-name'], label: /^(legal |your )?(first|given) ?name|^forename/i, attr: attr('first_?name|fname|given_?name|forename') },
      { key: 'lastName', auto: ['family-name'], label: /^(legal |your )?(last|family) ?name|^surname/i, attr: attr('last_?name|lname|family_?name|surname') },
      { key: 'fullName', auto: ['name'], label: /^(full |legal |your |candidate |applicant )?name$|^full (legal )?name/i, attr: attr('full_?name|name|candidate_?name|applicant_?name|your_?name') },
      { key: 'email', auto: ['email'], label: /^(your |confirm |re-?enter )?e-?mail/i, attr: attr('e_?mail(_address)?'), type: 'email' },

      { key: 'phoneCountry', auto: ['tel-country-code'], label: /country (calling |dial(l?ing)? )?code|phone.*(country|code)|dial(l?ing)? code/i, attr: attr('country_?code|phone_?country|dial_?code|calling_?code') },
      { key: 'phoneExt', auto: ['tel-extension'], label: /^(phone )?ext(ension)?\b/i, attr: attr('ext|extension|phone_ext(ension)?') },
      { key: 'phone', auto: ['tel', 'tel-national'], label: /^(your |mobile |cell |primary )?(phone|mobile|cell|telephone)( (number|no))?\b|^contact (number|phone)/i, attr: attr('phone(_?number)?|mobile(_?phone)?|tel(ephone)?|cell(_?phone)?'), type: 'tel' },

      { key: 'address2', auto: ['address-line2'], label: /address line 2|^apartment|^apt\b|^suite|^unit\b/i, attr: attr('address_?(line_?)?2|apt|suite') },
      { key: 'address1', auto: ['address-line1', 'street-address'], label: /^(street |home |mailing |postal )?address( line)?( 1)?$|^street/i, attr: attr('address(_?line)?(_?1)?|street(_?address)?') },
      { key: 'city', auto: ['address-level2'], label: /^(city|town)\b/i, attr: attr('city|town') },
      { key: 'state', auto: ['address-level1'], label: /^(state|province|region)\b/i, attr: attr('state|province|region') },
      { key: 'postalCode', auto: ['postal-code'], label: /^(postal|zip|post) ?code|^zip\b|^postcode/i, attr: attr('zip(_?code)?|postal(_?code)?|post_?code|postcode') },
      { key: 'country', auto: ['country', 'country-name'], label: /^country( of residence| ?\/ ?region| ?\/ ?territory)?$/i, attr: attr('country(_?name)?') },
      { key: 'location', label: /^(current |your )?location|^where are you (currently )?(located|based)|^(current )?city,? (state|province)|^based in/i, attr: attr('location|current_?location|candidate_?location') },

      { key: 'linkedin', label: /linked ?in/i, attr: /linked_?in/ },
      { key: 'github', label: /git ?hub/i, attr: /git_?hub/ },
      { key: 'portfolio', label: /portfolio|^(personal )?(web ?site|homepage|blog)\b|^other (web ?site|url)/i, attr: attr('portfolio|website|personal_?site|homepage') },

      { key: 'resume', kinds: ['file'], label: /resume|résumé|\bcv\b|curriculum/i, attr: /resume|(^|_)cv(_|$)/ },

      { key: 'company', auto: ['organization'], label: /^(current |most recent |present )?(company|employer|organi[sz]ation)( name)?$/i, attr: attr('(current_?)?company(_?name)?|employer|organi[sz]ation') },
      { key: 'title', auto: ['organization-title'], label: /^(current |most recent )?(job |position )?title$|^current (role|position)$/i, attr: attr('(current_?)?job_?title|current_?title') },

      { key: 'school', label: /^(school|university|college|institution)( name)?$|^(name of )?(your )?(school|university|college)|^(most recent|highest) (school|university)/i, attr: attr('school(_?name)?|university|college|institution') },
      { key: 'degree', label: /^degree( type| level)?$|^highest (level of )?(education|degree)|^(education|degree) level|^level of education/i, attr: attr('degree(_?type)?|education_?level') },
      { key: 'discipline', label: /^(discipline|major|field of study|area of study|course of study|program of study)\b/i, attr: attr('discipline|major|field_?of_?study') },
      { key: 'gpa', label: /\bgpa\b|grade point average/i, attr: attr('gpa') },
      { key: 'gradYear', label: /graduation (date|year)|year of graduation|grad(uation)? (date|year)|when (do|did|will) you graduate/i, attr: attr('grad(uation)?_?(year|date)') },

      // voluntary disclosures: only choice-type controls, and longer question text is fine
      { key: 'hispanicLatino', kinds: CHOICE, maxLabel: 200, label: /hispanic|latin[oax]/i },
      { key: 'ethnicity', kinds: CHOICE, maxLabel: 200, label: /\brace\b|ethnic/i },
      { key: 'gender', kinds: CHOICE, maxLabel: 200, label: /^gender|gender identity|^sex\b|your (gender|sex)\b/i },
      { key: 'veteran', kinds: CHOICE, maxLabel: 200, label: /veteran|protected military/i },
      { key: 'disability', kinds: CHOICE, maxLabel: 200, label: /disabilit/i },
    ],

    /** Rules whose label must not describe someone else. */
    personalKeys: ['preferredName', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'phoneCountry', 'phoneExt'],

    /** File inputs that are never the resume. */
    notResume: /cover|transcript|portfolio|writing sample|additional|other|photo|picture|avatar/i,
  };
})();
