import base64

from ats import KeywordGap, resume_text

RESUME = ("Software developer. Built services in Python and Go on AWS with Docker. "
          "Wrote React and TypeScript front ends, PostgreSQL schemas and CI/CD pipelines. " * 4)
JOB = ("We are hiring a backend engineer. You will use Python, Kubernetes, Kafka and gRPC. "
       "Experience with Docker, k8s, Postgres and Terraform is a plus. Kubernetes in production. " * 3)


def as_resume(text, name="r.txt"):
    raw = text.encode()
    return {"name": name, "size": len(raw), "data": base64.b64encode(raw).decode()}


def test_gap_lists_missing_terms_and_respects_aliases():
    gap = KeywordGap(["python", "kubernetes", "kafka", "grpc", "docker", "postgresql", "postgres", "terraform", "react"])
    pct, missing = gap.report("Backend Engineer", JOB, as_resume(RESUME))
    assert missing[0] == "kubernetes"  # mentioned most
    assert set(missing) == {"kubernetes", "kafka", "grpc", "terraform"}
    assert "postgres" not in missing  # PostgreSQL in the resume counts
    assert 0 < pct < 100
    note = gap.note("Backend Engineer", JOB, as_resume(RESUME))
    assert note.startswith(f"{pct}% keyword match, missing: kubernetes")


def test_word_forms_and_capitalised_words():
    gap = KeywordGap(["debugging", "excel", "react", "requirements", "kafka"])
    job = ("You will excel at debugging and react quickly to changing requirements. Kafka experience. " * 4)
    pct, missing = gap.report("Engineer", job, as_resume(RESUME + " Debugged services. "))
    assert missing == ["kafka"]  # "debugged" counts; "excel at" / "react to" aren't the tools
    _, missing = gap.report("Engineer", job + " Advanced Excel. " * 2, as_resume(RESUME))
    assert "excel" in missing and "debugging" in missing


def test_gap_needs_enough_text():
    gap = KeywordGap(["python"])
    assert gap.report("Dev", "Python", as_resume(RESUME)) is None
    assert gap.report("Dev", JOB, as_resume("short")) is None


def test_resume_text_pdf(tmp_path):
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(200, 200)
    f = tmp_path / "r.pdf"
    with open(f, "wb") as fh:
        w.write(fh)
    raw = f.read_bytes()
    assert resume_text({"name": "r.pdf", "data": base64.b64encode(raw).decode()}) == ""  # blank page, no crash
    assert resume_text({"name": "r.pdf", "data": base64.b64encode(b"%PDF-broken").decode()}) == ""
