#!/bin/bash
cd "$(dirname "$0")"
echo "Starting The Shelf setup..."
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js isn't installed. On Raspberry Pi OS / Debian / Ubuntu:"
  echo "  sudo apt install nodejs npm"
  echo "(or get it from https://nodejs.org), then run this again."
  read -p "Press Enter to close..."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "Note: npm isn't installed. The first install needs it to download The Shelf's"
  echo "libraries. If setup says they're missing, run:  sudo apt install npm"
  echo ""
fi
node install.js
status=$?
if [ $status -ne 0 ]; then
  echo ""
  read -p "Setup did not finish (see above). Press Enter to close..."
fi
exit $status
