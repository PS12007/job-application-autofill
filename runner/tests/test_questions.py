import os
import time

import yaml

from questions import QuestionBank, default_keywords, merged_answers

DETAILS = [
    {"field": "Application Questions: Colour", "status": "failed", "reason": "required, needs your input",
     "question": "What is your favourite colour?*", "kind": "text"},
    {"field": "Weekends", "status": "skipped", "reason": "no saved answer matches",
     "question": "Are you willing to work weekends, if needed?", "kind": "choice", "options": ["Yes", "No"]},
    {"field": "First Name", "status": "ok", "reason": "", "question": "First Name"},
    {"field": "Phone", "status": "failed", "reason": "value didn't stick", "question": "Phone"},
]
COLOUR = {"keywords": "what is your favourite colour", "answer": "Blue"}


def test_default_keywords_avoid_commas():
    assert default_keywords("Are you willing to work weekends, if needed?") == "are you willing to work weekends"
    assert default_keywords("What is your favourite colour?*") == "what is your favourite colour"


def test_record_and_answer(tmp_path):
    f = tmp_path / "q.yaml"
    bank = QuestionBank(f)
    assert bank.record(DETAILS, "Acme / Dev") == 2
    assert bank.record(DETAILS, "Beta / Dev") == 0  # same questions: counted, not duplicated
    data = yaml.safe_load(f.read_text(encoding="utf-8"))
    by_q = {d["question"]: d for d in data}
    colour = by_q["What is your favourite colour?*"]
    assert colour["seen"] == 2 and colour["required"] and colour["example"] == "Beta / Dev"
    assert by_q["Are you willing to work weekends, if needed?"]["options"] == ["Yes", "No"]
    assert bank.answers() == [] and len(bank.pending()) == 2

    # You type an answer; the bank notices the edit and keeps it when it records more.
    colour["answer"] = "Blue"
    f.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    os.utime(f, (time.time() + 5, time.time() + 5))
    assert bank.changed()
    assert bank.answers() == [COLOUR]
    bank.record(DETAILS[1:2])
    assert QuestionBank(f).answers() == [COLOUR]
    assert len(QuestionBank(f).pending()) == 1
    assert merged_answers([{"keywords": "a", "answer": "b"}], bank) == [{"keywords": "a", "answer": "b"}, COLOUR]


def test_broken_file_is_left_alone(tmp_path):
    f = tmp_path / "q.yaml"
    f.write_text("- question: [unclosed", encoding="utf-8")
    bank = QuestionBank(f)
    assert bank.record(DETAILS) == 0
    assert f.read_text(encoding="utf-8") == "- question: [unclosed"
