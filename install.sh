#!/usr/bin/env bash
# The Shelf - one-line installer for Mac, Linux and Raspberry Pi.
# Run in a terminal:
#   curl -fsSL https://raw.githubusercontent.com/hardwaremack-prog/the-shelf/main/install.sh | bash
# Downloads the newest The Shelf from GitHub and opens the usual setup page (pick where it goes,
# start automatically, Install). Your shelves and data in an existing install are never touched.
set -e
REPO=hardwaremack-prog/the-shelf
echo
echo "The Shelf - installing"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed."
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing it with apt (asks for your password)..."
    sudo apt-get update -y && sudo apt-get install -y nodejs npm
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js (LTS) from https://nodejs.org, then run this again."; exit 1
fi
SHA=$(curl -fsSL -H 'User-Agent: TheShelf' "https://api.github.com/repos/$REPO/commits/main" 2>/dev/null | grep -o '"sha" *: *"[0-9a-f]\{40\}"' | head -1 | grep -o '[0-9a-f]\{40\}' || true)
REF=${SHA:-refs/heads/main}
TMP=$(mktemp -d)
echo "Downloading the newest The Shelf from GitHub..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -n "$SHA" ]; then printf '{"sha":"%s","installedAt":0}\n' "$SHA" > "$SRC/.shelf-version.json"; fi
echo "Opening the setup page in your browser. Leave this terminal open until setup says it's done."
node "$SRC/installer/install.js"
