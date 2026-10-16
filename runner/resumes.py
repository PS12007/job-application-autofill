"""resumes.py — choose a resume per job from keywords (resumes.yaml)."""
import logging
import re
import shutil

import yaml

from config import HERE, path
from userprofile import resume_from_file

log = logging.getLogger("runner")


def _word_rx(phrase):
    # Whole-word match that also works for c++, c#, .net, ci/cd, a/b testing.
    return re.compile(r"(?<![\w+#.])" + re.escape(phrase.lower()) + r"(?![\w+#])", re.I)


def _longest(hits):
    """Drop phrases contained in a longer hit ("developer" inside "software developer")."""
    return [k for k in hits if not any(k != o and _word_rx(k).search(o) for o in hits)]


class Track:
    def __init__(self, name, spec):
        self.name = name
        self.file = path(spec.get("file") or "")
        self.cover_letter = path(spec["cover_letter"]) if spec.get("cover_letter") else None
        self.titles = [(k, _word_rx(k)) for k in spec.get("titles") or []]
        self.keywords = [(k, _word_rx(k)) for k in spec.get("keywords") or []]

    @property
    def available(self):
        return self.file.is_file()


class ResumePicker:
    def __init__(self, default_resume, file=None):
        self.default = default_resume
        self.tracks = []
        self.default_cover = None
        self._cache = {}
        file = path(file) if file else HERE / "resumes.yaml"
        if not file.exists() and (HERE / "resumes.example.yaml").exists() and not file.name.startswith("resumes.example"):
            shutil.copy(HERE / "resumes.example.yaml", file)
        if not file.exists():
            return
        cfg = yaml.safe_load(file.read_text(encoding="utf-8")) or {}
        self.min_score = int(cfg.get("min_score", 4))
        self.cap = int(cfg.get("description_cap", 12))
        self.use_description = bool(cfg.get("use_description", True))
        self.tracks = [Track(n, s or {}) for n, s in (cfg.get("tracks") or {}).items()]
        if cfg.get("default_cover_letter"):
            self.default_cover = path(cfg["default_cover_letter"])
        ready = [t.name for t in self.tracks if t.available]
        if ready:
            log.info("Resume tracks with a file: %s", ", ".join(ready))

    @property
    def enabled(self):
        return any(t.available for t in self.tracks)

    def score(self, track, title, description):
        hits = _longest([k for k, rx in track.titles if rx.search(title)])
        s = 5 * len(hits)
        kw_title = _longest([k for k, rx in track.keywords if rx.search(title) and k not in hits])
        s += 2 * len(kw_title)
        kw_desc = []
        if self.use_description and description:
            kw_desc = [k for k, rx in track.keywords if k not in kw_title and rx.search(description)]
            s += min(len(kw_desc), self.cap)
        return s, hits + kw_title + kw_desc

    def pick(self, title, description="", override=""):
        """(name, resume dict) — name is "default" when nothing matched."""
        override = (override or "").strip()
        if override:
            t = self._track_named(override)
            f = t.file if t else path(override)
            if not t and not f.is_file():
                f = HERE / "resumes" / override  # a bare file name from the resumes folder
            if f.is_file():
                log.info("  resume: %s (from the sheet's Resume column)", t.name if t else f.name)
                return (t.name if t else f.name), self._load(f)
            log.warning("  Resume column says %r but no such track / file; choosing by keywords", override)

        best = None
        for t in self.tracks:
            if not t.available:
                continue
            s, hits = self.score(t, title, description)
            if s >= self.min_score and (best is None or s > best[1]):
                best = (t, s, hits)
        if not best:
            return "default", self.default
        t, s, hits = best
        log.info("  resume: %s (score %d: %s)", t.name, s, ", ".join(hits[:8]))
        return t.name, self._load(t.file)

    def _track_named(self, text):
        """The track for "embedded", "embedded_firmware", "embedded.pdf" or "resumes/embedded.pdf"."""
        key = text.strip().replace("\\", "/").lower()
        name = key.rsplit("/", 1)[-1]
        stem = name.rsplit(".", 1)[0] if "." in name else name
        for t in self.tracks:
            if key in (t.name.lower(),) or stem in (t.name.lower(), t.file.stem.lower()):
                return t
        return None

    def vocabulary(self):
        """Every keyword of every track (for the ATS keyword gap)."""
        return [k for t in self.tracks for k, _ in t.keywords]

    def cover_letter(self, name):
        """The cover letter file for a track (its own, else default_cover_letter), loaded, or None."""
        t = next((t for t in self.tracks if t.name == name), None)
        for f in ((t.cover_letter if t else None), self.default_cover):
            if f and f.is_file():
                return self._load(f)
            if f:
                log.warning("  cover letter not found: %s", f)
        return None

    def _load(self, f):
        if f not in self._cache:
            self._cache[f] = resume_from_file(f)
        return self._cache[f]
