"""inbox.py — finds the "verify your account" email after the runner creates an account,
so the link can be opened in the runner's browser (where the application tab is).

Reads your inbox over IMAP with an app password from .env (never your real password):

    IMAP_PASSWORD=abcd efgh ijkl mnop     # Gmail: myaccount.google.com/apppasswords
    IMAP_USER=you@gmail.com               # optional, defaults to the profile email
    IMAP_HOST=imap.gmail.com              # optional, guessed from the email address

Read-only: messages are opened with BODY.PEEK (they stay unread) and nothing is deleted.
Only links on the job site's own host (or a Workday host) are ever returned.
"""
import email
import email.header
import email.utils
import html
import imaplib
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import page_selectors as P

log = logging.getLogger("runner")

HOSTS = {
    "gmail.com": "imap.gmail.com", "googlemail.com": "imap.gmail.com",
    "outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com", "live.com": "outlook.office365.com",
    "msn.com": "outlook.office365.com", "yahoo.com": "imap.mail.yahoo.com", "icloud.com": "imap.mail.me.com",
    "me.com": "imap.mail.me.com", "aol.com": "imap.aol.com",
}
# Spam folders are checked too: verification emails often land there.
FOLDERS = ["INBOX", "[Gmail]/Spam", "Junk", "Spam", "Junk Email"]
_URL = re.compile(r"https?://[^\s\"'<>()\]]+")
_VERIFY_PATH = re.compile(r"activat|verif|confirm|validat", re.I)
_SUBJECT = re.compile(r"verif|activat|confirm|account|welcome|candidate home", re.I)
_WORKDAY = re.compile(P.WORKDAY_HOST, re.I)


def verify_links(msg_text, allowed_hosts):
    """Verification-looking links in a message whose host is allowed."""
    out = []
    for raw in _URL.findall(html.unescape(msg_text)):
        url = raw.rstrip(".,;")
        host = (urlparse(url).hostname or "").lower()
        if not (host in allowed_hosts or _WORKDAY.search(host)):
            continue
        if _VERIFY_PATH.search(urlparse(url).path + "?" + urlparse(url).query) and url not in out:
            out.append(url)
    return out


def _body(msg):
    parts = []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_type() in ("text/plain", "text/html"):
            try:
                parts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace"))
            except Exception:
                pass
    return "\n".join(parts)


class Mailbox:
    def __init__(self, cfg, address):
        self.enabled = bool(cfg.get("verify_email", {}).get("auto", True))
        self.user = os.environ.get("IMAP_USER", "").strip() or address
        self.password = os.environ.get("IMAP_PASSWORD", "").strip()
        domain = self.user.rsplit("@", 1)[-1].lower()
        self.host = os.environ.get("IMAP_HOST", "").strip() or HOSTS.get(domain, f"imap.{domain}")
        self.ready = self.enabled and bool(self.password)

    def find_link(self, since, allowed_hosts):
        """Newest verification link received after `since` (aware datetime), or None."""
        if not self.ready:
            return None
        try:
            box = imaplib.IMAP4_SSL(self.host, timeout=20)
        except TypeError:  # Python < 3.9
            box = imaplib.IMAP4_SSL(self.host)
        except OSError as e:
            log.warning("Email check: can't reach %s (%s)", self.host, e)
            return None
        try:
            box.login(self.user, self.password)
        except imaplib.IMAP4.error as e:
            log.warning("Email check: login failed for %s (%s). Use an app password in IMAP_PASSWORD.", self.user, e)
            self.ready = False
            box.logout()
            return None
        try:
            for folder in FOLDERS:
                link = self._search(box, folder, since, allowed_hosts)
                if link:
                    return link
        finally:
            try:
                box.logout()
            except Exception:
                pass
        return None

    def _search(self, box, folder, since, hosts):
        try:
            if box.select(f'"{folder}"', readonly=True)[0] != "OK":
                return None
            day = (since - timedelta(days=1)).strftime("%d-%b-%Y")
            typ, data = box.search(None, "SINCE", day)
        except imaplib.IMAP4.error:
            return None
        if typ != "OK" or not data or not data[0]:
            return None
        for num in reversed(data[0].split()[-25:]):  # newest first
            typ, got = box.fetch(num, "(BODY.PEEK[])")
            if typ != "OK" or not got or not isinstance(got[0], tuple):
                continue
            msg = email.message_from_bytes(got[0][1])
            try:
                when = email.utils.parsedate_to_datetime(msg.get("Date"))
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
            if when < since - timedelta(minutes=2):
                continue
            subject = str(email.header.make_header(email.header.decode_header(msg.get("Subject", ""))))
            if not _SUBJECT.search(subject):
                continue
            links = verify_links(_body(msg), hosts)
            if links:
                log.info("  found the verification email (%s)", subject[:80])
                return links[0]
        return None


def now():
    return datetime.now(timezone.utc)
