/**
 * Pomodorrr – Pomodoro timer in the GNOME top bar with goals.
 * States: idle (goal) → work (tomato) → short/long break (palm) → idle.
 * Menu: Work (25 min) submenu (uncollapsed; New goal…, today’s goals; check = active; click goal = start 25 min, click current = uncomplete), Idle/breaks/Exit.
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

/** Work session length and tick interval (minutes). */
const WORK_DURATION_MIN = 25;
const WORK_TICK_MIN = 5;
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN = 15;
/** After this many work sessions, next break is long. */
const SESSIONS_BEFORE_LONG = 3;
/** Break countdown tick interval (minutes); display 15 → 10 → 5 → 0. */
const BREAK_TICK_MIN = 5;

const EMOJI_GOAL = '🎯';
const EMOJI_TOMATO = '🍅';
const EMOJI_PALM = '🌴';
const EMOJI_CHECK = '✅';

function emojiIcon(emoji) {
    return new St.Label({
        text: emoji,
        style_class: 'pomodorrr-emoji',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: false
    });
}

export default class PomodorrrExtension extends Extension {
    /** Create panel indicator, menu, and load persisted state and goals. */
    enable() {
        this._state = 'idle';
        this._workDone = 0;
        this._workRemainMin = WORK_DURATION_MIN;
        this._breakRemainMin = 0;
        this._timerId = 0;
        this._completedToday = 0;
        this._lastDate = null;
        this._goals = [];
        this._pomodoros = {};
        this._activeGoalId = null;
        this._loadState();
        this._loadGoals();
        this._pruneCompletedGoals();

        this._iconGoal = emojiIcon(EMOJI_GOAL);
        this._iconTomato = emojiIcon(EMOJI_TOMATO);
        this._iconPalm = emojiIcon(EMOJI_PALM);

        this._label = new St.Label({
            text: '',
            style_class: 'pomodorrr-label',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false
        });
        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._box.add_child(this._iconGoal);
        this._box.add_child(this._iconTomato);
        this._box.add_child(this._iconPalm);
        this._box.add_child(this._label);

        this._indicator = new PanelMenu.Button(0.5, this.metadata.name, false);
        this._indicator.add_child(this._box);
        this._indicator.menu.connect('open-state-changed', (_m, open) => {
            if (open) this._buildMenu();
        });
        // Build initial menu so it's not empty on first click
        this._buildMenu();
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
        } catch {}
    }

    /** Persist date and completed-today (format: "YYYY-MM-DD N\n") under ~/.config/pomodorrr/. */
    _saveState() {
        if (this._lastDate === null) return;
        try {
            const path = this._getStatePath();
            const dir = GLib.path_get_dirname(path);
            GLib.mkdir_with_parents(dir, 0o700);
            GLib.file_set_contents(path, `${this._lastDate} ${this._completedToday}\n`);
        } catch {}
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

    _getGoalsPath() {
        return `${GLib.get_user_config_dir()}/pomodorrr/goals.json`;
    }

    _getToday() {
        return GLib.DateTime.new_now_local().format('%Y-%m-%d');
    }

    /** Load goals and per-goal pomodoro counts from user config. */
    _loadGoals() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._getGoalsPath());
            if (!ok || !bytes) return;
            const str = (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)).trim();
            if (!str) return;
            const data = JSON.parse(str);
            this._goals = Array.isArray(data.goals) ? data.goals : [];
            this._pomodoros = data.pomodoros && typeof data.pomodoros === 'object' ? data.pomodoros : {};
        } catch {}
    }

    /** Persist goals and pomodoros to ~/.config/pomodorrr/goals.json. */
    _saveGoals() {
        try {
            const path = this._getGoalsPath();
            const dir = GLib.path_get_dirname(path);
            GLib.mkdir_with_parents(dir, 0o700);
            const data = JSON.stringify({ goals: this._goals, pomodoros: this._pomodoros });
            GLib.file_set_contents(path, data);
        } catch {}
    }

    /** Remove goals marked complete on a past day. */
    _pruneCompletedGoals() {
        const today = this._getToday();
        this._goals = this._goals.filter(g => !g.completed || g.completedDate === today);
        this._saveGoals();
    }

    _goalPomodorosToday(goalId) {
        const today = this._getToday();
        return (this._pomodoros[goalId] && this._pomodoros[goalId][today]) || 0;
    }

    /** Show dialog to add a new goal; on Add, save and rebuild menu. */
    _showAddGoalDialog() {
        const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true, styleClass: 'pomodorrr-dialog' });
        const box = new St.BoxLayout({ vertical: true });
        box.add_child(new St.Label({ text: 'Goal name', style_class: 'pomodorrr-dialog-label' }));
        const entry = new St.Entry({ can_focus: true });
        box.add_child(entry);
        dialog.contentLayout.add_child(box);
        dialog.setButtons([
            { label: 'Cancel', action: () => dialog.close(global.get_current_time()) },
            { label: 'Add', isDefault: true, action: () => {
                const raw = entry.get_text ? entry.get_text() : (entry.text ?? '');
                const text = String(raw).trim();
                if (text) {
                    const id = GLib.uuid_string_random ? GLib.uuid_string_random() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    this._goals.push({ id, text, completed: false, completedDate: null });
                    this._saveGoals();
                    this._buildMenu();
                }
                dialog.close(global.get_current_time());
            } }
        ]);
        dialog.open(global.get_current_time());
        if (entry.grab_key_focus) entry.grab_key_focus();
    }

    /** Show confirmation; on confirm delete current goal and reset to Idle. */
    _showDeleteGoalConfirm() {
        const goal = this._goals.find(g => g.id === this._activeGoalId);
        if (!goal) return;
        const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true, styleClass: 'pomodorrr-dialog' });
        const msg = new St.Label({ text: `Delete goal "${goal.text}"?`, style_class: 'pomodorrr-dialog-label' });
        dialog.contentLayout.add_child(msg);
        dialog.setButtons([
            { label: 'Cancel', action: () => dialog.close(global.get_current_time()) },
            { label: 'Delete', action: () => {
                this._goals = this._goals.filter(g => g.id !== this._activeGoalId);
                delete this._pomodoros[this._activeGoalId];
                this._activeGoalId = null;
                this._clearTimer();
                this._state = 'idle';
                this._saveGoals();
                this._buildMenu();
                this._render();
                dialog.close(global.get_current_time());
            } }
        ]);
        dialog.open(global.get_current_time());
    }

    /** Populate menu: Work (submenu with New goal + goals; check = active), then Idle/breaks/Exit. */
    _buildMenu() {
        this._resetCompletedIfNewDay();
        this._pruneCompletedGoals();
        if (!this._indicator || !this._indicator.menu) return;
        this._indicator.menu.removeAll();

        const workSub = new PopupMenu.PopupSubMenuMenuItem('Work (25 min)', false);
        workSub.menu.addAction('New goal...', () => this._showAddGoalDialog());

        const today = this._getToday();
        for (const goal of this._goals) {
            if (goal.completed && goal.completedDate !== today) continue;
            const count = this._goalPomodorosToday(goal.id);
            const tomatoes = EMOJI_TOMATO.repeat(count);
            const check = goal.completed ? ` ${EMOJI_CHECK}` : '';
            const label = `${goal.text}  ${tomatoes}${check}`;
            const item = new PopupMenu.PopupMenuItem(label);
            if (goal.id === this._activeGoalId && goal.completed) item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => {
                if (goal.id === this._activeGoalId) {
                    goal.completed = false;
                    goal.completedDate = null;
                    this._saveGoals();
                }
                this._activeGoalId = goal.id;
                this._state = 'work';
                this._workRemainMin = WORK_DURATION_MIN;
                this._startTick();
                this._render();
            });
            workSub.menu.addMenuItem(item);
        }

        if (this._activeGoalId) {
            workSub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            workSub.menu.addAction('Mark current goal complete', () => {
                const goal = this._goals.find(g => g.id === this._activeGoalId);
                if (goal) {
                    goal.completed = true;
                    goal.completedDate = today;
                    this._activeGoalId = null;
                    this._saveGoals();
                    this._buildMenu();
                }
            });
            workSub.menu.addAction('Delete current goal', () => this._showDeleteGoalConfirm());
        }

        this._indicator.menu.addMenuItem(workSub);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._indicator.menu.addAction('Idle', () => {
            this._clearTimer();
            this._state = 'idle';
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

        this._indicator.menu.addAction('Exit', () => this._indicator.hide());
    }

    /** Schedule next tick: every WORK_TICK_MIN for work, every BREAK_TICK_MIN for break (15→10→5→0). */
    _startTick() {
        this._clearTimer();
        const isWork = this._state === 'work';
        const intervalSec = (isWork ? WORK_TICK_MIN : BREAK_TICK_MIN) * 60;
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
                if (this._activeGoalId) {
                    const today = this._getToday();
                    if (!this._pomodoros[this._activeGoalId]) this._pomodoros[this._activeGoalId] = {};
                    this._pomodoros[this._activeGoalId][today] = (this._pomodoros[this._activeGoalId][today] || 0) + 1;
                    this._saveGoals();
                }
                this._saveState();
                this._state = this._workDone >= SESSIONS_BEFORE_LONG ? 'long_break' : 'short_break';
                this._breakRemainMin = this._state === 'long_break' ? LONG_BREAK_MIN : SHORT_BREAK_MIN;
            }
            this._startTick();
        } else {
            this._breakRemainMin -= BREAK_TICK_MIN;
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

    /** Label: optional goal title + "minutes / N" (N = completed today). */
    _labelTextForState() {
        const n = this._completedToday;
        let timePart = `0 / ${n}`;
        if (this._state === 'work') timePart = `${this._workRemainMin} / ${n}`;
        else if (this._state === 'short_break' || this._state === 'long_break') timePart = `${this._breakRemainMin} / ${n}`;
        const goal = this._goals.find(g => g.id === this._activeGoalId);
        const title = goal ? (goal.text.length > 12 ? goal.text.slice(0, 11) + '…' : goal.text) : '';
        return title ? `${title} · ${timePart}` : timePart;
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
