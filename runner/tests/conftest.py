import sys
from pathlib import Path

import pytest

RUNNER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER))


def pytest_addoption(parser):
    parser.addoption("--e2e", action="store_true", help="also run the browser test against the mock Workday site")


def pytest_configure(config):
    config.addinivalue_line("markers", "e2e: opens a real (visible) browser against tests/mock")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--e2e"):
        return
    skip = pytest.mark.skip(reason="browser test: run with --e2e")
    for item in items:
        if "e2e" in item.keywords:
            item.add_marker(skip)
