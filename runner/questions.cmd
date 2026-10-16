@echo off
rem Lists the questions waiting for an answer in questions.yaml.
"%~dp0.venv\Scripts\python.exe" "%~dp0questions.py" %*
