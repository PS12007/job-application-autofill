@echo off
rem Dumps the fields of the page you are looking at in the runner's browser.
"%~dp0.venv\Scripts\python.exe" "%~dp0dump_fields.py" %*
