#!/bin/sh
# Run ESLint on extension JS. Finds npm in common locations if not in PATH.
set -e
cd "$(dirname "$0")"

# Prefer nvm/fnm node if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
elif [ -d "$HOME/.local/share/fnm" ]; then
    export PATH="$HOME/.local/share/fnm/current/bin:$PATH"
fi
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found. Install Node.js and npm, then run: npm install && npm run lint"
    exit 1
fi

npm install && npm run lint
