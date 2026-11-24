#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node app/launcher.mjs restart
forge_exit=$?
if [ "$forge_exit" -ne 0 ]; then read -r -p 'Press Return to close. '; fi
exit "$forge_exit"
