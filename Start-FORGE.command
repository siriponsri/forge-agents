#!/bin/bash
cd "$(dirname "$0")" || exit 1
# Finder uses a smaller PATH than an interactive Terminal.
for forge_bin in /opt/homebrew/bin /usr/local/bin; do
  if [ -x "$forge_bin/node" ]; then
    export PATH="$forge_bin:$PATH"
    break
  fi
done
if ! command -v node >/dev/null 2>&1; then
  printf '\nFORGE needs Node.js 24.13 or newer.\nInstall Node.js LTS from https://nodejs.org, then open this file again.\n'
  read -r -p 'Press Return to close. '
  exit 1
fi
node app/launcher.mjs start
forge_exit=$?
if [ "$forge_exit" -ne 0 ]; then
  read -r -p 'FORGE could not start. Read the message above. Press Return to close. '
fi
exit "$forge_exit"
