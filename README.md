# Pomodorrr

Pomodoro timer in the GNOME Shell top bar (status area).

## The Pomodoro technique

The method was created by Francesco Cirillo in the late 1980s. As a student, he struggled to focus; using a tomato-shaped kitchen timer (*pomodoro* in Italian) for short work blocks helped him stay on task. He later formalized the approach.

**How to use:** Pick one task, set a timer for 25 minutes, and work without switching to other work. When the timer rings, stop and take a short break (about 5 minutes). After every three or four such work sessions, take a longer break (about 15 minutes). Each 25-minute block is one “pomodoro.”

**Why it works:** Fixed time blocks reduce the urge to procrastinate and make starting easier. Regular breaks reduce mental fatigue and help you sustain focus across the day. The clear start and end of each pomodoro create a simple ritual, and the timer removes the need to watch the clock yourself.

## Features

### Work or Study (25 min)

First menu item; submenu opens expanded.

- **New goal…** — Add a goal. If you're idle (or not in work with another goal), the new goal becomes active and a 25 min work session starts.
- Each goal has a row (▶ + label + 🍅 count + ✓ if completed): click to start 25 min work (or un-complete if it was completed). Below it: **Complete** and **Delete** with icons.
- Completed goals are cleared the next day.
- The panel shows the active goal title (truncated) and the timer.

### Panel icon and label

- **Idle:** 🎯  
- **Work or Study:** 🍅  
- **Short/long break:** 🌴  

Label format: `minutes · N` or `goal · minutes · N` (N = completed pomodoros today). In the last 5 minutes of a work session or break, the minutes value in the status bar updates every minute.

### Menu

Work or Study (25 min) submenu, Idle, Short break (5 min), Long break (15 min), Completed today: N, Exit. After every third pomodoro completed today the extension automatically starts a 15-minute long break; otherwise it uses a 5-minute short break.

### Sounds

- End of work: system "complete" sound.
- End of break: "bell" (via `canberra-gtk-play` when available).

### Storage

`~/.config/pomodorrr/` (state file and goals.json).

## Build and run

1. **Install** — Copy the extension into the GNOME Shell extensions directory:

   ```sh
   ./install.sh
   ```

2. **Restart GNOME Shell** so it picks up the extension (extensions are discovered only at startup):
   - **Wayland**: Log out and log back in. From a terminal: `gnome-session-quit --logout --no-prompt`
   - **X11**: Alt+F2, type `r`, Enter.

3. **Enable** the extension (from a terminal on your desktop):

   ```sh
   gnome-extensions enable pomodorrr@local
   ```

   If you see **"Extension does not exist"**, GNOME Shell has not been restarted since install. Do step 2, then run the enable command again.

   If the extension **was disabled due to an error** (e.g. after a crash), restart GNOME Shell (step 2) so it loads the updated code, then run `gnome-extensions enable pomodorrr@local` again.

4. The indicator appears in the top bar. Click it to open the menu.

**If the extension still doesn't run:** GNOME Shell caches extension code for the session. After a crash it keeps using the old code until the session ends. **Log out and log back in** (Wayland) or **restart the shell** (X11: Alt+F2 → `r` → Enter). After that, if the extension is enabled, it loads the new code from disk on login. No need to run `gnome-extensions enable` again unless it was disabled.

## Requirements

- GNOME Shell 45 or 46 (tested on 46).

## Development (nested session)

To test without logging out on Wayland:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

In the nested session, open a terminal and run:

```sh
gnome-extensions enable pomodorrr@local
```

After code changes, disable and re-enable the extension or restart the nested shell.

## Lint

With Node/npm installed:

```sh
./lint.sh
```

Or: `npm install && npm run lint`

## License

MIT. Copyright (c) 2026 Peter Adrianov.

## Project layout

- `extension/` – GNOME Shell extension (metadata.json, extension.js, emoji icons, stylesheet.css).
- `install.sh` – Installs the extension to `~/.local/share/gnome-shell/extensions/pomodorrr@local/`.
- `README.md`, `TODO.md`, `.cursorrules` – Documentation and project rules.
