"""dump_fields.py — dump every visible field on the current step as JSON (tag, type,
data-automation-id, label, value, aria attributes, buttons, headings), for pasting back
when selectors break.

    python dump_fields.py          attach to the browser apply.py opened and dump the tab you're on
    python dump_fields.py URL      same, but open URL first (or, if apply.py isn't running,
                                   open the runner's browser at URL and dump each time you press Enter)

Saved to logs/dump_<time>.json as well as printed.
"""
import json
import sys
from datetime import datetime

from playwright.sync_api import Error, sync_playwright

import bridge
import config
import browser
from config import path


def dump(page, br):
    best = bridge.best_frame(page, br)
    if not best:
        print("The extension isn't running on this page (is it an http(s) page that finished loading?).")
        return
    frame, _ = best
    res = bridge.call(frame, br, "dump", timeout_s=20)
    if res.get("error"):
        print("Dump failed:", res["error"])
        return
    out = res["json"]
    # The form may live in an iframe: note which page / frame was dumped.
    head = {"url": page.url, "frame": frame.url if frame != page.main_frame else "main"}
    text = f"// {json.dumps(head)}\n{out}"
    folder = path("logs")
    folder.mkdir(exist_ok=True)
    file = folder / f"dump_{datetime.now():%Y%m%d_%H%M%S}.json"
    file.write_text(text, encoding="utf-8")
    print(text)
    print(f"\nSaved to {file} ({res.get('count', 0)} fields)")


def current_tab(ctx):
    """The tab you're looking at: visible and focused if possible, else the newest."""
    pages = [p for p in ctx.pages if p.url.startswith("http")]
    scored = []
    for p in pages:
        try:
            s = p.evaluate("() => (document.visibilityState === 'visible' ? 1 : 0) + (document.hasFocus() ? 2 : 0)")
        except Error:
            s = -1
        scored.append((s, p))
    return max(scored, key=lambda x: x[0])[1] if scored else None


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else ""
    cfg = config.load()
    port = cfg["browser"].get("debug_port")
    with sync_playwright() as pw:
        b = None
        if port:
            try:
                b = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{int(port)}", timeout=3000)
            except Error:
                pass  # apply.py isn't running: open the browser ourselves
        if b:
            ctx = b.contexts[0]
            br = browser.attach(ctx)
            if url:
                page = ctx.new_page()
                page.goto(url, wait_until="load")
                bridge.wait_for_bridge(page)
            else:
                page = current_tab(ctx)
            if not page:
                print("No web page is open in the runner's browser.")
                return
            try:
                dump(page, br)
            except Error as e:
                print("Dump failed:", str(e).splitlines()[0])
            return

        br = browser.launch(pw, cfg)
        page = br.ctx.new_page()
        if url:
            page.goto(url, wait_until="load")
        print("Browser open. Go to the step you want (sign in if needed).")
        while True:
            ans = input("Press Enter to dump the current tab, or q + Enter to quit: ").strip().lower()
            if ans == "q":
                break
            page = current_tab(br.ctx) or page
            try:
                dump(page, br)
            except Error as e:
                print("Dump failed:", str(e).splitlines()[0])
        br.ctx.close()


if __name__ == "__main__":
    main()
