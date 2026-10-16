"""gate.py — reading the page outside the form: what state it's in (CAPTCHA, closed,
sign-in, …), plus the few clicks allowed before the form (Apply, apply mode, sign in,
create account). Selectors and patterns live in page_selectors.py.
"""
import logging
import re
from urllib.parse import urlparse

from playwright.sync_api import Error

import bridge
import page_selectors as P

log = logging.getLogger("runner")

_rx = lambda pats: re.compile("|".join(f"(?:{p})" for p in pats), re.I)
CLOSED_RX = _rx(P.POSTING_CLOSED_TEXT)
ALREADY_RX = _rx(P.ALREADY_APPLIED_TEXT)
SUBMITTED_RX = _rx(P.SUBMITTED_TEXT)
CAPTCHA_RX = _rx(P.CAPTCHA_TEXT)
CAPTCHA_TITLE_RX = _rx(P.CAPTCHA_TITLES)
VERIFY_RX = _rx(P.VERIFY_EMAIL_TEXT)
TWO_FA_RX = _rx(P.TWO_FACTOR_TEXT)
SIGNIN_FAILED_RX = _rx(P.SIGNIN_FAILED_TEXT)
EXISTS_RX = _rx(P.ACCOUNT_EXISTS_TEXT)
WORKDAY_RX = re.compile(P.WORKDAY_HOST, re.I)
NEVER_CLICK_RX = re.compile(r"\bsubmit\b", re.I)
ACCOUNT_STEP_RX = re.compile(P.ACCOUNT_STEP_TEXT, re.I)


def is_workday(page):
    return bool(WORKDAY_RX.search(urlparse(page.url).hostname or ""))


# ---------------------------------------------------------------- page reading

def page_text(page, limit=40000):
    """Visible text of the page and its frames."""
    parts = []
    for f in page.frames:
        if f != page.main_frame and not f.url.startswith("http"):
            continue
        try:
            parts.append((f.evaluate("() => document.body ? document.body.innerText : ''") or "")[:limit])
        except Error:
            pass
    return "\n".join(parts)


def first_visible(scope, selectors, limit=6):
    for sel in selectors:
        loc = scope.locator(sel)
        try:
            n = loc.count()
        except Error:
            continue
        for i in range(min(n, limit)):
            el = loc.nth(i)
            try:
                if el.is_visible() and not el.evaluate("(e, s) => e.matches(s)", P.HONEYPOT):
                    return el
            except Error:
                pass
    return None


def find_clickable(scope, target):
    """target = {"css": [...], "text": regex}; first visible match or None."""
    el = first_visible(scope, target.get("css", []))
    if el or not target.get("text"):
        return el
    loc = scope.locator(P.CLICKABLE).filter(has_text=re.compile(target["text"], re.I))
    try:
        n = loc.count()
    except Error:
        return None
    for i in range(min(n, 10)):
        el = loc.nth(i)
        try:
            if el.is_visible():
                return el
        except Error:
            pass
    return None


def captcha(page):
    """A short description of a visible CAPTCHA / bot check, or ''."""
    try:
        if CAPTCHA_TITLE_RX.search(page.title() or ""):
            return f'bot check page ("{page.title()}")'
    except Error:
        pass
    for f in page.frames:
        if f == page.main_frame or not any(u in f.url for u in P.CAPTCHA_FRAME_URLS):
            continue
        if "size=invisible" in f.url:
            continue  # invisible reCAPTCHA badge: nothing to solve
        try:
            el = f.frame_element()
            box = el.bounding_box()
            if el.is_visible() and box and box["width"] >= 40 and box["height"] >= 40 and box["y"] > -500:
                host = urlparse(f.url).hostname or "captcha"
                return f"CAPTCHA ({host})"
        except Error:
            pass
    m = CAPTCHA_RX.search(page_text(page, 8000))
    return f'"{m.group(0)}" on the page' if m else ""


def errors_text(page):
    out = []
    loc = page.locator(P.FORM_ERRORS)
    try:
        n = min(loc.count(), 10)
    except Error:
        return ""
    for i in range(n):
        try:
            el = loc.nth(i)
            if el.is_visible():
                t = " ".join((el.inner_text() or "").split())
                if t and t not in out and len(t) < 300:
                    out.append(t)
        except Error:
            pass
    return "; ".join(out)


def job_info(page):
    """(title, description) of the job posting, for picking a resume."""
    if is_workday(page):
        try:  # Workday renders the posting after the page loads
            page.wait_for_selector(P.JOB_DESCRIPTION[0], timeout=6000)
        except Error:
            pass
    title = ""
    el = first_visible(page, P.JOB_TITLE)
    try:
        title = el.inner_text(timeout=2000) if el else ""
        title = f"{title} {page.title()}"
    except Error:
        pass
    desc = ""
    el = first_visible(page, P.JOB_DESCRIPTION)
    try:
        desc = el.inner_text(timeout=3000)[:30000] if el else ""
    except Error:
        pass
    return " ".join(title.split()), desc


def account_step(page):
    """Workday's progress bar is already shown on the "Create Account/Sign In" step."""
    el = first_visible(page, [P.WORKDAY_ACTIVE_STEP])
    try:
        return bool(el and ACCOUNT_STEP_RX.search(el.inner_text(timeout=2000) or ""))
    except Error:
        return False


def classify(page, br):
    """One of: captcha, closed, already, form, twofa, verify, create, signin, signin_choice,
    choose, apply, unknown."""
    if captcha(page):
        return "captcha"
    workday = is_workday(page)
    text = page_text(page)
    password = first_visible(page, P.PASSWORD)

    if workday and first_visible(page, P.WORKDAY_FORM) and not password and not account_step(page):
        return "form"
    if not workday and not password:
        best = bridge.best_frame(page, br)
        if best and best[1].get("app"):
            return "form"
    if ALREADY_RX.search(text):
        return "already"
    if CLOSED_RX.search(text) and not password:
        return "closed"
    if TWO_FA_RX.search(text) and (password or first_visible(page, ['input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]'])):
        return "twofa"
    if VERIFY_RX.search(text) and not password:
        return "verify"
    if password:
        return "create" if first_visible(page, P.VERIFY_PASSWORD) else "signin"
    if find_clickable(page, P.SIGN_IN_WITH_EMAIL):
        return "signin_choice"
    if first_visible(page, P.APPLY_CHOOSER):
        return "choose"
    if find_clickable(page, P.APPLY):
        return "apply"
    return "unknown"


def submitted(page):
    return bool(SUBMITTED_RX.search(page_text(page, 20000)))


def on_review(page, br):
    best = bridge.best_frame(page, br)
    return bool(best and (best[1].get("step") or {}).get("key") == "review")


# ---------------------------------------------------------------- actions

def click(el, what):
    """Click with Workday's overlay quirk handled. Refuses anything that says Submit."""
    try:
        text = " ".join((el.inner_text(timeout=2000) or el.get_attribute("value") or "").split())
    except Error:
        text = ""
    if NEVER_CLICK_RX.search(text):
        raise RuntimeError(f'Refused to click "{text}"')
    log.debug("click %s (%s)", what, text or "no text")
    try:
        el.click(timeout=6000)
    except Error:
        # Workday lays a transparent "click_filter" div over some buttons.
        overlay = el.locator('xpath=..').locator('[data-automation-id="click_filter"]')
        if overlay.count():
            overlay.first.click(timeout=6000)
        else:
            el.click(timeout=6000, force=True)


def type_into(el, value):
    el.click(timeout=5000)
    el.fill(value)
    if el.input_value() != value:  # React re-render wiped it
        el.fill("")
        el.press_sequentially(value, delay=30)
    if el.input_value() != value:
        raise RuntimeError("could not type into a sign-in field")


def wait_change(page, br, before, timeout_s=25, watch_errors=False):
    """Poll until the state differs from `before` (or an error message shows)."""
    import time

    end = time.monotonic() + timeout_s
    state = before
    while time.monotonic() < end:
        page.wait_for_timeout(700)
        state = classify(page, br)
        if state != before:
            return state
        if watch_errors and errors_text(page):
            return state
    return state
