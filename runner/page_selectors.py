"""page_selectors.py — every selector and text pattern the runner uses *outside* the form:
the job page, Apply buttons, sign-in / account creation, CAPTCHA, closed postings,
"already applied" and the submitted confirmation.

(Named page_selectors.py, not selectors.py, because Python has a built-in module called
"selectors" that Playwright depends on.) The form itself is filled by the extension;
its selectors live in extension/src/content/selectors.js.

Clickable targets are {"css": [...], "text": regex}: CSS is tried first (by
data-automation-id), then any visible button / link whose whole text matches "text".
Text patterns are matched case-insensitively against the page's visible text.
"""

WORKDAY_HOST = r"(^|\.)(myworkdayjobs|myworkday|myworkdaysite)\.com$"

CLICKABLE = 'button, a, [role="button"], input[type="button"], input[type="submit"]'

# ---- Job posting (used to pick a resume) ----
JOB_TITLE = ['[data-automation-id="jobPostingHeader"]', "h1", "h2"]
JOB_DESCRIPTION = ['[data-automation-id="jobPostingDescription"]', "#content", ".job-description",
                   '[class*="description" i]', "main", "body"]

# ---- Starting the application ----
APPLY = {
    "css": ['[data-automation-id="adventureButton"]', '[data-automation-id="applyButton"]'],
    "text": r"^\s*(apply( now| here| online)?|apply for this (job|position|role)|apply to this (job|position|role)|start (your )?application)\s*$",
}
APPLY_MODES = {
    "manual": {"css": ['[data-automation-id="applyManually"]'], "text": r"^\s*apply manually\s*$"},
    "resume": {"css": ['[data-automation-id="autofillWithResume"]'], "text": r"^\s*autofill with resume\s*$"},
    "last": {"css": ['[data-automation-id="useMyLastApplication"]'], "text": r"^\s*use my last application\s*$"},
}
# Any of these visible = the "how do you want to apply" chooser is open.
APPLY_CHOOSER = ['[data-automation-id="applyManually"]', '[data-automation-id="autofillWithResume"]']

# ---- Account ----
EMAIL = ['input[data-automation-id="email"]', 'input[type="email"]', 'input[autocomplete="email"]', 'input[name*="email" i]']
PASSWORD = ['input[data-automation-id="password"]', 'input[type="password"]']
VERIFY_PASSWORD = ['input[data-automation-id="verifyPassword"]', 'input[name*="confirm" i][type="password"]',
                   'input[name*="verify" i][type="password"]']
# The only checkbox ticked when creating an account (terms / privacy consent).
CREATE_ACCOUNT_CHECKBOX = ['input[data-automation-id="createAccountCheckbox"]']
SIGN_IN_LINK = {"css": ['[data-automation-id="signInLink"]'], "text": r"^\s*(already have an account\?\s*)?sign in\s*$"}
CREATE_ACCOUNT_LINK = {"css": ['[data-automation-id="createAccountLink"]'], "text": r"^\s*(don'?t have an account\?\s*)?create account\s*$"}
SIGN_IN_SUBMIT = {"css": ['[data-automation-id="signInSubmitButton"]'], "text": r"^\s*(sign in|log in|login)\s*$"}
CREATE_ACCOUNT_SUBMIT = {"css": ['[data-automation-id="createAccountSubmitButton"]'], "text": r"^\s*create account\s*$"}
# Messages shown next to the sign-in / create-account forms.
FORM_ERRORS = '[data-automation-id="errorMessage"], [data-automation-id="inputAlert"], [role="alert"], .error, [class*="error" i]'
SIGNIN_FAILED_TEXT = [
    r"wrong (email|password|username)", r"incorrect (email|password|username|credentials)",
    r"invalid (email|password|username|credentials|login)", r"(email|password) (is |was )?(incorrect|invalid)",
    r"account (is |has been )?locked", r"could not sign (you )?in", r"sign[- ]in failed",
]
ACCOUNT_EXISTS_TEXT = [r"already (exists|in use|registered|been used|taken)", r"account with (this|that) email"]
TWO_FACTOR_TEXT = [
    r"verification code", r"one[- ]time (pass)?code", r"two[- ]factor", r"\b2fa\b", r"multi[- ]factor",
    r"authenticat(or|ion) (app|code)", r"enter the code (we|that was) sent",
]
VERIFY_EMAIL_TEXT = [
    r"verify your (email|account|e-mail)", r"(verification|activation) (email|e-mail|link) (has been |was )?sent",
    r"check your (email|inbox|e-mail)", r"activate your account", r"confirm your (email|e-mail) address",
    r"we('ve| have) sent (you )?an? (email|e-mail)",
]

# ---- The application form ----
# Workday: the progress bar only exists inside the application.
WORKDAY_FORM = ['[data-automation-id="progressBar"]', '[data-automation-id="progressBarActiveStep"]']

# ---- Outcomes ----
POSTING_CLOSED_TEXT = [
    r"no longer (available|accepting applications|open|active)", r"(job|position|posting|requisition) (has been |is )?(closed|filled|removed|expired)",
    r"page (you('re| are) looking for )?(doesn'?t|does not) exist", r"(job|posting) (is )?(not|no longer) (found|available)",
    r"this (job|position) is (closed|filled)", r"we('re| are) no longer accepting",
]
ALREADY_APPLIED_TEXT = [
    r"(you('ve| have)|you) already applied", r"already (submitted|applied) (an |your )?application",
    r"you have an application (in progress|on file) for this",
]
SUBMITTED_TEXT = [
    r"application (was |has been )?(successfully )?(submitted|received)", r"thank(s| you) for (applying|your application|submitting)",
    r"we('ve| have) received your application", r"you('ve| have) successfully applied", r"your application is (complete|submitted)",
]

# ---- CAPTCHA / bot checks (detected only, never solved) ----
CAPTCHA_FRAME_URLS = ["recaptcha/api2/bframe", "recaptcha/enterprise/bframe", "recaptcha/api2/anchor",
                      "recaptcha/enterprise/anchor", "hcaptcha.com", "challenges.cloudflare.com", "arkoselabs.com",
                      "funcaptcha.com"]
CAPTCHA_TEXT = [
    r"verify (that )?you('re| are) (a )?human", r"are you a robot", r"i'?m not a robot", r"press (and|&) hold",
    r"checking (if the site connection is secure|your browser)", r"complete the security (check|challenge)",
]
CAPTCHA_TITLES = [r"^just a moment", r"^attention required", r"^access denied"]
