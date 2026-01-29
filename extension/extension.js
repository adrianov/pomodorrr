import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const WORK_DURATION_MIN = 25;
const WORK_TICK_MIN = 5;
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN = 15;
const SESSIONS_BEFORE_LONG = 3;

function iconFromPath(path) {
    const file = Gio.File.new_for_path(path);
    return new St.Icon({ gicon: new Gio.FileIcon({ file }), style_class: 'system-status-icon' });
}

export default class PomodorrrExtension extends Extension {
    enable() {
        this._state = 'idle';
        this._workDone = 0;
        this._workRemainMin = WORK_DURATION_MIN;
        this._breakRemainMin = 0;
        this._timerId = 0;

        const path = this.metadata.path;
        this._iconGreen = iconFromPath(`${path}/icons/tomato-green.svg`);
        this._iconRed = iconFromPath(`${path}/icons/tomato-red.svg`);

        this._label = new St.Label({ text: '', style_class: 'pomodorrr-label', y_align: Clutter.ActorAlign.CENTER });
        this._box = new St.BoxLayout();
        this._box.add_child(this._iconGreen);
        this._box.add_child(this._label);

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._indicator.add_child(this._box);
        this._indicator.connect('button-press-event', () => this._onClick());

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._render();
    }

    disable() {
        this._clearTimer();
        this._indicator?.destroy();
        this._indicator = null;
        this._iconGreen = null;
        this._iconRed = null;
        this._label = null;
        this._box = null;
    }

    _onClick() {
        if (this._state !== 'idle') return;
        this._state = 'work';
        this._workRemainMin = WORK_DURATION_MIN;
        this._startTick();
        this._render();
    }

    _startTick() {
        this._clearTimer();
        const isWork = this._state === 'work';
        const intervalSec = (isWork ? WORK_TICK_MIN : 1) * 60;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSec, () => this._tick());
    }

    _clearTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _tick() {
        if (this._state === 'work') {
            this._workRemainMin -= WORK_TICK_MIN;
            if (this._workRemainMin <= 0) {
                this._workDone += 1;
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

    _render() {
        this._box.remove_all_children();
        if (this._state === 'work') {
            this._box.add_child(this._iconRed);
            this._label.text = String(this._workRemainMin);
            this._label.visible = true;
            this._box.add_child(this._label);
        } else if (this._state === 'short_break' || this._state === 'long_break') {
            this._box.add_child(this._iconGreen);
            this._label.text = String(this._breakRemainMin);
            this._label.visible = true;
            this._box.add_child(this._label);
        } else {
            this._box.add_child(this._iconGreen);
            this._label.visible = false;
            this._box.add_child(this._label);
        }
    }
}
