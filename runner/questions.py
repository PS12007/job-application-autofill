"""questions.py — collects the questions your profile couldn't answer, across runs, in
questions.yaml. Type an answer next to a question once and every later application uses
it (it's added to the extension's saved answers).

    python questions.py          list the questions still waiting for an answer
"""
import logging
import re
import sys
from datetime import date

import yaml

from config import HERE, path

log = logging.getLogger("runner")

HEADER = """\
# Questions the autofill couldn't answer, collected from your applications.
# Fill in `answer:` and save; the runner picks it up (even mid-run) and uses it everywhere.
#
#   answer    what to enter. For dropdowns / radio buttons, text matching one of the options
#             (alternatives with |, e.g. "Yes|Y"). For "select all that apply", separate with ;
#   keywords  when the question contains any of these (comma-separated, case-insensitive),
#             the answer is used. Defaults to part of the question; shorten it to cover
#             similar wordings, e.g. "years of experience, python".
#   skip: true   stop listing a question you'll always answer by hand.
#
# Unanswered questions are listed first, most frequent first.
"""

# Reasons the extension gives for "no answer" (required ones stop the fill).
_UNANSWERED = ("needs your input", "no saved answer matches")


def _norm(s):
    return " ".join(re.sub(r"[*:]+\s*$", "", str(s or "")).split()).lower()


def default_keywords(question):
    """The extension splits keywords on commas, so use the longest comma-free part."""
    parts = [p.strip(" ?.*:").lower() for p in _norm(question).split(",")]
    return max(parts, key=len) if parts else ""


class QuestionBank:
    def __init__(self, file=None):
        self.file = path(file) if file else HERE / "questions.yaml"
        self.items = []
        self._mtime = None
        self.load()

    # ------------------------------------------------------------ file

    def load(self):
        self.items = []
        if self.file.exists():
            try:
                data = yaml.safe_load(self.file.read_text(encoding="utf-8")) or []
                self.items = [i for i in data if isinstance(i, dict) and i.get("question")]
            except yaml.YAMLError as e:
                log.warning("Couldn't read %s (%s); fix the file, it's left untouched until then.", self.file.name, e)
                self._mtime = self._stat()
                self._broken = True
                return
        self._broken = False
        self._mtime = self._stat()

    def _stat(self):
        try:
            return self.file.stat().st_mtime
        except OSError:
            return None

    def changed(self):
        """Reload if you edited the file since; True when it was reloaded."""
        if self._stat() == self._mtime:
            return False
        self.load()
        return True

    def save(self):
        if self._broken:
            return
        order = lambda i: (bool(str(i.get("answer") or "").strip()) or bool(i.get("skip")), -int(i.get("seen") or 0))
        self.items.sort(key=order)
        body = yaml.safe_dump(self.items, sort_keys=False, allow_unicode=True, width=1000)
        self.file.write_text(HEADER + "\n" + body, encoding="utf-8")
        self._mtime = self._stat()

    # ------------------------------------------------------------ use

    def answers(self):
        """Answered questions as extension saved answers: [{keywords, answer}]."""
        out = []
        for i in self.items:
            ans = str(i.get("answer") or "").strip()
            kw = str(i.get("keywords") or default_keywords(i["question"])).strip()
            if ans and kw and not i.get("skip"):
                out.append({"keywords": kw, "answer": ans})
        return out

    def pending(self):
        return [i for i in self.items if not str(i.get("answer") or "").strip() and not i.get("skip")]

    def record(self, details, where=""):
        """Add the unanswered questions from one fill's details. Returns how many are new."""
        self.changed()  # merge with your edits, never overwrite them
        if self._broken:
            return 0
        index = {_norm(i["question"]): i for i in self.items}
        new = 0
        touched = False
        for d in details or []:
            q = d.get("question")
            reason = d.get("reason") or ""
            if not q or d.get("status") not in ("failed", "skipped") or not any(r in reason for r in _UNANSWERED):
                continue
            key = _norm(q)
            if len(key) < 4:
                continue
            item = index.get(key)
            if item is None:
                item = {"question": " ".join(q.split()), "answer": "", "keywords": default_keywords(q),
                        "type": d.get("kind") or "", "required": "needs your input" in reason, "seen": 0}
                if d.get("options"):
                    item["options"] = d["options"]
                self.items.append(item)
                index[key] = item
                new += 1
            item["seen"] = int(item.get("seen") or 0) + 1
            item["last_seen"] = date.today().isoformat()
            if where:
                item["example"] = where
            if "needs your input" in reason:
                item["required"] = True
            touched = True
        if touched:
            self.save()
        return new


def merged_answers(own, bank):
    """Your profile's saved answers plus the ones answered in questions.yaml."""
    return list(own or []) + bank.answers()


def main():
    bank = QuestionBank(sys.argv[1] if len(sys.argv) > 1 else None)
    todo = bank.pending()
    if not todo:
        print(f"No unanswered questions in {bank.file.name}.")
        return 0
    print(f"{len(todo)} question(s) waiting for an answer in {bank.file}:\n")
    for i in todo:
        req = "required" if i.get("required") else "optional"
        print(f"  [{i.get('seen', 1)}x, {req}] {i['question']}")
        if i.get("options"):
            print(f"      options: {' | '.join(i['options'][:10])}")
    print("\nOpen the file, fill in `answer:` for each, and save.")
    return 0


if __name__ == "__main__":
    for s in (sys.stdout,):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
