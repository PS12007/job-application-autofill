"""browser.py — the visible Chromium window, with a persistent profile and the extension.

Uses Playwright's bundled Chromium: Google Chrome no longer allows loading an unpacked
extension from the command line. Logins and cookies persist in browser.user_data_dir.

The first tab is the extension's own "runner" page. The runner writes commands and your
profile into the extension's storage from there (web pages can't touch that storage).
"""
import logging

from playwright.sync_api import Error

from config import HERE, path

log = logging.getLogger("runner")
EXT_ID_FILE = HERE / ".runner-ext-id"
RUNNER_PAGE = "src/runner/runner.html"


class Browser:
    def __init__(self, ctx, ext_id):
        self.ctx = ctx
        self.ext_id = ext_id
        self.closed = False
        self.home = None
        self._resume_key = None
        ctx.on("close", lambda _: setattr(self, "closed", True))

    @property
    def runner_url(self):
        return f"chrome-extension://{self.ext_id}/{RUNNER_PAGE}"

    def ext_page(self):
        """The extension's runner tab (reopened if you closed it)."""
        if self.home is None or self.home.is_closed():
            self.home = next((p for p in self.ctx.pages if p.url.startswith(self.runner_url)), None)
        if self.home is None:
            blank = next((p for p in self.ctx.pages if p.url == "about:blank"), None)
            self.home = blank or self.ctx.new_page()
            self.home.goto(self.runner_url)
        return self.home

    def store(self, data):
        """chrome.storage.local.set(data), from the extension's own page."""
        self.ext_page().evaluate("d => chrome.storage.local.set(d)", data)

    def update_profile(self, fields):
        """Merge fields into the extension's stored profile."""
        self.ext_page().evaluate(
            """async f => {
                const { profile } = await chrome.storage.local.get('profile');
                await chrome.storage.local.set({ profile: { ...(profile || {}), ...f } });
            }""",
            fields,
        )

    def set_files(self, key, resume, cover_letter=None):
        """Swap the resume / cover letter the extension uploads (no-op if unchanged)."""
        if key == self._resume_key:
            return
        self.update_profile({"resume": resume, "coverLetter": cover_letter})
        self._resume_key = key


def _extension_id(ctx):
    is_ext = lambda w: w.url.startswith("chrome-extension://")
    worker = next((w for w in ctx.service_workers if is_ext(w)), None)
    if worker is None:
        worker = ctx.wait_for_event("serviceworker", predicate=is_ext, timeout=20000)
    return worker.url.split("/")[2]


def launch(pw, cfg, profile=None, debug=False):
    ext = path(cfg["browser"]["extension_dir"])
    if not (ext / "manifest.json").exists():
        raise SystemExit(f"Extension not found at {ext} (browser.extension_dir in config.yaml).")
    args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}"]
    args += [str(a) for a in cfg["browser"].get("extra_args") or []]
    if cfg["browser"].get("debug_port"):
        args.append(f"--remote-debugging-port={int(cfg['browser']['debug_port'])}")
    try:
        ctx = pw.chromium.launch_persistent_context(
            str(path(cfg["browser"]["user_data_dir"])), headless=False, args=args, no_viewport=True
        )
    except Error as e:
        if "ProcessSingleton" in str(e) or "already in use" in str(e):
            raise SystemExit("The runner's browser profile is already open. Close that window (or the other "
                             "apply.py / dump_fields.py) first.")
        raise

    br = Browser(ctx, _extension_id(ctx))
    EXT_ID_FILE.write_text(br.ext_id, encoding="utf-8")
    # Clear commands left over from an earlier run, then load your profile.
    br.ext_page().evaluate("""async () => {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('runnerCmd_') || k === 'runnerToken'));
    }""")
    if profile:
        br.store({"profile": profile})
        br._resume_key = "default"

    if debug:
        def attach(page):
            page.on("console", lambda m: "WD-Autofill" in m.text and log.debug("page: %s", m.text.replace("%c", "")))
        for p in ctx.pages:
            attach(p)
        ctx.on("page", attach)
    return br


def attach(ctx):
    """A Browser for a window apply.py already opened (dump_fields.py)."""
    ext_id = next((p.url.split("/")[2] for p in ctx.pages if RUNNER_PAGE in p.url), None)
    if not ext_id and EXT_ID_FILE.exists():
        ext_id = EXT_ID_FILE.read_text(encoding="utf-8").strip()
    if not ext_id:
        raise SystemExit("Couldn't find the extension in the open browser.")
    return Browser(ctx, ext_id)
