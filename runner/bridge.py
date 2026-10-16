"""bridge.py — talk to the extension's content script (extension/src/content/bridge.js).

The command goes into the extension's storage (via the runner tab); the page only gets
an event carrying its random id. The reply appears in data-wda-runner on <html>.
"""
import json
import uuid

from playwright.sync_api import Error

_DISPATCH = "d => document.dispatchEvent(new CustomEvent('wda-runner', { detail: d }))"
_REPLY = """id => {
  const a = document.documentElement && document.documentElement.getAttribute('data-wda-runner');
  if (!a) return null;
  try { const r = JSON.parse(a); return r.id === id && r.done ? a : null; } catch (_) { return null; }
}"""
_HAS = "() => !!document.documentElement && document.documentElement.hasAttribute('data-wda-bridge')"


def has_bridge(frame):
    try:
        return bool(frame.evaluate(_HAS))
    except Error:
        return False


def call(frame, br, cmd, timeout_s=15, **extra):
    """Send a command and wait for the reply. Raises playwright TimeoutError / Error."""
    msg_id = uuid.uuid4().hex
    br.store({f"runnerCmd_{msg_id}": {"cmd": cmd, **extra}})
    frame.evaluate(_DISPATCH, json.dumps({"id": msg_id}))
    handle = frame.wait_for_function(_REPLY, arg=msg_id, timeout=max(1, timeout_s) * 1000, polling=500)
    return json.loads(handle.json_value())


def best_frame(page, br):
    """(frame, ping reply) for the frame that looks most like the application form, or None."""
    best = None
    for f in page.frames:
        if not has_bridge(f):
            continue
        try:
            r = call(f, br, "ping", timeout_s=5)
        except Error:
            continue
        if r.get("error"):
            continue
        if best is None or r.get("score", 0) > best[1].get("score", 0):
            best = (f, r)
    return best


def wait_for_bridge(page, timeout_s=20):
    try:
        page.wait_for_function(_HAS, timeout=timeout_s * 1000, polling=500)
        return True
    except Error:
        return False
