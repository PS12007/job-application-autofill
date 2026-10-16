# Job application runner

Works through a queue of job links in a spreadsheet. For each link it opens the posting, clicks Apply, signs in (or creates the account), and lets the extension in `../extension` fill each step. It stops on **Review** and leaves the tab open for you to check and submit.

Hard rules, enforced in code:
- It **never clicks Submit.** The extension refuses any button whose text contains "submit", and so does the runner's own click helper (`gate.click`).
- It **never solves or bypasses CAPTCHAs** or bot checks. It flags the row and moves on.
- **No credentials in code or the sheet.** The password lives in `.env`, which is gitignored.

## How it works

```
apply.py ── sheet.py            reads Link, writes Status / Notes / Last Updated (.xlsx or Google Sheets)
   │
   ├── precheck.py              before opening anything: closed postings, duplicates, job title + description
   ├── browser.py               visible Chromium, persistent profile (./chrome-profile), extension loaded
   ├── flow.py ── gate.py       job page → Apply → Apply Manually → sign in / create account
   │      │       page_selectors.py   ★ every selector/pattern used outside the form
   │      ├── resumes.py        picks a resume + cover letter per job (resumes.yaml)
   │      ├── ats.py            keywords from the job missing in that resume → Notes
   │      ├── questions.py      collects unanswered questions; your answers go back to the extension
   │      └── bridge.py         tells the extension to fill + advance; reads its result
   ├── tabs.py ── inbox.py      max-tabs limit + watcher (Submitted, carry on after you fix things,
   │                            open verification emails)
   └── notify.py                sound + desktop notification
```

The form itself is filled by the extension, so selector fixes for form fields go in `../extension/src/content/selectors.js`. The same fix then works when you use the extension by hand.

**Why sync Playwright:** the runner does one thing at a time: fill one application, then check the open tabs, then the next. Sync code is simpler to follow and debug, and Playwright's sync API isn't usable from several threads anyway.

**Why Chromium and not Chrome:** Google Chrome removed the command-line switch that loads an unpacked extension, so the runner uses the Chromium that Playwright installs. It still uses a persistent profile, so logins and cookies carry over between runs. It's a separate browser from your everyday Chrome.

## Setup

1. **Python 3.11+** (`python --version`).
2. In this folder:
   ```
   python -m venv .venv
   .venv\Scripts\activate            (macOS/Linux: source .venv/bin/activate)
   pip install -r requirements.txt
   python -m playwright install chromium
   ```
3. **Password**: copy `.env.example` to `.env` and set `WORKDAY_PASSWORD`. The same password is used for every company's Workday account. `WORKDAY_EMAIL` is optional; by default `personal.email` from the profile is used.
4. **Profile**: copy `profile.example.json` to `profile.json` and fill it in (see below).
5. **Config**: the first run copies `config.example.yaml` to `config.yaml`. Edit it to choose the sheet.
6. **Optional, automatic email verification**: set `IMAP_PASSWORD` in `.env` to an *app password* for your email (see "Email verification" below).
7. **Spreadsheet**: either:
   - **Local .xlsx** (default): `sheet.xlsx_path: applications.xlsx`. If the file doesn't exist, the first run creates it with the headers. Close it in Excel while the runner is going; if it's open, saves are retried.
   - **Google Sheets**: see the next section.

### Google Sheets (service account)

1. Go to <https://console.cloud.google.com/>, then create a project (or pick one).
2. **APIs & Services → Library**: enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Give it a name, then **Done**.
4. Open the service account, go to **Keys → Add key → Create new key → JSON**, and save the file as `runner/service-account.json` (it's gitignored).
5. Copy the service account's email (`…@….iam.gserviceaccount.com`). In your Google Sheet, click **Share**, paste that email, and give it **Editor** access.
6. In `config.yaml`:
   ```yaml
   sheet:
     backend: gsheets
     gsheets_id: 1AbC...xyz        # the long ID between /d/ and /edit in the sheet URL (or the whole URL)
     worksheet: ""                 # tab name; blank = first tab
   ```

## The spreadsheet

Row 1 holds the headers: `Row ID | Company | Role | Link | Status | Notes | Last Updated`. The order doesn't matter, and other columns are left alone. The runner reads **Link** (plain URL, a cell hyperlink, or `=HYPERLINK(...)`) plus Company / Role for messages. It writes only **Status**, **Notes** and **Last Updated**, adding those headers if they're missing. An optional **Resume** column picks the resume for that row (see "Resumes per job").

| Status | Meaning |
|---|---|
| *(blank)* / Queued | Not processed yet |
| In progress | Being filled right now |
| Ready to submit | Everything filled; the tab is waiting on Review |
| Needs you: CAPTCHA | A CAPTCHA / bot check appeared; the tab is open for you |
| Needs you: verify email | Verify the new account from your email, then sign in in that tab |
| Needs you: sign in | Sign-in failed, the account exists with another password, or a 2FA code is asked for |
| Needs you: unanswered questions | Required questions without a saved answer; Notes lists them |
| Submitted | The watcher saw the "application submitted" page |
| Already applied | The site says you already applied (tab closed) |
| Posting closed | The job is no longer available (tab closed, or found before opening it) |
| Duplicate | Same job as another row (same company + requisition ID, or same link); Notes says which |
| Failed | Unexpected error, after one automatic retry. Notes has the reason and a screenshot path (`screenshots/<row>_<company>.png`) |

Notes start with a tag such as `[resume: ml; 72% keyword match, missing: kubernetes, grpc]`: the resume that was uploaded and the job's keywords it doesn't mention (see "Keyword gap").

## Running

```
python apply.py                          every row that's blank / Queued / In progress / Needs you
python apply.py --start 12 --count 5     5 applications starting at sheet row 12
python apply.py --max-tabs 3             at most 3 tabs waiting for you at once
python apply.py --redo-failed            also retry rows marked Failed
python apply.py --force --start 7 --count 1   redo row 7 whatever its status (e.g. reopen a Ready tab)
python apply.py --dry-run --count 3      fill the first page only, create no accounts, write nothing
python apply.py --debug                  log every field to logs/run_<time>.log
```

By default it skips rows marked Submitted, Ready to submit, Already applied, Posting closed, Duplicate, or any status text you wrote yourself. `--force` processes them anyway.

**Before opening anything**, Workday links are looked up through the same public job data the posting page loads, about 8 at a time:
- Closed postings are marked **Posting closed** without opening a tab.
- Rows for a job that another row already covers (queued, Ready or Submitted) are marked **Duplicate**. Two different links to the same posting count as the same job.
- The job title and description are kept for picking the resume, so the page doesn't have to load first.

A row that **fails** is retried once straight away (not after a timeout).

**While it runs:**
- Leave the first tab ("The job application runner is using this window") open.
- When `--max-tabs` tabs are waiting for you, it pauses until you submit or close one.
- You hear a sound and get a desktop notification whenever a tab becomes *Ready to submit* or *Needs you*.
- **The watcher** checks the open tabs every few seconds:
  - When you submit and the confirmation page shows, the row becomes **Submitted** and the tab closes.
  - On a *CAPTCHA*, *sign in* or *verify email* tab, once you get through to the form, it **carries on filling** (turn off with `run.resume_after_you_fix: false`).
  - On an *unanswered questions* tab, once you answer and click through to Review, the row becomes **Ready to submit**. You can also press the extension's **Fill** button to continue from that step.
- After the last link it keeps watching until every tab is submitted or closed. **Ctrl+C** stops; statuses are already saved. A row that was mid-fill goes back to its previous status.
- At the end it prints a summary table and lists the rows that need a look.

## Tests

```
pip install -r requirements-dev.txt
pytest                 # unit tests, about a second
pytest --e2e           # plus the full run in a visible browser against a mock Workday site (~2 min)
```

The mock site (`tests/mock/index.html`) copies the real Workday page structure: the Apply popup, the "Sign in with email" screen, sign in / create account, and a hidden bot-trap field. `--e2e` runs `apply.py` against it end to end. That covers:
- sign-in and account creation (only the required box ticked), with email verification through a fake inbox;
- each status, including Duplicate;
- the watcher marking Submitted and Ready;
- `questions.yaml` answers filling the questions on the next run.

## profile.json

Same fields as the extension's options page, plus `resumePath`. Start from `profile.example.json`:

- `resumePath`: your default resume (PDF), relative to `runner/` or absolute.
- `personal`: legal first/last name, preferred name, email, phone (`phoneDeviceType`, `phoneCountry` such as "Canada", `phoneCode` such as "+1", `phoneNumber`), and the full address.
- `application`: `howDidYouHear` (e.g. "LinkedIn", or a path like `Job Board > LinkedIn`) and `previouslyWorkedHere`.
- `workAuth`: one row per country with `authorized` / `sponsorship` (Yes/No), plus `willingToRelocate`.
- `education`, `experience`, `languages`: lists, with blocks added on the page as needed. Dates are month and year numbers.
- `skills`: a list of strings. `links`: `linkedin`, `github`, `portfolio`.
- `disclosures`: gender, hispanicLatino, ethnicity, veteran, disability. Each is `{"mode": "decline"}` (the default), `{"mode": "blank"}`, or `{"mode": "answer", "answer": "…"}`.
- `savedAnswers`: `{"keywords": "require sponsorship, visa", "answer": "No"}`. If a question contains a keyword, that answer is used. Use specific keywords. For dropdowns and radio buttons, the answer is matched against the option text. For "select all that apply", separate options with `;`.

Dropdown values can list alternatives with `|`, e.g. `Bachelor's Degree|Bachelors`. The extension README has more matching tips.

Each run loads `profile.json` into the runner browser's copy of the extension. That copy is separate from the extension in your everyday Chrome.

## Resumes per job

Put your resumes in `runner/resumes/` and point the tracks in `resumes.yaml` at them (the first run creates it from `resumes.example.yaml`). There are 20 tracks with about 930 keywords: ml, data_science, data_engineering, embedded_firmware, hardware, asic_fpga, robotics_controls, security, devops_cloud, mobile, frontend, fullstack, backend, game_dev, quant, qa_test, it_support, product, mechanical, swe.

Each job is scored against every track that has a file:
- **+5** per title phrase found in the job title (your Role column; the page heading if Role is empty)
- **+2** per keyword found in the title
- **+1** per keyword found in the job description, capped at `description_cap`

The highest score wins. A tie goes to the track listed first, and specific tracks are listed before `swe`. Below `min_score`, or for tracks whose file doesn't exist yet, `resumePath` is used. Tracks without a file are simply skipped, so you can add resumes one at a time. To force a resume for one job, put a track name (`ml`) or a file path in the sheet's **Resume** column.

The chosen resume is used for the upload (or "Autofill with Resume" if `run.apply_mode: resume`).

**Cover letters**: give a track `cover_letter: cover_letters/ml.pdf`, and/or set `default_cover_letter`. It's uploaded only where the form has a cover letter *upload*: Greenhouse, generic forms, and Workday questions labelled "cover letter". The runner never writes a letter into a text box.

## Unanswered questions (questions.yaml)

Every question the extension couldn't answer is saved to `questions.yaml`, with its options for dropdowns and radio buttons, how often it came up, and an example job. Type the answer once:

```yaml
- question: Are you willing to work weekends, if needed?
  answer: "Yes"                         # ← fill this in
  keywords: are you willing to work weekends
  type: choice
  options: [Yes, No]
  required: true
  seen: 4
```

The runner reloads the file before each application (even mid-run), so later applications answer it themselves. Rows already marked *unanswered questions* are retried on the next run. `keywords` decides which questions an answer applies to (comma-separated, any match). Shorten it to cover different wordings of the same question. `skip: true` stops listing a question you'd rather answer by hand. `python questions.py` lists the ones still waiting.

Answers in `profile.json`'s `savedAnswers` still work and are checked as well.

## Keyword gap

ATS filters mostly look for the job's own terms. For each job, the runner compares the description with the text of the resume it's about to upload, using every keyword in `resumes.yaml` (about 600 skills and tools) as the vocabulary. It notes the match percentage and the most-mentioned missing terms in Notes, and logs the full list.

- Different forms of a word count as the same skill ("debugged" for "debugging"), and so do common aliases (k8s/Kubernetes, Postgres/PostgreSQL, JS/JavaScript, …).
- Words that are also plain English only count when capitalised: "Excel", "React", "Spring", but not "excel at" or "react to".
- PDF, DOCX and TXT resumes are read. Turn it off with `run.keyword_gap: false`.

It's a hint for tailoring a resume; it doesn't change what's submitted.

## Email verification

Some Workday sites ask you to verify a new account by email. With an app password in `.env`, the watcher checks your inbox every 20 seconds (including spam), for up to 20 minutes per account. It opens the verification link in the runner's browser, then signs in and carries on filling that application.

```
IMAP_PASSWORD=abcd efgh ijkl mnop
```

- **Gmail**: turn on 2-Step Verification, then create an app password at <https://myaccount.google.com/apppasswords>. Outlook, Yahoo and iCloud have "app passwords" in their security settings.
- It logs in as `IMAP_USER` (default: your profile email) at `IMAP_HOST` (guessed from the address).
- **Read-only**: messages are read without being marked as read, and nothing is deleted or sent.
- Only links on the job site's own address or a Workday address that look like verification links are opened.

Without it, the row stays *Needs you: verify email*. Click the link yourself and sign in in that tab, and the watcher continues.

## When selectors break: dump_fields.py

```
python dump_fields.py            while apply.py is running: dumps the tab you're looking at
python dump_fields.py <URL>      opens URL (in the running browser, or a new one if apply.py isn't running)
```

It prints JSON with every visible field (tag, type, data-automation-id, label, value, aria attributes), the buttons and the headings, and saves it to `logs/dump_<time>.json`. Paste that back to Claude. Fixes go into `page_selectors.py` (job page, sign-in, CAPTCHA, closed/applied/submitted text) or `../extension/src/content/selectors.js` (form fields).

## config.yaml

| Key | Default | |
|---|---|---|
| `sheet.backend` | `xlsx` | `xlsx` or `gsheets` |
| `browser.user_data_dir` | `chrome-profile` | logins and cookies live here |
| `browser.debug_port` | `9333` | lets `dump_fields.py` attach (local only) |
| `run.max_tabs` | `5` | default for `--max-tabs` |
| `run.app_timeout_s` | `600` | per application (long Workday forms take a few minutes) |
| `run.delay_between_s` | `4` | pause between applications |
| `run.apply_mode` | `auto` | `auto` = Use My Last Application at companies where a row is Submitted, else Apply Manually. Or always `manual`, `resume` (Autofill with Resume), `last` |
| `run.overwrite_existing` | `true` | replace values Workday pre-filled (e.g. parsed from your resume) |
| `run.keep_failed_tabs` | `false` | leave Failed tabs open |
| `run.resume_after_you_fix` | `true` | carry on filling after you clear a CAPTCHA / sign-in / verification |
| `run.precheck` | `true` | look Workday postings up before opening them (closed postings, duplicates) |
| `run.retry_failed` | `1` | retries for a Failed application (not timeouts) |
| `run.keyword_gap` | `true` | note the job keywords missing from your resume |
| `verify_email.auto` | `true` | open verification emails (only when `IMAP_PASSWORD` is set) |
| `notify.sound`, `notify.desktop` | `true` | |

## Known limitations

- **The form steps aren't verified on real pages yet.** Everything up to sign-in was checked against a live Workday site in Oct 2026 without signing in:
  - the job page, Apply popup and "Sign in with email" screen;
  - the sign-in and create-account forms;
  - "page doesn't exist" for closed postings;
  - the public job data used before opening.

  The steps after sign-in (My Information onwards) are the extension's, and only tested on the mock site. If a step misbehaves, run `dump_fields.py` on it and send the output.
- **Ctrl+C or closing the window closes all tabs.** Playwright's browser stops with the script. Statuses are saved; to reopen a Ready row, use `--force --start N --count 1`.
- **Without IMAP, email verification links open in your normal browser**, not the runner's. Verify there, then sign in in the runner tab, and the watcher continues filling.
- **One thing at a time.** The watcher pauses while an application is being filled.
- **Excel**: keep the .xlsx closed while running. openpyxl keeps cell values and formatting but drops charts and images in that workbook.
- **Google Sheets** smart chips aren't read as links; paste plain URLs.
- Workday shows "Chrome is being controlled by automated test software". Some sites may treat the browser as a bot; that's flagged as *Needs you: CAPTCHA*, never worked around.
- Non-Workday sites get the extension's generic filler. Account creation is only automated where the sign-in pages look like Workday's (email + password + verify password).
