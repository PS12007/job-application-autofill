# Job Application Autofill (personal)

A Chrome extension (Manifest V3, plain JavaScript, no build step) that fills job applications from a profile stored in your browser. **Workday** and **Greenhouse** have dedicated support; **every other site** (Lever, Ashby, SmartRecruiters, iCIMS, company career pages, …) gets a generic filler that reads the form's labels.

- It **never** clicks Submit, never creates accounts, and never touches CAPTCHAs. By default it doesn't click Next either: every fill click passes through a guard (`WDA.assertClickable` in `src/content/dom.js`) that refuses navigation and sign-in buttons. The only exception is the opt-in **Auto-advance** toggle (see below), whose single navigation click lives in `src/content/autoAdvance.js`.
- All data stays in `chrome.storage.local`. The extension makes no network requests and has no analytics.
- Permissions: `storage`, `activeTab`, `scripting`, plus host access to all `http`/`https` pages so it can work on any job site. The content scripts load on every page but stay idle: nothing is read or filled until you press Fill, and the Fill button only appears on pages that look like an application form.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Pin the extension so its icon is easy to reach.

After you edit any file, click the reload ↻ icon on the extension card, then reload the Workday tab.

## Set up your profile

Right-click the extension icon and choose **Options**, or use **Profile settings** in the popup.

- Fill in the sections and click **Save** (or press Ctrl+S).
- To try it quickly, click **Import JSON** and pick `sample-profile.json`, then replace the placeholder data with your own.
- **Export JSON** downloads a backup, which includes your resume as base64.
- **Dropdown values must match Workday's option text closely.** Matching tries exact text, then case-insensitive, then "starts with", then "contains". You can list alternatives with `|`, for example `Bachelor's Degree|Bachelors|Bachelor of Science`.
- **Degrees** have built-in synonyms. For example, "Bachelors Degree" also tries Bachelor of Engineering, BASc, BS, BSc and so on, and "Mobile" also tries "Cell". To control the order, put your own `|` alternatives first, e.g. `Bachelor of Engineering|Bachelor of Applied Science`. You can edit the synonym list in `selectors.js` under `synonyms`.
- **Search fields** such as field of study fall back to the closest result that contains your value's most distinctive word. For example, "Mechatronics Engineering" can become "Mechatronics". When that happens, the popup shows `closest match used: …` so you can check it. Add `|Other` as a last resort.
- **School names** are also searched in their other common forms ("Western University" ↔ "University of Western Ontario", with and without "The"). Known aliases can be added to `synonyms` in `selectors.js`. If a search still fails, the popup lists the results it saw.
- **"Select all that apply"** checkbox questions: separate the options in a saved answer with `;`, e.g. `Work remotely; Relocate`.
- **Nested lists** (often "How did you hear about us") can use a path: `Job Board > LinkedIn`. A plain value such as `LinkedIn` is typed into the search box instead.
- **Saved answers**: if any keyword appears in a question, that answer is used, and the pair with the most or longest keyword hits wins. Make keywords specific. For example, `sponsorship` alone also matches "Are you authorized to work **without sponsorship**?", whereas `require sponsorship` doesn't. For a dropdown or radio question, the answer is matched against the option text.
- **Work authorization**: if a question mentions one of your countries, that row's answers are used. Otherwise the first row is used. Saved answers win over these built-in answers.
- **Voluntary disclosures**: *Decline* picks the "I don't wish to answer" style option, *Leave blank* doesn't touch the field, and *Answer…* uses your text.

## Use it

1. Open the Workday application and go to a step (My Information, My Experience, …).
2. Click the extension icon, then **Fill this page**. You can also use the small **Fill** button at the bottom right of the page. Drag it up or down to move it, or hide it in Options.
3. Review the outlines:
   - 🟩 green: filled (or it already had the right value)
   - 🟨 yellow: skipped (no data in your profile, already had a different value, or no saved answer). Hover for the reason.
   - 🟥 red: failed. The popup lists every skipped and failed field with a reason.
4. Fix anything by hand, then click Next or Submit **yourself**.

**Auto-advance through steps** (popup toggle, off by default): fill once and it keeps going. After each step it clicks Next / Save and Continue, waits for the next step and fills that too. It stops and tells you why when:
- it reaches **Review**, where you check everything and click Submit yourself (it never clicks a button containing "Submit")
- any field **failed**, or a **required field is still empty** (shown in red, for example an unanswered question or the consent checkbox). Fix it and press Fill again to continue from that step.
- Workday shows validation errors after Next, the page doesn't change, or the step is unknown

**Overwrite existing values** (popup toggle): off by default, so values Workday pre-filled from your resume are left alone. Turn it on to replace them.

### What each step fills

| Step | Filled |
|---|---|
| Autofill with Resume | Resume upload |
| My Information | Country, how did you hear, previously worked here, legal/preferred name, address, email, phone device type, country phone code, phone number/extension |
| My Experience | Work experience, education, languages, websites (adds blocks as needed), skills, LinkedIn, resume |
| Application Questions | Each question matched against saved answers, then work authorization, relocation and links. Unmatched empty questions turn yellow. |
| Voluntary Disclosures | Gender, Hispanic/Latino, ethnicity, veteran, disability. Also any saved-answer matches. **The terms/consent checkbox is left for you.** |
| Self Identify | Name, today's date, disability status |
| Review | Nothing |
| Unknown | Only saved answers |

## Greenhouse

Works on the new form (`job-boards.greenhouse.io`, with searchable dropdowns) and the legacy form (`boards.greenhouse.io`, with plain dropdowns). It also works when the Greenhouse form is embedded inside a company's careers page.

A Greenhouse application is one page, so a single Fill covers everything:
- name, email, phone country and number, location (picked from the autocomplete), resume
- education and employment rows (it clicks "+ Add another" for extra rows), with months matched by name
- LinkedIn, GitHub and website questions
- gender, Hispanic/Latino, race, veteran and disability, following your disclosure settings
- every other question, matched against your saved answers (unmatched ones turn yellow)

It never clicks Submit. With Auto-advance on, it also marks any required field still empty in red.

Greenhouse selectors are in `src/content/greenhouse/selectors.js`. The same **Dump fields** button works there too.

## Other sites

On any other site, the extension scans the page for form fields and works out what each one is from its label, `autocomplete` attribute, or name/id. It fills:
- first/last/full/preferred name, email, phone (and a separate country-code dropdown), address, city, state, postal code, country, location
- LinkedIn, GitHub and website links, the resume (the first file upload that isn't a cover letter, transcript, etc.)
- current company and title, school, degree, field of study, GPA and graduation date (your first entry only)
- gender, Hispanic/Latino, race, veteran and disability questions, following your disclosure settings
- every other question, from your saved answers and work-authorization answers (unmatched ones turn yellow)

Fields that ask about someone else (emergency contact, referrer, reference) are never filled with your details. Autocomplete fields (like Location) pick the closest suggestion; if none matches, your text is typed in and the field is marked yellow so you can check it. Repeatable sections ("Add another job") only get the first entry, and sites that hide their form behind a sign-in still need you to sign in first.

If the form is embedded in an iframe, the popup fills the frame that looks most like an application. Auto-advance works too: it clicks Next / Continue on multi-step forms and never clicks Submit or Apply.

## Reporting problems with "Dump fields"

Workday's markup varies between companies, so some selectors will need fixing.

1. Go to the step that didn't fill correctly.
2. Click the extension icon, then **Dump fields (debug)**. A compact JSON snapshot of the step is copied to your clipboard. It contains the step, headings, section ids, buttons, and one line per field with its tag, type, `data-automation-id`, id, name, label, value and aria attributes.
3. Paste it into the chat with a short description, for example "State dropdown stayed empty, school failed".

The dump includes the current field values. Blank out anything personal before sharing; selectors can be fixed without the values.

**Debug logging** (popup toggle) logs each fill attempt and its result to the page's DevTools console (F12) with the prefix `[WD-Autofill]`.

Most fixes only need edits in `src/content/selectors.js` (Workday), `src/content/greenhouse/selectors.js` or `src/content/generic/selectors.js` (other sites). On other sites the dump also lists `scanned`: each field's label as the extension sees it and the profile key it matched.

## Files

```
manifest.json
sample-profile.json
icons/
src/shared/defaults.js      profile schema, defaults, normalisation
src/shared/storage.js       chrome.storage.local wrapper
src/content/greenhouse/    ★ Greenhouse selectors + filler
src/content/generic/       ★ any other site: field patterns, page scanner, filler
src/content/sites.js        Workday / Greenhouse / generic detection
src/content/reactSelect.js  Greenhouse searchable dropdowns
src/content/selectors.js    ★ all Workday automation ids, label patterns, step names, nav blocklist
src/content/log.js          debug logger
src/content/dom.js          waitFor, visibility, labels, React-safe setters, guarded clicks
src/content/match.js        option matching, saved-answer matching
src/content/inputs.js       field lookup + fillers per control type
src/content/highlight.js    green/yellow/red outlines
src/content/context.js      one fill run: per-field timeout, results
src/content/steps.js        step detection
src/content/sections.js     repeatable sections (add/count/scope blocks)
src/content/fillers/        one file per step
src/content/dump.js         Dump fields
src/content/floatingButton.js
src/content/main.js         entry point + popup messaging
src/popup/                  popup UI
src/options/                profile editor
```

## Known limitations

- **Selectors are educated guesses** until they've been checked against real dumps. Expect some fields to fail on the first runs.
- Dropdown and prompt matching is text-based. Abbreviations such as "ON" for "Ontario", or degree names that differ from the company's list, won't match unless you add them as `|` alternatives.
- Skills are only added on an exact or close match from Workday's search, and unmatched skills are listed in yellow.
- Some Workday date widgets ignore programmatic input. If dates keep failing, send a dump.
- Repeatable sections are filled in order. Extra blocks Workday created from your resume are never deleted.
- The Hispanic/Latino and ethnicity questions are sometimes combined into one field. In that case, the Hispanic/Latino setting may be the one that fills it.
- Resumes larger than about 3 MB may not fit in extension storage, which is about 10 MB in total.
- Fields are filled one at a time with short pauses, so a long My Experience page can take a minute.
- On other sites, fields with no usable label (only an icon, or a label far away from the field) are left for you. Custom widgets that aren't real inputs or ARIA comboboxes/listboxes may not fill.
- If a tab was open before you installed or reloaded the extension, the popup injects the scripts on first use. If that fails, reload the tab.
