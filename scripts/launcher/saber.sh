#!/bin/sh
# Saber repository-first launcher (Linux and macOS).
# Usage:   ./saber.sh    (from any directory inside a Git repository)
# Requires SABER_EXE to point at the installed Saber executable.
if [ -z "${SABER_EXE:-}" ]; then
  echo "Set SABER_EXE to the installed Saber executable (e.g. /Applications/Saber.app/Contents/MacOS/Saber or ~/.local/bin/saber), then run $0 again." >&2
  exit 1
fi
# The desktop app and its local server inherit this variable; the server reads it
# from GET /api/launch-context to detect and open the repository under the shell.
SABER_LAUNCH_CWD="$PWD" "$SABER_EXE" &
