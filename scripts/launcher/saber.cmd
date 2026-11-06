@echo off
setlocal
rem Saber repository-first launcher (Windows).
rem Usage:   saber.cmd      (from any directory inside a Git repository)
rem Requires SABER_EXE to point at the installed Saber executable.
if "%SABER_EXE%"=="" (
  echo Set SABER_EXE to the installed Saber executable, e.g. "%%LOCALAPPDATA%%\Programs\Saber\Saber.exe", then run saber.cmd again. 1>&2
  exit /b 1
)
set SABER_LAUNCH_CWD=%CD%
start "" "%SABER_EXE%"
