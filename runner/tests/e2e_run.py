"""Runs apply.py for the end-to-end test with a fake inbox: the "verification email" for the
mock gamma tenant links to its /?activate=1 page. Everything else is the real runner."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import inbox  # noqa: E402
import tabs  # noqa: E402


class FakeMailbox:
    def __init__(self, cfg, address):
        self.ready, self.user, self.host = True, address, "fake inbox"

    def find_link(self, since, hosts):
        host = next(iter(hosts), "")
        return f"http://{host}/?activate=1" if host.startswith("gamma.") else None


inbox.Mailbox = FakeMailbox
tabs.MAIL_EVERY_S = 2

import apply  # noqa: E402

sys.exit(apply.main())
