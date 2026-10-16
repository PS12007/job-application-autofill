"""profile.py — reads profile.json and turns it into the extension's profile format.

profile.json is the extension's profile (same keys as the options page / sample) plus
"resumePath". An exported backup ({"app": ..., "profile": {...}}) also works.
"""
import base64
import json
import mimetypes
from pathlib import Path

from config import HERE, path


def resume_from_file(file):
    """A resume file in the extension's format: {name, type, size, data (base64)}."""
    raw = Path(file).read_bytes()
    return {
        "name": Path(file).name,
        "type": mimetypes.guess_type(str(file))[0] or "application/pdf",
        "size": len(raw),
        "data": base64.b64encode(raw).decode("ascii"),
    }


def load(file=None):
    file = Path(file) if file else HERE / "profile.json"
    if not file.exists():
        raise SystemExit(f"{file.name} not found. Copy profile.example.json to profile.json and fill it in.")
    with open(file, encoding="utf-8") as f:
        data = json.load(f)
    resume_path = data.get("resumePath", "")
    profile = data.get("profile", data)
    profile = {k: v for k, v in profile.items() if k != "resumePath"}
    resume_path = resume_path or profile.pop("resumePath", "")

    if resume_path:
        rp = path(resume_path)
        if not rp.exists():
            raise SystemExit(f"Resume not found: {rp} (resumePath in {file.name})")
        profile["resume"] = resume_from_file(rp)
    if not (profile.get("personal") or {}).get("email"):
        raise SystemExit(f"personal.email is empty in {file.name}.")
    return profile
