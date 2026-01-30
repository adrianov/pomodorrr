#!/bin/sh
# Install Pomodorrr GNOME Shell extension into user extensions dir.
set -e
UUID="pomodorrr@local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(dirname "$0")/extension"
mkdir -p "$DEST"
cp -r "$SRC"/* "$DEST/"
echo "Installed to $DEST"
echo ""
echo "If the extension was previously disabled due to an error, you MUST restart"
echo "GNOME Shell first (Wayland: log out and back in; X11: Alt+F2, r, Enter)"
echo "so the new code is loaded. Then run:"
echo "  gnome-extensions enable $UUID"
