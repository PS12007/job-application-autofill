"""apply.py — work through the job links in the sheet, autofill each application with the
extension, and leave each one open on Review for you to submit by hand.

    python apply.py [--start ROW] [--count N] [--max-tabs N] [--redo-failed] [--force]
                    [--dry-run] [--debug]

It never clicks Submit and never solves CAPTCHAs. See README.md.
"""
import argparse
import logging
import sys
from collections import Counter
from datetime import datetime

import config
import status as S
import userprofile
from config import path
from sheet import open_sheet

log = logging.getLogger("runner")


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Autofill job applications from a sheet; you submit each one yourself.")
    p.add_argument("--start", type=int, help="sheet row to start from (default: the first row to do)")
    p.add_argument("--count", type=int, help="how many applications to process (default: all remaining)")
    p.add_argument("--max-tabs", type=int, help="max tabs left open waiting for you (default from config, 5)")
    p.add_argument("--redo-failed", action="store_true", help="also process rows marked Failed")
    p.add_argument("--force", action="store_true", help="process rows regardless of status")
    p.add_argument("--dry-run", action="store_true",
                   help="fill only the first page, create no accounts, don't write to the sheet")
    p.add_argument("--debug", action="store_true", help="log every field to logs/run_<time>.log")
    p.add_argument("--config", help="config file (default: config.yaml)")
    p.add_argument("--profile", help="profile file (default: profile.json)")
    p.add_argument("--resumes", help="resume keyword file (default: resumes.yaml)")
    return p.parse_args(argv)


def setup_logging(debug):
    # Windows consoles default to a legacy code page; don't crash on non-ASCII text.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    folder = path("logs")
    folder.mkdir(exist_ok=True)
    file = folder / f"run_{datetime.now():%Y%m%d_%H%M%S}.log"
    log.setLevel(logging.DEBUG)
    fh = logging.FileHandler(file, encoding="utf-8")
    fh.setLevel(logging.DEBUG if debug else logging.INFO)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(message)s"))
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.DEBUG if debug else logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
    log.addHandler(fh)
    log.addHandler(ch)
    return file


def select_rows(rows, args):
    out = []
    for r in rows:
        if args.start and r.num < args.start:
            continue
        if not r.link.startswith("http"):
            if r.link:
                log.info("Row %s: skipped, Link isn't a URL (%s)", r.num, r.link[:60])
            continue
        st = r.status
        if not args.force:
            if st == S.FAILED and not args.redo_failed:
                continue
            if st and st != S.FAILED and st not in S.TODO:
                continue  # Submitted, Ready to submit, Already applied, Posting closed, or your own text
        out.append(r)
    return out[: args.count] if args.count else out


def print_summary(rows):
    if not rows:
        return
    counts = Counter(r.status or "(blank)" for r in rows)
    width = max(len(k) for k in counts) + 2
    print("\nSummary")
    print("-" * (width + 6))
    for k in sorted(counts, key=lambda s: S.ALL.index(s) if s in S.ALL else 99):
        print(f"{k:<{width}}{counts[k]:>6}")
    print("-" * (width + 6))
    print(f"{'Total':<{width}}{len(rows):>6}")
    attention = [r for r in rows if r.status in S.NEEDS_YOU or r.status == S.FAILED]
    if attention:
        print("\nNeeds a look:")
        for r in attention:
            print(f"  row {r.num:<4} {r.name[:40]:<40} {r.status}{': ' + r.notes[:120] if r.notes else ''}")


def main(argv=None):
    args = parse_args(argv)
    cfg = config.load(args.config)
    log_file = setup_logging(args.debug)
    if args.dry_run:
        log.info("Dry run: first page only, no accounts created, nothing written to the sheet.")

    sheet = open_sheet(cfg, args.dry_run)
    rows = select_rows(sheet.rows, args)
    if not rows:
        log.info("Nothing to do: no rows to process (use --redo-failed or --force to include more).")
        sheet.close()
        return 0
    log.info("%d application(s) to process: rows %s", len(rows), ", ".join(str(r.num) for r in rows[:30])
             + (" …" if len(rows) > 30 else ""))

    profile = userprofile.load(path(args.profile) if args.profile else None)
    email = config.email_override() or profile["personal"]["email"]
    password = config.password()
    if not password:
        log.warning("No WORKDAY_PASSWORD in runner/.env: sign-in pages will be marked 'Needs you: sign in'.")

    from playwright.sync_api import sync_playwright

    from resumes import ResumePicker

    picker = ResumePicker(profile.get("resume"), args.resumes)

    import browser
    from flow import BrowserClosed, Runner
    from notify import Notifier
    from tabs import Tabs

    done = []
    current = None
    try:
        with sync_playwright() as pw:
            br = browser.launch(pw, cfg, profile, args.debug)
            runner = Runner(cfg, br, email, password, picker, args.dry_run, args.debug)
            tabs = Tabs(br, sheet, runner, Notifier(cfg), args.max_tabs or int(cfg["run"]["max_tabs"]),
                        bool(cfg["run"]["resume_after_you_fix"]))
            try:
                for i, row in enumerate(rows):
                    tabs.wait_for_slot()
                    log.info("Row %s (%s) [%d/%d]: %s", row.num, row.name, i + 1, len(rows), row.link)
                    current = (row, row.status, row.notes)
                    sheet.update(row, S.IN_PROGRESS)
                    out, page = runner.process(br.ctx.new_page(), row)
                    tabs.report(row, out)
                    current = None
                    done.append(row)
                    if out.keep_open:
                        tabs.track(page, row)
                    else:
                        page.close()
                    if i < len(rows) - 1:
                        tabs.idle(float(cfg["run"]["delay_between_s"]))
                tabs.wait_all()
                log.info("All tabs are submitted or closed.")
            except KeyboardInterrupt:
                log.info("Stopping (Ctrl+C). Statuses are saved; open tabs will close with the browser.")
            except BrowserClosed:
                log.info("The browser window was closed. Stopping.")
            finally:
                try:
                    br.ctx.close()
                except Exception:
                    pass
    except KeyboardInterrupt:
        log.info("Stopping (Ctrl+C).")
    except Exception as e:
        # Ctrl+C on Windows also stops Playwright's driver; that surfaces as a Playwright error.
        if "closed" not in str(e).lower() and "connection" not in str(e).lower():
            log.exception("Run stopped by an unexpected error")
    finally:
        if current:  # interrupted mid-application: put the row back as it was
            row, prev_status, prev_notes = current
            sheet.update(row, prev_status or S.QUEUED, "Interrupted; will be retried next run.")
        sheet.close()
        print_summary(done)
        print(f"\nLog: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
