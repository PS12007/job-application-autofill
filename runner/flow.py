"""flow.py — one application: open the link, get past the job page and sign-in, let the
extension fill and advance, and decide the row's status. Never clicks Submit.
"""
import logging
import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from playwright.sync_api import Error
from playwright.sync_api import TimeoutError as PWTimeout

import bridge
import gate
import page_selectors as P
import status as S
from config import path
from inbox import now

log = logging.getLogger("runner")


class BrowserClosed(Exception):
    pass


class AppTimeout(Exception):
    pass


@dataclass
class Outcome:
    status: str
    notes: str = ""
    keep_open: bool = True
    retry: bool = True  # a Failed outcome worth one more try (not timeouts)


class Deadline:
    def __init__(self, seconds):
        self.end = time.monotonic() + seconds
        self.seconds = seconds

    def left(self):
        return max(0, int(self.end - time.monotonic()))

    def check(self, where):
        if time.monotonic() > self.end:
            raise AppTimeout(f"Timed out after {self.seconds}s {where}")


def _short(e, n=200):
    s = " ".join(str(e).split("Call log:")[0].split())
    return s if len(s) <= n else s[: n - 1] + "…"


def tenant(url):
    """The company part of a Workday host (acme.wd5.myworkdayjobs.com -> acme), else the host."""
    import precheck

    p = precheck.parse(url)
    host = (urlparse(url).hostname or "").lower()
    return p.tenant if p else host.split(".")[0] if gate.WORKDAY_RX.search(host) else host


def settle(page, timeout_s=15):
    try:
        page.wait_for_load_state("load", timeout=timeout_s * 1000)
    except Error:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except Error:
        pass


class Runner:
    def __init__(self, cfg, br, email, password, picker=None, dry_run=False, debug=False,
                 bank=None, gap=None, default_resume=None, own_answers=None):
        self.cfg = cfg
        self.picker = picker
        self.bank = bank  # questions.QuestionBank: unanswered questions, and your answers to them
        self.gap = gap  # ats.KeywordGap
        self.default_resume = default_resume
        self.own_answers = own_answers or []
        self.files = {}  # row number -> (track name, resume, cover letter) chosen for it
        self.tags = {}  # row number -> "[resume: ml; 80% keyword match, …]" kept at the front of Notes
        self.verify_since = {}  # row number -> when its account was created (for the email check)
        self.br = br
        self.email = email
        self.password = password
        self.dry_run = dry_run
        self.debug = debug
        self.run_cfg = cfg["run"]
        self.row = None
        self.applied = set()  # tenants (company Workday sites) with a Submitted row

    # ------------------------------------------------------------ entry points

    def process(self, page, row):
        """Run one row from scratch. Returns (Outcome, page) — the page may be a new tab."""
        self.page, self.row = page, row
        deadline = Deadline(int(self.run_cfg["app_timeout_s"]))
        try:
            self.sync_answers()
            page.goto(row.link, wait_until="domcontentloaded", timeout=60000)
            settle(page)
            self.choose_resume(row)
            out = self.gate(deadline) or self.fill(deadline)
        except AppTimeout as e:
            out = Outcome(S.FAILED, str(e), retry=False)
        except Exception as e:  # one failure must never stop the run
            if self.br.closed:
                raise BrowserClosed() from e
            log.debug("row %s error", row.num, exc_info=True)
            if self.page.is_closed():
                return Outcome(S.QUEUED, "The tab was closed while it was being filled.", keep_open=False), self.page
            out = Outcome(S.FAILED, _short(e))
        return self.finish(out, row), self.page

    def resume(self, page, row, from_gate=False, restart=False):
        """Watcher: continue a tab you unblocked (CAPTCHA solved / signed in / verified).
        restart: open the job link again first (after the account was verified)."""
        self.page, self.row = page, row
        deadline = Deadline(int(self.run_cfg["app_timeout_s"]))
        try:
            self.sync_answers()
            if row.num in self.files:
                self.br.set_files(*self.files[row.num])
            if restart:
                page.goto(row.link, wait_until="domcontentloaded", timeout=60000)
                settle(page)
            out = (self.gate(deadline) if from_gate or restart else None) or self.fill(deadline)
        except AppTimeout as e:
            out = Outcome(S.FAILED, str(e), retry=False)
        except Exception as e:
            if self.br.closed:
                raise BrowserClosed() from e
            out = Outcome(S.FAILED, _short(e))
        return self.finish(out, row), self.page

    def sync_answers(self):
        """Send answers you typed into questions.yaml to the extension (also mid-run)."""
        if self.bank and self.bank.changed():
            from questions import merged_answers

            self.br.update_profile({"savedAnswers": merged_answers(self.own_answers, self.bank)})
            log.info("Loaded %d answer(s) from %s", len(self.bank.answers()), self.bank.file.name)

    def choose_resume(self, row):
        """Pick the resume (and cover letter) for this job from its title / description."""
        picking = bool(self.picker and (self.picker.enabled or row.resume))
        if not picking and not self.gap:
            return
        job = row.job
        if job and job.description:
            title, desc = job.title, job.description
        else:
            title, desc = gate.job_info(self.page)
        title = row.role or title  # your Role column is the most reliable title
        name, resume = "default", self.default_resume
        if picking:
            name, resume = self.picker.pick(title, desc, row.resume)
        cover = self.picker.cover_letter(name) if self.picker else None
        if resume:
            self.br.set_files(name, resume, cover)
            self.files[row.num] = (name, resume, cover)
        parts = [f"resume: {name}"] if name != "default" else []
        if self.gap and resume:
            gap = self.gap.note(title, desc, resume)
            if gap:
                parts.append(gap)
        self.tags[row.num] = f"[{'; '.join(parts)}]" if parts else ""

    def applied_before(self, page):
        return tenant(page.url) in self.applied

    def tag(self, row, notes=""):
        """Notes with this row's resume / keyword tag in front."""
        return " ".join(x for x in (self.tags.get(row.num, ""), notes) if x)

    def finish(self, out, row):
        if out.status not in (S.CLOSED, S.ALREADY):
            out.notes = self.tag(row, out.notes)
        if out.status == S.FAILED:
            shot = self.screenshot(row)
            if shot:
                out.notes = f"{out.notes} | screenshot: {shot}"
            out.keep_open = bool(self.run_cfg["keep_failed_tabs"])
        if len(out.notes) > 1500:
            out.notes = out.notes[:1499] + "…"
        return out

    def screenshot(self, row):
        folder = path("screenshots")
        folder.mkdir(exist_ok=True)
        name = re.sub(r"[^\w-]+", "_", row.company or row.row_id or "row").strip("_")[:40] or "row"
        file = folder / f"{row.num}_{name}.png"
        try:
            self.page.screenshot(path=str(file), full_page=True, timeout=15000)
            return str(file.relative_to(path(".")))
        except Exception:
            return ""

    # ------------------------------------------------------------ before the form

    def gate(self, deadline):
        """Get to the application form. Returns an Outcome to stop, or None at the form."""
        page, br = self.page, self.br
        tried_signin = tried_create = False
        apply_clicks = email_clicks = 0
        chose = False
        while True:
            deadline.check("before the application form")
            state = gate.classify(page, br)
            log.debug("page state: %s (%s)", state, page.url)

            if state == "captcha":
                # Let auto-passing checks (e.g. Cloudflare "Just a moment") finish first.
                state = gate.wait_change(page, br, "captcha", timeout_s=12)
                if state == "captcha":
                    return Outcome(S.NEEDS_CAPTCHA, gate.captcha(page) or "CAPTCHA")
                continue
            if state == "form":
                return None
            if state == "closed":
                return Outcome(S.CLOSED, keep_open=False)
            if state == "already":
                return Outcome(S.ALREADY, keep_open=False)
            if state == "twofa":
                return Outcome(S.NEEDS_SIGNIN, "A verification code / two-factor step is waiting.")
            if state == "verify":
                return Outcome(S.NEEDS_VERIFY, "Verify the account from your email, then sign in in this tab.")

            if state == "apply":
                if apply_clicks >= 3:
                    return Outcome(S.FAILED, "Clicking Apply didn't open the application.")
                apply_clicks += 1
                self.click_apply()
                page = self.page
                gate.wait_change(page, br, "apply")
                continue

            if state == "choose":
                if chose:
                    return Outcome(S.FAILED, "The apply-mode choice didn't go away.")
                chose = True
                mode = self.run_cfg["apply_mode"]
                btn = None
                if mode == "auto":
                    # Workday offers "Use My Last Application" even where you never applied, so
                    # only use it for companies with a Submitted row in your sheet.
                    if self.applied_before(page):
                        btn = gate.find_clickable(page, P.APPLY_MODES["last"])
                    mode = "last" if btn else "manual"
                btn = btn or gate.find_clickable(page, P.APPLY_MODES.get(mode, P.APPLY_MODES["manual"]))
                if not btn:
                    return Outcome(S.FAILED, f'Couldn\'t find the "{mode}" apply option.')
                gate.click(btn, f"apply mode: {mode}")
                gate.wait_change(page, br, "choose")
                continue

            if state == "signin_choice":  # "Sign in with Google / LinkedIn / email": always email
                if not self.password:
                    return Outcome(S.NEEDS_SIGNIN, "No WORKDAY_PASSWORD in runner/.env.")
                if email_clicks >= 2:
                    return Outcome(S.FAILED, '"Sign in with email" didn\'t open the sign-in form.')
                email_clicks += 1
                gate.click(gate.find_clickable(page, P.SIGN_IN_WITH_EMAIL), "sign in with email")
                gate.wait_change(page, br, "signin_choice")
                continue

            if state == "signin":
                if not self.password:
                    return Outcome(S.NEEDS_SIGNIN, "No WORKDAY_PASSWORD in runner/.env.")
                if tried_signin:
                    err = gate.errors_text(page)
                    link = gate.find_clickable(page, P.CREATE_ACCOUNT_LINK)
                    if not tried_create and link and (not err or gate.SIGNIN_FAILED_RX.search(err)):
                        log.info("  sign-in didn't work; trying to create an account")
                        gate.click(link, "create account link")
                        gate.wait_change(page, br, "signin")
                        continue
                    return Outcome(S.NEEDS_SIGNIN, f"Sign-in failed: {err or 'still on the sign-in page'}")
                tried_signin = True
                log.info("  signing in as %s", self.email)
                self.sign_in()
                gate.wait_change(page, br, "signin", watch_errors=True)
                continue

            if state == "create":
                if not self.password:
                    return Outcome(S.NEEDS_SIGNIN, "No WORKDAY_PASSWORD in runner/.env.")
                link = gate.find_clickable(page, P.SIGN_IN_LINK)
                if not tried_signin and link:
                    gate.click(link, "sign in link")  # an account may already exist: try that first
                    gate.wait_change(page, br, "create")
                    if gate.classify(page, br) in ("signin", "signin_choice"):
                        continue
                    tried_signin = True  # the link didn't lead to a sign-in form
                    continue
                if tried_create:
                    err = gate.errors_text(page)
                    if err and gate.EXISTS_RX.search(err):
                        return Outcome(S.NEEDS_SIGNIN, "An account exists but sign-in failed (different password?).")
                    return Outcome(S.NEEDS_SIGNIN, f"Account creation didn't finish: {err or 'still on the form'}")
                if self.dry_run:
                    return Outcome(S.DRY_RUN, "Would create an account here (skipped in dry run).")
                tried_create = True
                log.info("  creating an account for %s", self.email)
                self.verify_since[self.row.num] = now()
                self.create_account()
                gate.wait_change(page, br, "create", watch_errors=True)
                continue

            # unknown: the page may still be loading
            state = gate.wait_change(page, br, "unknown", timeout_s=15)
            if state == "unknown":
                return Outcome(S.FAILED, "Couldn't find an Apply button or the application form.")

    def click_apply(self):
        page = self.page
        btn = gate.find_clickable(page, P.APPLY)
        try:
            with page.context.expect_page(timeout=4000) as new:
                gate.click(btn, "Apply")
            new_page = new.value
        except Error:
            return  # stayed in this tab
        log.info("  the application opened in a new tab")
        settle(new_page)
        try:
            page.close()
        except Error:
            pass
        self.page = new_page

    def sign_in(self):
        page = self.page
        email = gate.first_visible(page, P.EMAIL)
        pw = gate.first_visible(page, P.PASSWORD)
        if email:
            gate.type_into(email, self.email)
        gate.type_into(pw, self.password)
        btn = gate.find_clickable(page, P.SIGN_IN_SUBMIT)
        if btn:
            gate.click(btn, "sign in")
        else:
            pw.press("Enter")

    def create_account(self):
        page = self.page
        gate.type_into(gate.first_visible(page, P.EMAIL), self.email)
        gate.type_into(gate.first_visible(page, P.PASSWORD), self.password)
        gate.type_into(gate.first_visible(page, P.VERIFY_PASSWORD), self.password)
        # Only the required consent box; marketing / other opt-ins stay unticked.
        boxes = [gate.first_visible(page, P.CREATE_ACCOUNT_CHECKBOX)]
        req = page.locator('input[type="checkbox"][aria-required="true"], input[type="checkbox"][required]')
        boxes += [req.nth(i) for i in range(min(req.count(), 3))]
        for box in boxes:
            try:
                if box and not box.is_checked():
                    box.check(timeout=5000, force=True)
            except Error:
                log.debug("could not tick a required checkbox", exc_info=True)
        gate.click(gate.find_clickable(page, P.CREATE_ACCOUNT_SUBMIT), "create account")

    # ------------------------------------------------------------ the form

    def fill(self, deadline):
        """Let the extension fill (and, unless dry run, advance) until it stops."""
        overrides = {
            "autoAdvance": not self.dry_run,
            "overwrite": bool(self.run_cfg["overwrite_existing"]),
            "debug": self.debug,
        }
        for _ in range(8):  # full page loads (some non-Workday forms) restart the fill
            deadline.check("while filling")
            page = self.page
            bridge.wait_for_bridge(page)
            best = bridge.best_frame(page, self.br)
            if not best:
                return Outcome(S.FAILED, "The extension isn't running on this page.")
            frame, ping = best
            log.info("  filling (%s, %s)", ping.get("site"), (ping.get("step") or {}).get("label"))
            try:
                res = bridge.call(frame, self.br, "fill", timeout_s=deadline.left(), overrides=overrides)
            except PWTimeout as e:
                raise AppTimeout(f"Timed out after {deadline.seconds}s while filling") from e
            except Error:
                log.info("  the page reloaded during the fill; continuing")
                settle(page)
                if gate.captcha(page):
                    return Outcome(S.NEEDS_CAPTCHA, gate.captcha(page) + " (form partly filled)")
                continue
            if res.get("error"):
                return Outcome(S.FAILED, f"Extension error: {res['error']}")
            out = self.interpret(res.get("result") or {}, ping.get("site"))
            if out.status != S.FAILED:
                why = gate.captcha(page)
                if why and out.status != S.DRY_RUN:
                    return Outcome(S.NEEDS_CAPTCHA, f"{why} ({out.status.lower()} otherwise)")
            return out
        return Outcome(S.FAILED, "The page kept reloading during the fill.")

    def interpret(self, r, site):
        if r.get("error"):
            return Outcome(S.FAILED, f"Extension error: {r['error']}")
        details = r.get("details") or []
        for d in details:
            log.debug("  field %-7s %s — %s", d.get("status"), d.get("field"), d.get("reason"))
        if self.bank and not self.dry_run:
            new = self.bank.record(details, self.row.name if self.row else "")
            if new:
                log.info("  %d new question(s) saved to %s: answer them there once", new, self.bank.file.name)
        note = r.get("note") or ""
        counts = f"filled {r.get('filled', 0)}, skipped {r.get('skipped', 0)}, failed {r.get('failed', 0)}"
        log.info("  %s: %s%s", r.get("step"), counts, f" — {note}" if note else "")

        if self.dry_run:
            return Outcome(S.DRY_RUN, f"{r.get('step')}: {counts}")
        if r.get("lastStep") == "review":
            return Outcome(S.READY)

        needs = []
        for d in details:
            if d.get("status") != "failed":
                continue
            reason = d.get("reason") or ""
            needs.append(d["field"] if reason == "required, needs your input" else f"{d['field']} ({reason})")
        if needs:
            return Outcome(S.NEEDS_ANSWERS, "; ".join(needs))
        if "page showed errors" in note:
            return Outcome(S.NEEDS_ANSWERS, note)
        single_page = site == "greenhouse" or (site == "generic" and "could not find the Next button" in note)
        if note.startswith("Stopped before") or single_page:
            return Outcome(S.READY, "One-page form: check it, then submit.")
        return Outcome(S.FAILED, note or "The fill stopped without reaching Review.")
