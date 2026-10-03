#!/bin/bash
cd "$(dirname "$0")"
echo "Starting The Shelf setup..."
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js isn't installed. Get it from https://nodejs.org, or install it with your"
  echo "package manager (e.g. sudo apt install nodejs npm), then run this again."
  exit 1
fi
node install.js
