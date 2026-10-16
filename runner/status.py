"""status.py — the Status values written to the sheet, and which ones are skipped."""

QUEUED = "Queued"
IN_PROGRESS = "In progress"
READY = "Ready to submit"
NEEDS_CAPTCHA = "Needs you: CAPTCHA"
NEEDS_VERIFY = "Needs you: verify email"
NEEDS_SIGNIN = "Needs you: sign in"
NEEDS_ANSWERS = "Needs you: unanswered questions"
SUBMITTED = "Submitted"
ALREADY = "Already applied"
CLOSED = "Posting closed"
FAILED = "Failed"
DRY_RUN = "Dry run"  # only shown in the summary; never written

ALL = [QUEUED, IN_PROGRESS, READY, NEEDS_CAPTCHA, NEEDS_VERIFY, NEEDS_SIGNIN, NEEDS_ANSWERS,
       SUBMITTED, ALREADY, CLOSED, FAILED]

NEEDS_YOU = {NEEDS_CAPTCHA, NEEDS_VERIFY, NEEDS_SIGNIN, NEEDS_ANSWERS}
# A tab with one of these stays open for you (and counts toward --max-tabs).
WAITING = {READY} | NEEDS_YOU
# Stuck before the form: the watcher resumes filling once you get past it.
GATED = {NEEDS_CAPTCHA, NEEDS_VERIFY, NEEDS_SIGNIN}
# Skipped unless --force.
DONE = {SUBMITTED, READY, ALREADY, CLOSED}
# Processed by default (besides blank).
TODO = {QUEUED, IN_PROGRESS} | NEEDS_YOU


def canonical(text):
    """Map sheet text to a known status, ignoring case and spacing ("" for blank)."""
    t = " ".join(str(text or "").split()).lower()
    if not t:
        return ""
    for s in ALL:
        if s.lower() == t:
            return s
    return str(text).strip()
