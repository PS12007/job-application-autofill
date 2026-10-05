# Workday Autofill (personal)

A Chrome extension (Manifest V3, plain JavaScript, no build step) that fills the current step of a Workday job application from a profile stored in your browser.

- It **never** clicks Next, Save and Continue, or Submit, never creates accounts, and never touches CAPTCHAs. Every click passes through a guard (`WDA.assertClickable` in `src/content/dom.js`) that refuses navigation and sign-in buttons. The list it checks is `nav` in `src/content/selectors.js`.
- All data stays in `chrome.storage.local`. The extension makes no network requests and has no analytics.
- Permissions: `storage`, `activeTab`, `scripting`, plus host access to `*.myworkdayjobs.com`, `*.myworkday.com` and `*.myworkdaysite.com` only.

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

## Reporting problems with "Dump fields"

Workday's markup varies between companies, so some selectors will need fixing.

1. Go to the step that didn't fill correctly.
2. Click the extension icon, then **Dump fields (debug)**. A compact JSON snapshot of the step is copied to your clipboard. It contains the step, headings, section ids, buttons, and one line per field with its tag, type, `data-automation-id`, id, name, label, value and aria attributes.
3. Paste it into the chat with a short description, for example "State dropdown stayed empty, school failed".

The dump includes the current field values. Blank out anything personal before sharing; selectors can be fixed without the values.

**Debug logging** (popup toggle) logs each fill attempt and its result to the page's DevTools console (F12) with the prefix `[WD-Autofill]`.

Most fixes only need edits in `src/content/selectors.js`.

## Files

```
manifest.json
sample-profile.json
icons/
src/shared/defaults.js      profile schema, defaults, normalisation
src/shared/storage.js       chrome.storage.local wrapper
src/content/selectors.js    ★ all automation ids, label patterns, step names, nav blocklist
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
- Only the top-level page is handled. Workday forms embedded in iframes on other sites aren't supported.
- If a Workday tab was open before you installed or reloaded the extension, the popup injects the scripts on first use. If that fails, reload the tab.
