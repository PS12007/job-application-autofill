from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime

import inbox
from inbox import Mailbox, verify_links

HOST = "acme.wd5.myworkdayjobs.com"


def test_verify_links_only_from_allowed_hosts():
    text = (f'<a href="https://{HOST}/en-US/Careers/activate/abc123?redirect=x&amp;y=1">Verify</a> '
            "https://evil.example.com/verify/123 https://other.wd1.myworkdayjobs.com/x/activate/9 "
            f"https://{HOST}/en-US/Careers/privacy")
    assert verify_links(text, {HOST}) == [
        f"https://{HOST}/en-US/Careers/activate/abc123?redirect=x&y=1",
        "https://other.wd1.myworkdayjobs.com/x/activate/9",
    ]


def mail(subject, body, when):
    m = EmailMessage()
    m["Subject"], m["From"], m["Date"] = subject, "noreply@myworkday.com", format_datetime(when)
    m.set_content(body)
    return m.as_bytes()


class FakeIMAP:
    messages = {}
    logins = []

    def __init__(self, host, timeout=None):
        self.host = host

    def login(self, user, pw):
        FakeIMAP.logins.append((self.host, user, pw))

    def select(self, folder, readonly=False):
        assert readonly
        self.folder = folder.strip('"')
        return ("OK", [b"1"]) if self.folder in self.messages else ("NO", [b""])

    def search(self, charset, *crit):
        n = len(self.messages[self.folder])
        return "OK", [" ".join(str(i + 1) for i in range(n)).encode()]

    def fetch(self, num, what):
        assert "PEEK" in what  # never marks mail as read
        return "OK", [(b"1", self.messages[self.folder][int(num) - 1])]

    def logout(self):
        pass


def test_find_link(monkeypatch):
    monkeypatch.setattr(inbox.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setenv("IMAP_PASSWORD", "app-pass")
    monkeypatch.delenv("IMAP_USER", raising=False)
    monkeypatch.delenv("IMAP_HOST", raising=False)
    since = datetime.now(timezone.utc)
    old = since - timedelta(hours=3)
    FakeIMAP.messages = {
        "INBOX": [
            mail("Verify your account", f"https://{HOST}/Careers/activate/OLD", old),  # before the account existed
            mail("Your weekly digest", f"https://{HOST}/Careers/activate/NOPE", since),  # not a verification email
        ],
        "[Gmail]/Spam": [mail("Please verify your candidate account", f"Click https://{HOST}/Careers/activate/NEW", since)],
    }
    box = Mailbox({"verify_email": {"auto": True}}, "me@gmail.com")
    assert box.ready and box.host == "imap.gmail.com"
    assert box.find_link(since, {HOST}) == f"https://{HOST}/Careers/activate/NEW"
    assert FakeIMAP.logins[-1] == ("imap.gmail.com", "me@gmail.com", "app-pass")


def test_disabled_without_password(monkeypatch):
    monkeypatch.delenv("IMAP_PASSWORD", raising=False)
    assert not Mailbox({}, "me@gmail.com").ready
    monkeypatch.setenv("IMAP_PASSWORD", "x")
    assert not Mailbox({"verify_email": {"auto": False}}, "me@gmail.com").ready
