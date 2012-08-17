// Bottom panel extension
// Copyright (C) 2012 Kasper Maurice Meerts
// License: GPLv2+
// Based on the extension made by R.M. Yorston

"use strict";

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

function WindowListItem(app, metaWindow) {
	this._init(app, metaWindow);
}

WindowListItem.prototype = {
	_init: function (metaWindow) {
		this.metaWindow = metaWindow;

		let tracker = Shell.WindowTracker.get_default();
		let app = tracker.get_window_app(metaWindow);

		/* A `WindowListItem` is actored by an StBoxLayout which envelops
		 * an StLabel and a ClutterTexture */
		this._itemBox = new St.BoxLayout({style_class: 'window-list-item-box',
		                                  reactive: 'true'});
		this.actor = this._itemBox;
		this.actor._delegate = this;

		/* Application icon */
		this.icon = app.create_icon_texture(16);
		this._itemBox.add(this.icon,  {x_fill: false, y_fill: false});

		/* Application name */
		this._label = new St.Label({style_class: 'window-list-item-label'});
		this._itemBox.add(this._label, {x_fill: true,  y_fill: false});
		this._onTitleChanged();

		/* Signals */
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
		this.actor.connect('button-press-event',
		                           Lang.bind(this, this._onButtonPress));

		this._notifyTitleId = metaWindow.connect('notify::title',
		                      Lang.bind(this, this._onTitleChanged));
	},

	_onTitleChanged: function () {
		let title;
		if (this.metaWindow.showing_on_its_workspace())
			title =       this.metaWindow.title;
		else
			title = '[' + this.metaWindow.title + ']';
		this._label.set_text(title);
	},

	_onDestroy: function () {
		// The actor is getting destroyed soon, no need to disconnect his
		// signals
		this.metaWindow.disconnect(this._notifyTitleId);
	},

	_onButtonPress: function (actor, event) {
			// The timestamp is necessary for window activation, so outdated 
			// requests can be ignored. This isn't necessary for minimization
			if (this.metaWindow.has_focus())
				this.metaWindow.minimize(global.get_current_time());
			else
				this.metaWindow.activate(global.get_current_time());
	},

	// Public methods
	doMinimize: this._onTitleChanged,

	doMap: this._onTitleChanged,

	doFocus: function () {
		if (this.metaWindow.has_focus()) {
			this._itemBox.add_style_pseudo_class('focused');
		} else {
			this._itemBox.remove_style_pseudo_class('focused');
		}
	},
}

function MessageButton() {
	this._init();
}

MessageButton.prototype = {
	_init: function() {
		this.actor = new St.Button({name: 'messageButton',
		                            style_class: 'message-button',
		                            reactive: true});
		this.setText();
		this.actorAddedId = Main.messageTray._summary.connect('actor-added',
		        Lang.bind(this, this.setText));
		this.actorRemovedId = Main.messageTray._summary.connect('actor-removed',
		        Lang.bind(this, this.setText));
		this.actor.connect('clicked', Lang.bind(this, this._onClicked));
		this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
	},

	setText: function () {
		if (Main.messageTray._summary.get_children().length == 0)
			this.actor.set_label(' ');
		else
			this.actor.set_label('!');
	},

	_onClicked: function () {
		Main.messageTray.toggleState();
	},

	_onDestroy: function () {
		if (this.actorAddedId)
			Main.messageTray._summary.disconnect(this.actorAddedId);
		if (this.actorRemovedId)
			Main.messageTray._summary.disconnect(this.actorRemovedId);
	}
}

function WindowList() {
	this._init();
}

WindowList.prototype = {
	_init: function () {
		this._workspaces = [];
		this._changeWorkspaces();
		// A list of `WindowListItem`s
		this._windows = [];

		this.actor = new St.BoxLayout({name: 'windowList',
		                               style_class: 'window-list-box',
	                                   reactive: true});
		this.actor._delegate = this;

		// Signals
		this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));

		let tracker = Shell.WindowTracker.get_default();
		tracker.connect('notify::focus-app', Lang.bind(this, this._onFocus));

		let wm = global.window_manager;
		wm.connect('minimize', Lang.bind(this, this._onMinimize));
		wm.connect('map', Lang.bind(this, this._onMap));
		wm.connect('switch-workspace', Lang.bind(this, this._reloadItems));
		global.screen.connect('notify::n-workspaces',
		                      Lang.bind(this, this._changeWorkspaces));

		this._reloadItems();
	},

	_changeWorkspaces: function () {
		for (let i in this._workspaces) {
			let ws = this._workspaces[i];
			ws.disconnect(ws._windowAddedId);
			ws.disconnect(ws._windowRemovedId);
		}

		this._workSpaces = [];
		for (let i = 0; i < global.screen.n_workspaces; i++) {
			let ws = global.screen.get_workspace_by_index(i);
			this._workspaces[i] = ws;
			ws._windowAddedId = ws.connect('window-added',
			                        Lang.bind(this, this._windowAdded));
			ws._windowAddedId = ws.connect('window-removed',
			                        Lang.bind(this, this._windowRemoved));
		}
	},

	_windowAdded: function (metaWorkspace, metaWindow) {
		if (metaWorkspace.index() != global.screen.get_active_workspace_index())
			return;

		this._addWindow(metaWindow)
	},

	_windowRemoved: function (metaWorkspace, metaWindow) {
		if (metaWorkspace.index() != global.screen.get_active_workspace_index())
			return;

		for (let i in this._windows) {
			let w = this._windows[i];
			if (w.metaWindow == metaWindow) {
				this.actor.remove_actor(w.actor);
				w.actor.destroy();
				this._windows.splice(i, 1);
				break;
			}
		}
	},

	/* When an arbitrary window gets focus, the appearance of the buttons is
	 * changed. I'd rather plug into the `focus` or `raise` signal, but then
	 * I wouldn't know what the previously focused window was. By diving into
	 * the mutter code, it is clear that a signal is only emitted on focus
	 * and not on defocus. Bullshit. XXX */
	_onFocus: function () {
		for (let i in this._windows) {
			this._windows[i].doFocus();
		}
	},

	_onMinimize: function (shellwm, actor) {
		for (let i in this._windows) {
			if (this._windows[i] == actor.get_meta_window()) {
				this._windows[i].doMinimize();
				return;
			}
		}
	},

	_onMap: function (shellwm, actor) {
		for (let i in this._windows) {
			if (this._windows[i] == actor.get_meta_window()) {
				this._windows[i].doMap();
				return;
			}
		}
	},

	_onScrollEvent: function (actor, event) {
		let diff = 0;
		if (event.get_scroll_direction() == Clutter.ScrollDirection.DOWN)
			diff = 1;
		else
			diff = -1;

		let ws = this._windows;
		let focus_i = -1;
		// I can't use the for(..in..) construction because that makes `i`
		// into a String. I don't get it either.
		for (let i = 0; i < ws.length; i++)
			if (ws[i].metaWindow.has_focus())
				focus_i = i;
		if (focus_i == -1)
			return;

		let new_i = focus_i + diff;
		if (new_i < 0)
			new_i = 0;
		else if (new_i >= ws.length)
			new_i = ws.length - 1;

		ws[new_i].metaWindow.activate(global.get_current_time());
	},

	_addWindow: function (metaWindow) {
		// The WindowTracker maintains a mapping between windows and apps
		let tracker = Shell.WindowTracker.get_default();
		// Interesting windows exclude stuff like docks, desktop, etc...
		if (!metaWindow || !tracker.is_window_interesting(metaWindow))
			return;
		let app = tracker.get_window_app(metaWindow);
		if (!app)
			return;
		let item = new WindowListItem(metaWindow);
		this._windows.push(item);
		this.actor.add(item.actor);
	},

	_reloadItems: function () {
		this.actor.destroy_children();
		this._windows = [];

		let metaWorkspace = global.screen.get_active_workspace();
		let windows = metaWorkspace.list_windows();
		windows.sort(function (w1, w2) {
			return w1.get_stable_sequence() - w2.get_stable_sequence();
		});

		for (let i = 0; i < windows.length; i++) {
			this._addWindow(windows[i]);
		}

		// To highlight the currently focused window
		this._onFocus();
	}
}

function BottomPanel() {
	this._init();
}

BottomPanel.prototype = {
	_init: function () {
		// Layout
		this.actor = new St.BoxLayout({style_class: 'bottom-panel',
		                               name: 'bottomPanel'});
		this.actor._delegate = this;

		this._windowList = new WindowList();
		this.actor.add(this._windowList.actor, {expand: true});

		this._messageButton = new MessageButton();
		this.actor.add(this._messageButton.actor);

		// Signals
		this.actor.connect('style-changed', Lang.bind(this, this.relayout));
		global.screen.connect('monitors-changed', Lang.bind(this,
		                                                    this.relayout));
	},

	relayout: function () {
		let prim = Main.layoutManager.primaryMonitor;
		let h = this.actor.get_theme_node().get_height();

		/* Only with these precise measurements will windows snap to it
		 * like a real panel. */
		this.actor.set_position(prim.x, prim.y + prim.height - h);
		this.actor.set_size(prim.width, -1);
	}
}

let bottomPanel = null;
let myShowTray, origShowTray;
let myHideTray, origHideTray;

function init(extensionMeta) {
	// For some fucked up reason, the (x,y) coordinates here are relative to
	// the bottom-left corner. That means that positive x-coordinates work
	// as expected, yet positive y-coordinates fall off the screen!

	// The first `MessageTray` is the namespace, the second is the actual Object
	origShowTray = MessageTray.MessageTray.prototype._showTray;
	myShowTray = function() {
		let h = bottomPanel.actor.get_theme_node().get_height();
		this._tween(this.actor, '_trayState', MessageTray.State.SHOWN,
		            { y: -this.actor.height - h,
					  time: MessageTray.ANIMATION_TIME,
					  transition: 'easeOutQuad'
					});
	};

	origHideTray = MessageTray.MessageTray.prototype._hideTray;
	myHideTray = function() {
		let h = bottomPanel.actor.get_theme_node().get_height();
		this._tween(this.actor, '_trayState', MessageTray.State.HIDDEN,
		            { y: this.actor.height,
					  time: MessageTray.ANIMATION_TIME,
					  transition: 'easeOutQuad'
					});
	};

	// I'll be honest, I don't really know what's going on here.
	// The code in messageTray.js is an absolute mess!
	MessageTray.MessageTray.prototype.toggleState = function() {
		if (this._summaryState == MessageTray.State.SHOWN ||
		    this._summaryState == MessageTray.State.SHOWING)
			this._pointerInSummary = false;
		else
			this._pointerInSummary = true;
		this._updateState();
	};

	bottomPanel = new BottomPanel();
}

function enable() {
	MessageTray.MessageTray.prototype._showTray = myShowTray;
	MessageTray.MessageTray.prototype._hideTray = myHideTray;

	Main.layoutManager.addChrome(bottomPanel.actor, {affectsStruts: true});
	bottomPanel.relayout();
}

function disable() {
	MessageTray.MessageTray.prototype._showTray = origShowTray;
	MessageTray.MessageTray.prototype._hideTray = origHideTray;

	Main.layoutManager.removeChrome(bottomPanel.actor);
}
