"""config.py — config.yaml (settings), .env (password) and folder paths."""
import os
import shutil
from pathlib import Path

import yaml
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent

DEFAULTS = {
    "sheet": {
        "backend": "xlsx",
        "xlsx_path": "applications.xlsx",
        "worksheet": "",
        "gsheets_id": "",
        "service_account_file": "service-account.json",
    },
    "browser": {"user_data_dir": "chrome-profile", "extension_dir": "../extension", "debug_port": 9333, "extra_args": []},
    "run": {
        "max_tabs": 5,
        "app_timeout_s": 600,
        "delay_between_s": 4,
        "apply_mode": "auto",
        "overwrite_existing": True,
        "keep_failed_tabs": False,
        "resume_after_you_fix": True,
        "precheck": True,
        "retry_failed": 1,
        "keyword_gap": True,
    },
    "verify_email": {"auto": True},
    "notify": {"sound": True, "desktop": True},
}


def _merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


def path(p):
    """Resolve a config path relative to runner/."""
    p = Path(os.path.expanduser(str(p)))
    return p if p.is_absolute() else (HERE / p).resolve()


def load(config_path=None):
    cfg_file = path(config_path) if config_path else HERE / "config.yaml"
    if not cfg_file.exists() and not config_path:
        shutil.copy(HERE / "config.example.yaml", cfg_file)
    with open(cfg_file, encoding="utf-8") as f:
        cfg = _merge(DEFAULTS, yaml.safe_load(f) or {})
    load_dotenv(HERE / ".env")
    return cfg


def password():
    return os.environ.get("WORKDAY_PASSWORD", "")


def email_override():
    return os.environ.get("WORKDAY_EMAIL", "").strip()
