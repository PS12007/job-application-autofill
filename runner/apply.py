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
    p.add_argument("--questions", help="question bank file (default: questions.yaml)")
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
    """Rows to consider, in sheet order (--count is applied later, in prepare())."""
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
    return out


def prepare(cands, sheet, cfg, args):
    """Look up Workday postings, mark closed ones and duplicates, and return up to --count
    rows to open. Rows past --count are left untouched."""
    import precheck

    want = args.count or len(cands)
    use_precheck = bool(cfg["run"]["precheck"])
    key = lambda r: precheck.job_key(r.link, r.job.req_id if r.job else "")
    taken = {}  # job key -> row already done or queued
    if not args.force:
        for r in sheet.rows:
            if r.status in S.DONE and r.status != S.DUPLICATE and r.link.startswith("http"):
                taken.setdefault(key(r), r)
    queue, skipped = [], []
    for start in range(0, len(cands), 8):
        if len(queue) >= want:
            break
        chunk = cands[start:start + 8]
        if use_precheck:
            infos = precheck.lookup_many([r.link for r in chunk if precheck.parse(r.link)])
            for r in chunk:
                r.job = infos.get(r.link)
        for r in chunk:
            if len(queue) >= want:
                break
            if r.job and r.job.closed:
                sheet.update(r, S.CLOSED, "Checked before opening: the posting no longer exists or isn't open.")
                log.info("Row %s (%s): posting closed (checked without opening it)", r.num, r.name)
                skipped.append(r)
                continue
            k = key(r)
            other = taken.get(k)
            if other is not None and other.num != r.num and not args.force:
                note = f"Same job as row {other.num}" + (f" ({other.status})" if other.status else "")
                sheet.update(r, S.DUPLICATE, note)
                log.info("Row %s (%s): duplicate of row %s, skipped", r.num, r.name, other.num)
                skipped.append(r)
                continue
            taken[k] = r
            queue.append(r)
    return queue, skipped


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
    rows, skipped = prepare(select_rows(sheet.rows, args), sheet, cfg, args)
    if not rows:
        log.info("Nothing to open: no rows to process (use --redo-failed or --force to include more).")
        sheet.close()
        print_summary(skipped)
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
    gap = None
    if cfg["run"]["keyword_gap"]:
        from ats import KeywordGap

        gap = KeywordGap(picker.vocabulary())
    from questions import QuestionBank, merged_answers

    bank = QuestionBank(args.questions)
    own_answers = list(profile.get("savedAnswers") or [])
    profile["savedAnswers"] = merged_answers(own_answers, bank)
    if bank.answers():
        log.info("Using %d answer(s) from %s", len(bank.answers()), bank.file.name)
    from inbox import Mailbox

    mailbox = Mailbox(cfg, email)
    if mailbox.ready:
        log.info("Verification emails: checking %s on %s", mailbox.user, mailbox.host)

    import browser
    from flow import BrowserClosed, Runner, tenant
    from notify import Notifier
    from tabs import Tabs

    done = list(skipped)
    current = None
    retries = int(cfg["run"]["retry_failed"])
    try:
        with sync_playwright() as pw:
            br = browser.launch(pw, cfg, profile, args.debug)
            runner = Runner(cfg, br, email, password, picker, args.dry_run, args.debug,
                            bank=bank, gap=gap, default_resume=profile.get("resume"), own_answers=own_answers)
            runner.applied = {tenant(r.link) for r in sheet.rows if r.status == S.SUBMITTED and r.link}
            tabs = Tabs(br, sheet, runner, Notifier(cfg), args.max_tabs or int(cfg["run"]["max_tabs"]),
                        bool(cfg["run"]["resume_after_you_fix"]), mailbox)
            try:
                for i, row in enumerate(rows):
                    tabs.wait_for_slot()
                    log.info("Row %s (%s) [%d/%d]: %s", row.num, row.name, i + 1, len(rows), row.link)
                    current = (row, row.status, row.notes)
                    sheet.update(row, S.IN_PROGRESS)
                    out, page = runner.process(br.ctx.new_page(), row)
                    for _ in range(retries):
                        if out.status != S.FAILED or not out.retry:
                            break
                        log.info("  failed (%s); trying once more", out.notes[:150])
                        if not page.is_closed():
                            page.close()
                        tabs.idle(3)
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
        waiting = bank.pending()
        if waiting:
            print(f"\n{len(waiting)} question(s) waiting for an answer in {bank.file.name} "
                  "(python questions.py lists them). Answer once; every later application uses it.")
        print(f"\nLog: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
