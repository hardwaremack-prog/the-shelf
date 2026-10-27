#!/bin/bash
cd "$(dirname "$0")"
echo "Starting The Shelf setup..."
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then run this again."
  read -p "Press Enter to close..."
  exit 1
fi
node install.js
read -p "Press Enter to close..."
