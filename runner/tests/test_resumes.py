from resumes import ResumePicker

YAML = """
min_score: 4
description_cap: 3
default_cover_letter: CL/general.txt
tracks:
  ml:
    file: R/ml.pdf
    cover_letter: CL/ml.txt
    titles: [machine learning, ml engineer]
    keywords: [pytorch, cuda, python]
  embedded:
    file: R/embedded.pdf
    titles: [firmware, embedded]
    keywords: [rtos, c++, spi]
  swe:
    file: R/missing.pdf
    titles: [software engineer, software developer, developer]
    keywords: [python, java]
"""


def picker(tmp_path):
    (tmp_path / "r").mkdir()
    (tmp_path / "cl").mkdir()
    for n in ("ml.pdf", "embedded.pdf"):
        (tmp_path / "r" / n).write_bytes(b"%PDF " + n.encode())
    (tmp_path / "cl" / "ml.txt").write_text("ml letter")
    (tmp_path / "cl" / "general.txt").write_text("general letter")
    f = tmp_path / "resumes.yaml"
    root = tmp_path.as_posix()
    f.write_text(YAML.replace("R/", f"{root}/r/").replace("CL/", f"{root}/cl/"))
    return ResumePicker({"name": "default.pdf"}, f)


def test_pick_by_title_and_description(tmp_path):
    p = picker(tmp_path)
    assert p.pick("Machine Learning Engineer", "PyTorch and CUDA")[0] == "ml"
    assert p.pick("Firmware Engineer", "RTOS, C++ and SPI drivers")[0] == "embedded"
    assert p.pick("Embedded C++ Developer")[0] == "embedded"  # c++ matched as a whole word


def test_skips_tracks_without_file_and_low_scores(tmp_path):
    p = picker(tmp_path)
    assert p.pick("Software Developer", "Python and Java")[0] == "default"  # swe has no file yet
    assert p.pick("Accountant", "spreadsheets")[0] == "default"


def test_override_and_cover_letters(tmp_path):
    p = picker(tmp_path)
    assert p.pick("Accountant", "", override="embedded")[0] == "embedded"
    assert p.pick("Machine Learning Engineer", "", override="nope")[0] == "ml"
    assert p.cover_letter("ml")["name"] == "ml.txt"
    assert p.cover_letter("embedded")["name"] == "general.txt"
    assert set(p.vocabulary()) >= {"pytorch", "rtos", "java"}


def test_description_is_capped(tmp_path):
    p = picker(tmp_path)
    s, _ = p.score(p.tracks[0], "Engineer", "pytorch cuda python " * 10)
    assert s == 3
