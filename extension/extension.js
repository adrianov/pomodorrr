/**
 * Pomodorrr – Pomodoro timer in the GNOME top bar with goals.
 * States: idle (goal) → work (tomato) → short/long break (palm) → idle.
 * Menu: Work or Study (25 min) submenu (uncollapsed; New goal…, today’s goals; check = completed; click goal = start 25 min; selecting completed goal uncompletes it; Complete only for incomplete goals; completing current goal resets to Idle), breaks/Idle/Exit.
 * Copyright (c) 2026 Peter Adrianov. MIT License.
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Atk from 'gi://Atk';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

/** Work session length and tick interval (minutes). */
const WORK_DURATION_MIN = 25;
const WORK_TICK_MIN = 5;
/** When this many minutes or less remain, status bar updates every minute. */
const WORK_LAST_MINUTES = 5;
const WORK_TICK_LAST_MIN = 1;
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN = 15;
/** Break countdown tick interval (minutes); display 15 → 10 → 5 → 0. */
const BREAK_TICK_MIN = 5;
/** Max goal title length in panel; longer titles get truncated with ellipsis. */
const PANEL_GOAL_TITLE_MAX = 40;

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

    /** Zero completed-today and update _lastDate when date changes. Only reset count when we had a previous stored date (day rollover); when _lastDate is null, set date and keep current count so task-finish increment is not wiped. */
    _resetCompletedIfNewDay() {
        const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
        if (this._lastDate === today) return;
        if (this._lastDate !== null) this._completedToday = 0;
        this._lastDate = today;
        this._saveState();
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

    /** Show dialog to add a new goal; on Add, save and rebuild menu. Enter submits when title not empty. "Start now" checked by default when no current goal. */
    _showAddGoalDialog() {
        const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true, styleClass: 'pomodorrr-dialog' });
        const box = new St.BoxLayout({ vertical: true });
        box.add_child(new St.Label({ text: 'Goal name', style_class: 'pomodorrr-dialog-label' }));
        const entry = new St.Entry({ can_focus: true });
        box.add_child(entry);
        const startNowRow = new St.BoxLayout();
        let startNow = this._activeGoalId === null;
        const checkLabel = new St.Label({ text: startNow ? '☑ Start now' : '☐ Start now', style_class: 'pomodorrr-dialog-label' });
        const checkBtn = new St.Button({ child: checkLabel, style_class: 'pomodorrr-dialog-check-btn', can_focus: true });
        const updateToggle = () => {
            checkLabel.text = startNow ? '☑ Start now' : '☐ Start now';
            const atk = checkBtn.get_accessible();
            if (atk) {
                const set = atk.get_state_set();
                if (startNow) set.add_state(Atk.StateType.CHECKED);
                else set.remove_state(Atk.StateType.CHECKED);
            }
        };
        try {
            const atk = checkBtn.get_accessible();
            if (atk) {
                atk.set_role(Atk.Role.CHECK_BOX);
                if (startNow) atk.get_state_set().add_state(Atk.StateType.CHECKED);
            }
        } catch {}
        checkBtn.connect('clicked', () => {
            startNow = !startNow;
            updateToggle();
        });
        checkBtn.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) {
                startNow = !startNow;
                updateToggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        startNowRow.add_child(checkBtn);
        box.add_child(startNowRow);
        dialog.contentLayout.add_child(box);
        const doAdd = () => {
            const raw = entry.get_text ? entry.get_text() : (entry.text ?? '');
            const text = String(raw).trim();
            if (text) {
                const id = GLib.uuid_string_random ? GLib.uuid_string_random() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                this._goals.push({ id, text, completed: false, completedDate: null });
                this._saveGoals();
                const otherWorkActive = this._state === 'work' && this._activeGoalId !== null;
                if (startNow && !otherWorkActive) {
                    this._activeGoalId = id;
                    this._state = 'work';
                    this._workRemainMin = WORK_DURATION_MIN;
                    this._startTick();
                    this._render();
                }
                this._buildMenu();
            }
            dialog.close(global.get_current_time());
        };
        dialog.setButtons([
            { label: 'Cancel', action: () => dialog.close(global.get_current_time()) },
            { label: 'Add', isDefault: true, action: doAdd }
        ]);
        entry.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                doAdd();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        dialog.open(global.get_current_time());
        if (entry.grab_key_focus) entry.grab_key_focus();
    }

    /** Show confirmation; on confirm delete goal by id and reset to Idle if it was active. */
    _showDeleteGoalConfirm(goalId) {
        const goal = this._goals.find(g => g.id === goalId);
        if (!goal) return;
        const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true, styleClass: 'pomodorrr-dialog' });
        const msg = new St.Label({ text: `Delete goal "${goal.text}"?`, style_class: 'pomodorrr-dialog-label' });
        dialog.contentLayout.add_child(msg);
        dialog.setButtons([
            { label: 'Cancel', action: () => dialog.close(global.get_current_time()) },
            { label: 'Delete', action: () => {
                this._goals = this._goals.filter(g => g.id !== goalId);
                delete this._pomodoros[goalId];
                const wasActive = this._activeGoalId === goalId;
                if (wasActive) {
                    this._activeGoalId = null;
                    this._clearTimer();
                    this._state = 'idle';
                }
                this._saveGoals();
                this._buildMenu();
                // Only refresh panel when deleted goal was active; avoid resetting status bar title for other tasks.
                if (wasActive) this._render();
                dialog.close(global.get_current_time());
            } }
        ]);
        dialog.open(global.get_current_time());
    }

    /** Populate menu: Work or Study (submenu with New goal + goals; check = active), then breaks/Idle/Exit. */
    _buildMenu() {
        this._resetCompletedIfNewDay();
        this._pruneCompletedGoals();
        if (!this._indicator || !this._indicator.menu) return;
        this._indicator.menu.removeAll();

        const workSub = new PopupMenu.PopupSubMenuMenuItem('Work or Study (25 min)', true);
        const workIcon = new St.Icon({ icon_name: 'document-edit-symbolic', style_class: 'popup-menu-icon' });
        workSub.actor.insert_child_at_index(workIcon, 0);
        workSub.menu.addAction('New goal...', () => this._showAddGoalDialog(), 'list-add-symbolic');

        const today = this._getToday();
        let firstGoal = true;
        for (const goal of [...this._goals].reverse()) {
            if (goal.completed && goal.completedDate !== today) continue;
            if (!firstGoal) workSub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            firstGoal = false;
            const count = this._goalPomodorosToday(goal.id);
            const tomatoes = EMOJI_TOMATO.repeat(count);
            const check = goal.completed ? ` ${EMOJI_CHECK}` : '';
            const label = `${goal.text}  ${tomatoes}${check}`;
            const startWork = () => {
                if (goal.completed) {
                    goal.completed = false;
                    goal.completedDate = null;
                    this._saveGoals();
                }
                this._activeGoalId = goal.id;
                this._state = 'work';
                this._workRemainMin = WORK_DURATION_MIN;
                this._startTick();
                this._render();
            };
            const goalItem = new PopupMenu.PopupMenuItem(label);
            const icon = new St.Icon({ icon_name: 'media-playback-start-symbolic', style_class: 'popup-menu-icon' });
            goalItem.actor.insert_child_at_index(icon, 0);
            goalItem.connect('activate', startWork);
            if (goal.id === this._activeGoalId && goal.completed) goalItem.actor.add_style_class_name('pomodorrr-goal-active');
            workSub.menu.addMenuItem(goalItem);
            if (!goal.completed) {
                workSub.menu.addAction('Complete', () => {
                    goal.completed = true;
                    goal.completedDate = today;
                    if (this._activeGoalId === goal.id) {
                        this._activeGoalId = null;
                        this._state = 'idle';
                        this._clearTimer();
                        this._saveState();
                        this._render();
                    }
                    this._saveGoals();
                    this._buildMenu();
                }, 'emblem-ok-symbolic');
            }
            workSub.menu.addAction('Delete', () => this._showDeleteGoalConfirm(goal.id), 'edit-delete-symbolic');
        }

        this._indicator.menu.addMenuItem(workSub);
        if (typeof workSub.setSubmenuShown === 'function') {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                workSub.setSubmenuShown(true);
                return false;
            });
        }
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._indicator.menu.addAction('Short break (5 min)', () => {
            this._state = 'short_break';
            this._activeGoalId = null;
            this._breakRemainMin = SHORT_BREAK_MIN;
            this._startTick();
            this._render();
        }, 'alarm-symbolic');

        this._indicator.menu.addAction('Long break (15 min)', () => {
            this._state = 'long_break';
            this._activeGoalId = null;
            this._breakRemainMin = LONG_BREAK_MIN;
            this._startTick();
            this._render();
        }, 'weather-clear-symbolic');

        this._indicator.menu.addAction('Idle', () => {
            this._clearTimer();
            this._state = 'idle';
            this._activeGoalId = null;
            this._render();
        }, 'media-playback-pause-symbolic');

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const completedItem = new PopupMenu.PopupMenuItem(`Completed today: ${this._completedToday}`);
        completedItem.actor.add_style_class_name('pomodorrr-info');
        this._indicator.menu.addMenuItem(completedItem);

        this._indicator.menu.addAction('Exit', () => this._indicator.hide(), 'application-exit-symbolic');
    }

    /** Schedule next tick: every WORK_TICK_MIN/BREAK_TICK_MIN normally, or 1 min when ≤WORK_LAST_MINUTES remain (work and breaks). */
    _startTick() {
        this._clearTimer();
        const isWork = this._state === 'work';
        let intervalMin;
        if (isWork) {
            intervalMin = this._workRemainMin <= WORK_LAST_MINUTES ? WORK_TICK_LAST_MIN : WORK_TICK_MIN;
        } else {
            intervalMin = this._breakRemainMin <= WORK_LAST_MINUTES ? WORK_TICK_LAST_MIN : BREAK_TICK_MIN;
        }
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalMin * 60, () => this._tick());
    }

    /** Cancel the current work/break timeout. */
    _clearTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    /** Play a system theme sound (canberra event id); no-op if canberra not available. */
    _playSound(eventId) {
        try {
            GLib.spawn_async(null, ['canberra-gtk-play', '-i', eventId], null, GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP, null);
        } catch {}
    }

    /** One tick: decrement work or break time; on end, switch state and reschedule or stop. Last WORK_LAST_MINUTES of work/break tick by 1 min. */
    _tick() {
        if (this._state === 'work') {
            const step = this._workRemainMin <= WORK_LAST_MINUTES ? WORK_TICK_LAST_MIN : WORK_TICK_MIN;
            this._workRemainMin -= step;
            if (this._workRemainMin <= 0) {
                this._playSound('complete');
                this._completedToday += 1;
                if (this._activeGoalId) {
                    const today = this._getToday();
                    if (!this._pomodoros[this._activeGoalId]) this._pomodoros[this._activeGoalId] = {};
                    this._pomodoros[this._activeGoalId][today] = (this._pomodoros[this._activeGoalId][today] || 0) + 1;
                    this._saveGoals();
                }
                this._saveState();
                this._state = this._completedToday % 3 === 0 ? 'long_break' : 'short_break';
                this._activeGoalId = null;
                this._breakRemainMin = this._state === 'long_break' ? LONG_BREAK_MIN : SHORT_BREAK_MIN;
            }
            this._startTick();
        } else {
            const step = this._breakRemainMin <= WORK_LAST_MINUTES ? WORK_TICK_LAST_MIN : BREAK_TICK_MIN;
            this._breakRemainMin -= step;
            if (this._breakRemainMin <= 0) {
                this._playSound('bell');
                this._state = 'idle';
                this._activeGoalId = null;
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

    /** Label: optional goal title + timer/count. Idle: count only; work/break: "N min · count". */
    _labelTextForState() {
        const n = this._completedToday;
        let timePart;
        if (this._state === 'idle') timePart = String(n);
        else if (this._state === 'work') timePart = `${this._workRemainMin} min · ${n}`;
        else timePart = `${this._breakRemainMin} min · ${n}`;
        const goal = this._goals.find(g => g.id === this._activeGoalId);
        const title = goal ? (goal.text.length > PANEL_GOAL_TITLE_MAX ? goal.text.slice(0, PANEL_GOAL_TITLE_MAX - 1) + '…' : goal.text) : '';
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
