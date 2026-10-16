"""notify.py — a sound and a desktop notification when a tab needs you. No extra packages:
Windows uses a PowerShell toast, macOS osascript, Linux notify-send.
"""
import logging
import shutil
import subprocess
import sys

log = logging.getLogger("runner")

_PS_TOAST = r"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text')
$t.Item(0).AppendChild($x.CreateTextNode($env:N_TITLE)) > $null
$t.Item(1).AppendChild($x.CreateTextNode($env:N_BODY)) > $null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))
"""


class Notifier:
    def __init__(self, cfg):
        self.sound = cfg["notify"]["sound"]
        self.desktop = cfg["notify"]["desktop"]

    def __call__(self, title, body=""):
        try:
            if self.sound:
                self._beep()
            if self.desktop:
                self._toast(title, body)
        except Exception:
            log.debug("notification failed", exc_info=True)

    def _beep(self):
        if sys.platform == "win32":
            import winsound

            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        else:
            print("\a", end="", flush=True)

    def _toast(self, title, body):
        import os

        if sys.platform == "win32":
            env = {**os.environ, "N_TITLE": title, "N_BODY": body or " "}
            subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_TOAST], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW)
        elif sys.platform == "darwin":
            script = f"display notification {_q(body)} with title {_q(title)}"
            subprocess.Popen(["osascript", "-e", script])
        elif shutil.which("notify-send"):
            subprocess.Popen(["notify-send", title, body])


def _q(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'
