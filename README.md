# Pomodorrr

Pomodoro timer that runs in the GNOME top bar (status area).

## Features

- **Work (25 min)** (first menu item, submenu): **New goal…** opens a dialog to add a goal. Today’s goals listed with a check mark (✓) on the left for the active goal and tomato count (🍅) on the right. Click a goal to set it as active and start a 25 min work session; clicking the current goal marks it uncomplete again. Pomodoros count toward that goal. Work (25 min) submenu is expanded when the menu opens. **Mark current goal complete** (when a goal is active) marks it done; completed goals are removed tomorrow. Status bar shows active goal title (truncated) next to the timer.
- **Idle**: Goal emoji (🎯). **Work**: Tomato (🍅). **Short/Long break**: Palm (🌴). Label shows “minutes / N” or “goal · minutes / N” when a goal is active.
- **Menu**: Work (25 min) (submenu), Idle, Short break (5 min), Long break (15 min), Completed today: N, Exit.
- State and goals stored under `~/.config/pomodorrr/` (state, goals.json).

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

   If the extension **was disabled due to an error** (e.g. after a crash): restart GNOME Shell (step 2) so it loads the updated code, then run `gnome-extensions enable pomodorrr@local` again.

4. The indicator appears in the top bar.

**If the extension still doesn’t run:** GNOME Shell caches extension code for the whole session. After a crash it keeps using the old code until the session ends. You must **log out and log back in** (Wayland) or **restart the shell** (X11: Alt+F2 → `r` → Enter). After that, if the extension is in the enabled list, it will load the new code from disk and start on login. No need to run `gnome-extensions enable` again unless it’s disabled. Click it to open the menu and choose Idle, Work (25 min), Short break (5 min), Long break (15 min), or Exit.

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

## Lint

With Node/npm installed:

```sh
./lint.sh
```

Or: `npm install && npm run lint`

## Project layout

- `extension/` – GNOME Shell extension (metadata.json, extension.js, icons, stylesheet).
- `install.sh` – Copies extension to `~/.local/share/gnome-shell/extensions/pomodorrr@local/`.
- `README.md`, `TODO.md`, `.cursorrules` – Docs and project rules.
