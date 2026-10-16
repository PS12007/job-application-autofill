"""tabs.py — the tabs left open for you, and the watcher that checks them:

- a tab showing the "application submitted" page → Submitted, tab closed
- a CAPTCHA / sign-in / verify-email tab that reaches the form → filling resumes
- an "unanswered questions" tab that you take to Review → Ready to submit
- a tab you close → forgotten (its status stays as it was)

It also enforces --max-tabs: the next link waits until a tab is submitted or closed.
"""
import logging
import time
from dataclasses import dataclass, field

from playwright.sync_api import Error, Page

import gate
import status as S
from flow import BrowserClosed

log = logging.getLogger("runner")
CHECK_EVERY_S = 3


@dataclass
class Tracked:
    page: Page
    row: object
    checked: float = field(default=0.0)


class Tabs:
    def __init__(self, br, sheet, runner, notify, max_tabs, resume_after_fix=True):
        self.br = br
        self.sheet = sheet
        self.runner = runner
        self.notify = notify
        self.max_tabs = max(1, max_tabs)
        self.resume_after_fix = resume_after_fix
        self.tracked = []

    def track(self, page, row):
        self.tracked.append(Tracked(page, row, time.monotonic()))

    # ------------------------------------------------------------ waiting

    def idle(self, seconds):
        """Wait while watching the open tabs."""
        end = time.monotonic() + seconds
        while True:
            self.poll()
            left = end - time.monotonic()
            if left <= 0:
                return
            self._pump(min(left, 1.0))

    def wait_for_slot(self):
        if len(self.tracked) >= self.max_tabs:
            log.info("%d tabs are waiting for you. The next link opens when you submit or close one.",
                     len(self.tracked))
        while len(self.tracked) >= self.max_tabs:
            self.idle(1)

    def wait_all(self):
        if self.tracked:
            log.info("Watching %d open tab(s) until each is submitted or closed. Ctrl+C to stop.", len(self.tracked))
        while self.tracked:
            self.idle(1)

    def _pump(self, seconds):
        """Sleep inside Playwright so browser events (closed tabs, …) are processed."""
        if self.br.closed:
            raise BrowserClosed()
        try:
            self.br.ext_page().wait_for_timeout(seconds * 1000)
        except Error:
            if self.br.closed:
                raise BrowserClosed()

    # ------------------------------------------------------------ watching

    def poll(self):
        if self.br.closed:
            raise BrowserClosed()
        now = time.monotonic()
        for t in list(self.tracked):
            if t.page.is_closed():
                self.tracked.remove(t)
                log.info("Row %s (%s): tab closed (status stays %s)", t.row.num, t.row.name, t.row.status)
                continue
            if now - t.checked < CHECK_EVERY_S:
                continue
            try:
                self._check(t)
            except BrowserClosed:
                raise
            except Error:
                pass  # tab navigating or closing; try again next time
            t.checked = time.monotonic()

    def _check(self, t):
        page, row = t.page, t.row
        if gate.submitted(page):
            self.sheet.update(row, S.SUBMITTED)
            log.info("Row %s (%s): Submitted", row.num, row.name)
            self.tracked.remove(t)
            page.close()
            return

        if row.status in S.GATED and self.resume_after_fix:
            state = gate.classify(page, self.br)
            unblocked = state == "form" or (row.status == S.NEEDS_CAPTCHA and state not in ("captcha", "unknown"))
            if unblocked:
                log.info("Row %s (%s): you got past %s, continuing", row.num, row.name, row.status.split(": ")[-1])
                out, new_page = self.runner.resume(page, row, from_gate=state != "form")
                t.page = new_page
                self.report(row, out)
                if not out.keep_open:
                    self.tracked.remove(t)
                    new_page.close()
            return

        if row.status == S.NEEDS_ANSWERS and gate.on_review(page, self.br):
            self.sheet.update(row, S.READY, "You finished the questions; check it, then submit.")
            self.notify(f"Ready to submit: {row.name}", f"Row {row.num}")
            log.info("Row %s (%s): reached Review, Ready to submit", row.num, row.name)

    def report(self, row, out):
        """Write an outcome to the sheet and notify when it needs you."""
        self.sheet.update(row, out.status, out.notes)
        log.info("Row %s (%s): %s%s", row.num, row.name, out.status, f" — {out.notes}" if out.notes else "")
        if out.status in S.WAITING:
            self.notify(f"{out.status}: {row.name}", out.notes or f"Row {row.num}")
