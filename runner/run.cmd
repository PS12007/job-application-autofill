@echo off
rem Runs the job application runner with this folder's Python (no activation needed).
"%~dp0.venv\Scripts\python.exe" "%~dp0apply.py" %*
