"""ats.py — keyword gap between a job description and the resume being sent.

ATS filters mostly look for the job's own terms. This lists the skills/tools the
description mentions that your resume doesn't, e.g. "missing: kubernetes, grpc", plus a
rough match percentage. The vocabulary is every keyword in resumes.yaml.
"""
import base64
import io
import logging
import re
import zipfile
from collections import Counter

from resumes import _longest, _word_rx

log = logging.getLogger("runner")

# Different spellings of the same thing: either one in the resume counts.
ALIASES = [
    {"kubernetes", "k8s"}, {"javascript", "js"}, {"typescript", "ts"}, {"postgresql", "postgres"},
    {"amazon web services", "aws"}, {"google cloud", "gcp", "google cloud platform"}, {"azure", "microsoft azure"},
    {"machine learning", "ml"}, {"artificial intelligence", "ai"}, {"natural language processing", "nlp"},
    {"computer vision", "cv"}, {"ci/cd", "continuous integration", "continuous delivery"},
    {"golang", "go"}, {"node.js", "nodejs", "node"}, {"react", "react.js", "reactjs"}, {"c++", "cpp"},
    {"c#", "csharp", ".net"}, {"large language models", "llm", "llms"}, {"scikit-learn", "sklearn"},
    {"tensorflow", "tf"}, {"object-oriented", "oop", "object oriented"}, {"rtos", "real-time operating system"},
]

# Ordinary English words unless capitalised: "Excel", "React", "Spring Boot" count in a job
# description; "excel at", "react to", "in the spring" don't.
PROPER = {"chef", "dart", "excel", "express", "flask", "puppet", "react", "ruby", "rust", "spring", "swift", "unity",
          "cucumber", "prefect", "cadence", "inventor", "windows"}
# Too generic to be worth adding to a resume.
GENERIC = {"requirements", "portfolio", "insights", "metrics", "incident", "coverage", "dynamics", "stakeholder",
           "stakeholders", "software development", "finance"}


def _job_rx(k):
    if k in PROPER:
        forms = "|".join(re.escape(f) for f in {k.capitalize(), k.upper()})
        return re.compile(r"(?<![\w+#.])(?:" + forms + r")(?![\w+#])")
    return _word_rx(k)


def _stem_rx(k):
    """Looser match for the resume: other forms of each long word ("debugging" ~ "debugged")."""
    words = []
    for w in k.split():
        if len(w) >= 6 and w.isalpha():
            words.append(re.escape(w[: max(4, len(w) - 3)]) + r"\w{0,5}")
        else:
            words.append(re.escape(w))
    return re.compile(r"(?<![\w+#.])" + r"[\s-]+".join(words) + r"(?![\w+#])", re.I)


def resume_text(resume):
    """Plain text of a resume dict {name, data(base64)}: PDF, DOCX or plain text."""
    if not resume or not resume.get("data"):
        return ""
    raw = base64.b64decode(resume["data"])
    name = (resume.get("name") or "").lower()
    try:
        if name.endswith(".pdf") or raw[:4] == b"%PDF":
            from pypdf import PdfReader

            return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)
        if name.endswith(".docx"):
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                xml = z.read("word/document.xml").decode("utf-8", "replace")
            return re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n"))
        return raw.decode("utf-8", "replace")
    except Exception as e:
        log.debug("couldn't read the text of %s: %s", name, e)
        return ""


class KeywordGap:
    def __init__(self, phrases, top=8):
        self.top = top
        seen = {}
        for p in phrases:
            k = str(p).strip().lower()
            if len(k) >= 2 and k not in seen and k not in GENERIC:
                seen[k] = _job_rx(k)
        self.vocab = seen
        self._alias = {}
        for group in ALIASES:
            for k in group:
                self._alias[k] = [_word_rx(a) for a in group]
        self._stem = {k: _stem_rx(k) for k in seen}
        self._texts = {}

    def _text(self, resume):
        key = (resume.get("name"), resume.get("size"))
        if key not in self._texts:
            self._texts[key] = resume_text(resume)
        return self._texts[key]

    def report(self, title, description, resume):
        """(match %, [missing terms, most important first]) or None if it can't tell."""
        text = self._text(resume or {})
        job = f"{title}\n{description}"
        if len(text) < 200 or len(description or "") < 200:
            return None
        counts = Counter()
        for k, rx in self.vocab.items():
            n = len(rx.findall(job))
            if n:
                counts[k] = n + (3 if rx.search(title or "") else 0)
        terms = _longest(list(counts))
        if not terms:
            return None
        has = lambda k: self._stem[k].search(text) or any(rx.search(text) for rx in self._alias.get(k, []))
        missing = sorted((k for k in terms if not has(k)), key=lambda k: (-counts[k], k))
        pct = round(100 * (len(terms) - len(missing)) / len(terms))
        return pct, missing

    def note(self, title, description, resume):
        r = self.report(title, description, resume)
        if not r:
            return ""
        pct, missing = r
        s = f"{pct}% keyword match"
        if missing:
            s += f", missing: {', '.join(missing[: self.top])}"
            log.info("  keywords missing from the resume: %s", ", ".join(missing[:20]))
        return s
