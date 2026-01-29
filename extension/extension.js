/**
 * Pomodorrr – Pomodoro timer in the GNOME top bar.
 * States: idle (goal) → work (tomato) → short/long break (palm) → idle.
 * Any click opens the menu; user chooses Idle, Work, Short/Long break, or Exit.
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** Work session length and tick interval (minutes). */
const WORK_DURATION_MIN = 25;
const WORK_TICK_MIN = 5;
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN = 15;
/** After this many work sessions, next break is long. */
const SESSIONS_BEFORE_LONG = 3;

const EMOJI_GOAL = '🎯';
const EMOJI_TOMATO = '🍅';
const EMOJI_PALM = '🌴';

function emojiIcon(emoji) {
    return new St.Label({ text: emoji, style_class: 'pomodorrr-emoji', y_align: Clutter.ActorAlign.CENTER });
}

export default class PomodorrrExtension extends Extension {
    /** Create panel indicator, menu, and load persisted completed-today count. */
    enable() {
        this._state = 'idle';
        this._workDone = 0;
        this._workRemainMin = WORK_DURATION_MIN;
        this._breakRemainMin = 0;
        this._timerId = 0;
        this._completedToday = 0;
        this._lastDate = null;
        this._loadState();

        this._iconGoal = emojiIcon(EMOJI_GOAL);
        this._iconTomato = emojiIcon(EMOJI_TOMATO);
        this._iconPalm = emojiIcon(EMOJI_PALM);

        this._label = new St.Label({ text: '', style_class: 'pomodorrr-label', y_align: Clutter.ActorAlign.CENTER });
        this._box = new St.BoxLayout();
        
        // Add all children once
        this._box.add_child(this._iconGoal);
        this._box.add_child(this._iconTomato);
        this._box.add_child(this._iconPalm);
        this._box.add_child(this._label);
        
        // Create PanelMenu.Button with auto-created menu (dontCreateMenu omitted/false)
        this._indicator = new PanelMenu.Button(0.5, this.metadata.name);
        this._indicator.add_child(this._box);
        
        // Build menu items
        this._buildMenu();
        
        /** Rebuild menu when it opens so dynamic content (e.g. completed count) is fresh. */
        if (this._indicator.menu) {
            this._indicator.menu.connect('open-state-changed', (menu, open) => {
                if (open) this._buildMenu();
            });
        }

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._render();
    }

    /** Remove timer and UI; called on disable or uninstall. */
    disable() {
        this._clearTimer();
        this._indicator?.destroy();
        this._indicator = null;
        this._iconGoal = null;
        this._iconTomato = null;
        this._iconPalm = null;
        this._label = null;
        this._box = null;
    }

    _getStatePath() {
        return `${GLib.get_user_config_dir()}/pomodorrr/state`;
    }

    /** Load last-save date and completed-today count from user config dir. */
    _loadState() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._getStatePath());
            if (!ok || !bytes) return;
            const str = (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)).trim();
            const parts = str.split(/\s+/);
            if (parts.length >= 2) {
                this._lastDate = parts[0];
                this._completedToday = Math.max(0, parseInt(parts[1], 10) || 0);
            }
        } catch (e) {}
    }

    /** Persist date and completed-today (format: "YYYY-MM-DD N\n") under ~/.config/pomodorrr/. */
    _saveState() {
        if (this._lastDate === null) return;
        try {
            const path = this._getStatePath();
            const dir = GLib.path_get_dirname(path);
            GLib.mkdir_with_parents(dir, 0o700);
            GLib.file_set_contents(path, `${this._lastDate} ${this._completedToday}\n`);
        } catch (e) {}
    }

    /** Zero completed-today and update _lastDate when date changes. */
    _resetCompletedIfNewDay() {
        const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
        if (this._lastDate !== today) {
            this._completedToday = 0;
            this._lastDate = today;
            this._saveState();
        }
    }

    /** Populate right-click menu: Idle, Work, Short/Long break, completed count, Exit. */
    _buildMenu() {
        this._resetCompletedIfNewDay();
        if (!this._indicator || !this._indicator.menu) return;
        this._indicator.menu.removeAll();
        
        this._indicator.menu.addAction('Idle', () => {
            this._clearTimer();
            this._state = 'idle';
            this._render();
        });
        
        this._indicator.menu.addAction('Work (25 min)', () => {
            this._state = 'work';
            this._workRemainMin = WORK_DURATION_MIN;
            this._startTick();
            this._render();
        });
        
        this._indicator.menu.addAction('Short break (5 min)', () => {
            this._state = 'short_break';
            this._breakRemainMin = SHORT_BREAK_MIN;
            this._startTick();
            this._render();
        });
        
        this._indicator.menu.addAction('Long break (15 min)', () => {
            this._state = 'long_break';
            this._breakRemainMin = LONG_BREAK_MIN;
            this._startTick();
            this._render();
        });
        
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        const completedItem = new PopupMenu.PopupMenuItem(`Completed today: ${this._completedToday}`);
        completedItem.setSensitive(false);
        this._indicator.menu.addMenuItem(completedItem);
        
        this._indicator.menu.addAction('Exit', () => {
            this._indicator.hide();
        });
    }

    /** Schedule next tick: every WORK_TICK_MIN for work, every 1 min for break. */
    _startTick() {
        this._clearTimer();
        const isWork = this._state === 'work';
        const intervalSec = (isWork ? WORK_TICK_MIN : 1) * 60;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSec, () => this._tick());
    }

    /** Cancel the current work/break timeout. */
    _clearTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    /** One tick: decrement work or break time; on end, switch state and reschedule or stop. */
    _tick() {
        if (this._state === 'work') {
            this._workRemainMin -= WORK_TICK_MIN;
            if (this._workRemainMin <= 0) {
                this._workDone += 1;
                this._completedToday += 1;
                this._saveState();
                this._state = this._workDone >= SESSIONS_BEFORE_LONG ? 'long_break' : 'short_break';
                this._breakRemainMin = this._state === 'long_break' ? LONG_BREAK_MIN : SHORT_BREAK_MIN;
            }
            this._startTick();
        } else {
            this._breakRemainMin -= 1;
            if (this._breakRemainMin <= 0) {
                if (this._state === 'long_break') this._workDone = 0;
                this._state = 'idle';
                this._clearTimer();
            } else {
                this._startTick();
            }
        }
        this._render();
        return GLib.SOURCE_REMOVE;
    }

    /** Panel icon by state: goal (idle), tomato (work), palm (break). */
    _iconForState() {
        if (this._state === 'work') return this._iconTomato;
        if (this._state === 'short_break' || this._state === 'long_break') return this._iconPalm;
        return this._iconGoal;
    }

    /** Label "minutes / N" (work/break remaining or 0 for idle; N = completed today). */
    _labelTextForState() {
        const n = this._completedToday;
        if (this._state === 'work') return `${this._workRemainMin} / ${n}`;
        if (this._state === 'short_break' || this._state === 'long_break')
            return `${this._breakRemainMin} / ${n}`;
        return `0 / ${n}`;
    }

    /** Update icon and label from current state. */
    _render() {
        this._resetCompletedIfNewDay();
        this._label.text = this._labelTextForState();
        
        // Hide all icons
        this._iconGoal.visible = false;
        this._iconTomato.visible = false;
        this._iconPalm.visible = false;
        
        // Show the correct icon
        const icon = this._iconForState();
        icon.visible = true;
    }
}
