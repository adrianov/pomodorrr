#!/bin/sh
# Install Pomodorrr GNOME Shell extension into user extensions dir.
set -e
UUID="pomodorrr@local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(dirname "$0")/extension"
mkdir -p "$DEST"
cp -r "$SRC"/* "$DEST/"
echo "Installed to $DEST"
echo "Enable with: gnome-extensions enable $UUID"
echo "Then restart GNOME Shell (Alt+F2, type 'r', Enter) or log out and back in."
