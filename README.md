# Pomodorrr

Pomodoro timer that runs in the GNOME top bar (status area).

## Features

- **Idle**: Green tomato icon. Click to start a work session.
- **Work**: Red tomato with remaining minutes (25 → 20 → 15 → 10 → 5, every 5 minutes). One click starts the session.
- **Short break**: Green tomato with countdown (5 minutes). After 1 or 2 work sessions.
- **Long break**: Green tomato with countdown (15 minutes). After 3 work sessions, then back to idle.
- Timer runs in the panel; no extra windows.

## Build and run

1. **Install** (copy extension into GNOME Shell extensions dir):

   ```sh
   ./install.sh
   ```

2. **Restart GNOME Shell** so it discovers the new extension (it only reads the extension list at startup):
   - **Wayland**: Log out and log back in.
   - **X11**: Alt+F2, type `r`, Enter.

3. **Enable** the extension (in any terminal on your desktop, e.g. Cursor or GNOME Terminal):

   ```sh
   gnome-extensions enable pomodorrr@local
   ```

   If you get **"Extension does not exist"**: you are in your normal session and GNOME Shell has not been restarted since install. Do step 2 first, then run this again.

4. The tomato icon appears in the top bar. Click it once when idle to start a 25-minute work session.

## Requirements

- GNOME Shell 45 or 46 (tested on 46).

## Development / nested session

To test without logging out (Wayland):

```sh
dbus-run-session gnome-shell --devkit --wayland
```

In the nested session, open a terminal and run:

```sh
gnome-extensions enable pomodorrr@local
```

After code changes, disable and re-enable the extension, or restart the nested shell.

## Project layout

- `extension/` – GNOME Shell extension (metadata.json, extension.js, icons, stylesheet).
- `install.sh` – Copies extension to `~/.local/share/gnome-shell/extensions/pomodorrr@local/`.
- `README.md`, `TODO.md`, `.cursorrules` – Docs and project rules.
