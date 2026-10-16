/**
 * greenhouse/selectors.js — every Greenhouse-specific id, label pattern and class.
 *
 * Covers both the new React form (job-boards.greenhouse.io, react-select dropdowns
 * with ids like "school--0") and the legacy form (boards.greenhouse.io, plain
 * <select>s, ids like "job_application_gender"). Field specs use the same format as
 * selectors.js: { ids, labels, exclude, selectors }.
 *
 * Indexed specs (education/employment) are functions of the row index i.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.GH = {
    /** Hostnames that run the Greenhouse filler. */
    host: /(^|\.)greenhouse\.io$/i,

    /** Replaces SELECTORS.containers.field while on Greenhouse. */
    containers: {
      field: '.field, .field-wrapper, .input-wrapper, .select__container, .text-input-wrapper, .application-question',
    },

    /** react-select (new form). */
    reactSelect: {
      control: '[class*="select__control"]',
      menu: '[class*="select__menu"]',
      option: '[class*="select__option"], [id*="-option-"][role="option"], [role="option"]',
      value: '[class*="select__single-value"], [class*="select__multi-value__label"]',
      noOptions: /no options|no results|type to search|loading/i,
    },

    /** Upload confirmation (file name shown next to the field). */
    uploaded: '[class*="file-name"], [class*="filename"], .chosen, [data-testid*="file"]',

    fields: {
      firstName: { ids: ['first_name', 'job_application_first_name'], labels: [/^(legal )?first name/i] },
      lastName: { ids: ['last_name', 'job_application_last_name'], labels: [/^(legal )?last name/i] },
      preferredName: { ids: ['preferred_name', 'job_application_preferred_name'], labels: [/^preferred (first )?name/i] },
      email: { ids: ['email', 'job_application_email'], labels: [/^e-?mail/i] },
      phoneCountry: { ids: ['country', 'phone_country', 'phone-country'], labels: [/^country$/i] },
      phone: { ids: ['phone', 'job_application_phone'], labels: [/^phone/i] },
      location: {
        ids: ['candidate-location', 'job_application_location', 'auto_complete_input', 'location'],
        labels: [/^location|^city|^current location/i],
      },
      resume: {
        ids: ['resume', 'resume_file', 'job_application_resume'],
        labels: [/^resume|^cv\b/i],
        selectors: ['input[type="file"][id*="resume" i]', 'input[type="file"][name*="resume" i]', 'input[type="file"]'],
      },
      linkedin: { labels: [/linkedin/i] },
      github: { labels: [/github/i] },
      portfolio: { labels: [/portfolio|^website|personal (web)?site/i] },
    },

    /** Repeatable sections: "+ Add another" under the section heading. */
    sections: {
      education: { ids: [], heading: /^education$/i },
      employment: { ids: [], heading: /^(employment|work experience|experience)$/i },
    },

    education: {
      school: (i) => ({ ids: [`school--${i}`, `education_school_name_${i}`], labels: i ? [] : [/^school/i] }),
      degree: (i) => ({ ids: [`degree--${i}`, `education_degree_${i}`], labels: i ? [] : [/^degree/i] }),
      discipline: (i) => ({ ids: [`discipline--${i}`, `education_discipline_${i}`], labels: i ? [] : [/^discipline|field of study|major/i] }),
      startMonth: (i) => ({ ids: [`start-month--${i}`, `start-date-month--${i}`, `education-start-month--${i}`] }),
      startYear: (i) => ({ ids: [`start-year--${i}`, `start-date-year--${i}`, `education-start-year--${i}`, `education_start_date_year_${i}`] }),
      endMonth: (i) => ({ ids: [`end-month--${i}`, `end-date-month--${i}`, `education-end-month--${i}`] }),
      endYear: (i) => ({ ids: [`end-year--${i}`, `end-date-year--${i}`, `education-end-year--${i}`, `education_end_date_year_${i}`] }),
    },

    employment: {
      company: (i) => ({ ids: [`company-name--${i}`, `company--${i}`, `employment_company_name_${i}`], labels: i ? [] : [/^company/i] }),
      title: (i) => ({ ids: [`title--${i}`, `employment_title_${i}`], labels: i ? [] : [/^title/i] }),
      startMonth: (i) => ({ ids: [`employment-start-month--${i}`, `start-date-month--${i}`] }),
      startYear: (i) => ({ ids: [`employment-start-year--${i}`, `start-date-year--${i}`] }),
      endMonth: (i) => ({ ids: [`employment-end-month--${i}`, `end-date-month--${i}`] }),
      endYear: (i) => ({ ids: [`employment-end-year--${i}`, `end-date-year--${i}`] }),
      current: (i) => ({ ids: [`current-role--${i}`, `current-role-${i}_1`, `employment_current_${i}`] }),
    },

    disclosures: {
      gender: { ids: ['gender', 'job_application_gender'], labels: [/^gender/i] },
      hispanicLatino: { ids: ['hispanic_ethnicity', 'job_application_hispanic_ethnicity'], labels: [/hispanic|latino/i] },
      ethnicity: { ids: ['race', 'job_application_race'], labels: [/^race|ethnicity/i], exclude: [/hispanic/i] },
      veteran: { ids: ['veteran_status', 'job_application_veteran_status'], labels: [/veteran/i] },
      disability: { ids: ['disability_status', 'job_application_disability_status'], labels: [/disability/i] },
    },
  };
})();
