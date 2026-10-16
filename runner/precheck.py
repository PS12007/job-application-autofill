"""precheck.py — look up Workday postings before opening the browser.

Workday career sites load each posting from a public JSON endpoint
(https://<host>/wday/cxs/<tenant>/<site>/job/<posting id>). Reading it directly:
- finds closed postings in a fraction of a second, without opening a tab;
- gives the title, description and requisition ID (for picking a resume and spotting
  duplicate rows) before the page has even loaded.

Only read-only GET/POST requests a visitor's browser makes anyway. Anything unexpected
returns None and the browser decides as usual.
"""
import html
import json
import logging
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlparse

log = logging.getLogger("runner")

_LANG = re.compile(r"^[a-z]{2}(-[A-Za-z]{2,4})?$")
_REQ_ID = re.compile(r"_((?:J?R|REQ|JR)[-_]?\d[\w-]*)$", re.I)
_HEADERS = {"Accept": "application/json", "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/130.0 Safari/537.36"}


@dataclass
class Posting:
    """Where a Workday job link's data lives."""
    host: str
    tenant: str
    site: str
    posting_id: str  # e.g. Manager--Firmware_JR2019791

    @property
    def cxs(self):
        return f"https://{self.host}/wday/cxs/{self.tenant}/{self.site}"

    @property
    def req_id(self):
        m = _REQ_ID.search(self.posting_id)
        return m.group(1).upper() if m else ""


@dataclass
class JobInfo:
    closed: bool = False
    title: str = ""
    description: str = ""
    req_id: str = ""


def parse(url):
    """A Posting for a Workday job URL, or None (other sites, search pages, …)."""
    u = urlparse(url)
    host = (u.hostname or "").lower()
    segs = [unquote(s) for s in u.path.split("/") if s]
    if host.endswith(".myworkdayjobs.com"):
        tenant = host.split(".")[0]
        if segs and _LANG.match(segs[0]):
            segs = segs[1:]
        if len(segs) < 3:
            return None
        site, rest = segs[0], segs[1:]
    elif host.endswith(".myworkdaysite.com"):  # wd5.myworkdaysite.com/[en-US/]recruiting/<tenant>/<site>/job/…
        if segs and _LANG.match(segs[0]):
            segs = segs[1:]
        if len(segs) < 5 or segs[0] != "recruiting":
            return None
        tenant, site, rest = segs[1], segs[2], segs[3:]
    else:
        return None
    if rest[0] not in ("job", "details"):
        return None
    rest = rest[1:]
    if "apply" in rest:
        rest = rest[: rest.index("apply")]
    if not rest:
        return None
    return Posting(host, tenant, site, rest[-1])


def _request(url, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=_HEADERS, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def html_text(s):
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>", "\n", s or "")
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).replace("\xa0", " ").strip()


def lookup(url, _site_ok=None):
    """JobInfo for a Workday job URL, or None when it can't be told without the browser."""
    p = parse(url)
    if not p:
        return None
    try:
        status, body = _request(f"{p.cxs}/job/{quote(p.posting_id)}")
        if status == 200:
            info = json.loads(body).get("jobPostingInfo") or {}
            if not info.get("title"):
                return None
            return JobInfo(
                closed=info.get("canApply") is False,
                title=info.get("title", ""),
                description=html_text(info.get("jobDescription", ""))[:30000],
                req_id=(info.get("jobReqId") or p.req_id).upper(),
            )
        if status == 404:
            # Closed only if the career site itself still answers (so the URL was understood).
            key = (p.host, p.tenant, p.site)
            if _site_ok is not None and key in _site_ok:
                ok = _site_ok[key]
            else:
                st, _ = _request(f"{p.cxs}/jobs", {"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""})
                ok = st == 200
                if _site_ok is not None:
                    _site_ok[key] = ok
            return JobInfo(closed=True, req_id=p.req_id) if ok else None
    except Exception as e:  # network trouble, odd JSON: let the browser decide
        log.debug("precheck %s: %s", url, e)
    return None


def lookup_many(urls, workers=8):
    """{url: JobInfo or None}, fetched in parallel."""
    urls = list(dict.fromkeys(urls))
    site_ok = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return dict(zip(urls, ex.map(lambda u: lookup(u, site_ok), urls)))


def job_key(url, req_id=""):
    """Identifies the same job across rows: tenant + requisition ID, else the cleaned URL."""
    p = parse(url)
    rid = req_id or (p.req_id if p else "")
    if p and rid:
        return f"{p.tenant}:{rid}".lower()
    if p:
        return f"{p.tenant}:{p.site}:{p.posting_id}".lower()
    u = urlparse(url)
    return f"{(u.hostname or '').lower()}{u.path.rstrip('/').lower()}?{u.query}"
