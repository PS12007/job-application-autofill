import json

import precheck as P

URL = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Manager--Firmware_JR2019791"


def test_parse_variants():
    for url in [
        URL,
        "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US%2C-CA%2C-Santa-Clara/"
        "Manager--Firmware_JR2019791/apply/applyManually",
        "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/details/Manager--Firmware_JR2019791?q=1",
    ]:
        p = P.parse(url)
        assert (p.tenant, p.site, p.posting_id, p.req_id) == (
            "nvidia", "NVIDIAExternalCareerSite", "Manager--Firmware_JR2019791", "JR2019791")
        assert p.cxs == "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite"


def test_parse_myworkdaysite_and_others():
    p = P.parse("https://wd5.myworkdaysite.com/en-US/recruiting/acme/Careers/job/Toronto/Dev_R123")
    assert (p.tenant, p.site, p.posting_id, p.req_id) == ("acme", "Careers", "Dev_R123", "R123")
    assert P.parse("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite") is None
    assert P.parse("https://boards.greenhouse.io/acme/jobs/1") is None


def test_job_key_same_job_different_urls():
    a = P.job_key(URL)
    b = P.job_key("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/details/Manager--Firmware_JR2019791")
    assert a == b == "nvidia:jr2019791"
    assert P.job_key("https://x.com/jobs/1/") == P.job_key("https://X.com/jobs/1")


def fake(responses, calls):
    def _request(url, body=None, timeout=15):
        calls.append(url)
        for frag, resp in responses.items():
            if url.endswith(frag) or frag + "/" in url:
                return resp
        return 500, b""
    return _request


def test_lookup_open(monkeypatch):
    info = {"jobPostingInfo": {"title": "Manager, Firmware", "jobReqId": "JR2019791", "canApply": True,
                               "jobDescription": "<p>RTOS &amp; C++</p><ul><li>SPI</li></ul>"}}
    calls = []
    monkeypatch.setattr(P, "_request", fake({"/job": (200, json.dumps(info).encode())}, calls))
    j = P.lookup(URL)
    assert not j.closed and j.title == "Manager, Firmware" and j.req_id == "JR2019791"
    assert "RTOS & C++" in j.description and "SPI" in j.description
    assert calls == [P.parse(URL).cxs + "/job/Manager--Firmware_JR2019791"]


def test_lookup_closed_only_when_site_answers(monkeypatch):
    monkeypatch.setattr(P, "_request", fake({"/job": (404, b"{}"), "/jobs": (200, b"{}")}, []))
    assert P.lookup(URL).closed
    monkeypatch.setattr(P, "_request", fake({"/job": (404, b"{}"), "/jobs": (404, b"{}")}, []))
    assert P.lookup(URL) is None  # the site itself isn't found: let the browser decide
    monkeypatch.setattr(P, "_request", fake({"/job": (503, b"")}, []))
    assert P.lookup(URL) is None


def test_lookup_can_apply_false(monkeypatch):
    info = {"jobPostingInfo": {"title": "X", "jobDescription": "", "canApply": False}}
    monkeypatch.setattr(P, "_request", fake({"/job": (200, json.dumps(info).encode())}, []))
    assert P.lookup(URL).closed


def test_lookup_network_error(monkeypatch):
    def boom(*a, **k):
        raise OSError("offline")
    monkeypatch.setattr(P, "_request", boom)
    assert P.lookup(URL) is None
