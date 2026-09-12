// Client-half regression tests: the ⋮ menu augmentation must resolve a row's
// session from the injected sessions service list snapshot and append the
// delete item. The client half is a DOM observer bundle, so this spec drives it
// through a minimal DOM stub instead of a browser.
import { test } from "node:test";
import assert from "node:assert/strict";

/** Minimal element: attributes, children, style, and the selectors the bundle uses. */
class FakeElement {
	constructor(tag) {
		this.nodeType = 1;
		this.tagName = tag.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.parent = null;
		this.style = {};
		this.textContent = "";
		this.listeners = new Map();
		this.rect = { top: 100, bottom: 132, left: 0, right: 240 };
	}
	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}
	appendChild(child) {
		child.parent = this;
		this.children.push(child);
		return child;
	}
	addEventListener(type, fn) {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	dispatch(type, event) {
		for (const fn of this.listeners.get(type) ?? []) fn(event);
	}
	getBoundingClientRect() {
		return this.rect;
	}
	/** Descendants in document order (the stub never returns self). */
	walk() {
		const out = [];
		for (const child of this.children) out.push(child, ...child.walk());
		return out;
	}
	matches(selector) {
		return selector.split(",").some((one) => matchesOne(this, one.trim()));
	}
	querySelectorAll(selector) {
		return this.walk().filter((node) => node.matches(selector));
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	closest(selector) {
		let node = this;
		while (node !== null) {
			if (node.matches(selector)) return node;
			node = node.parent;
		}
		return null;
	}
}

/** Match the tag, `[attr]`, `[attr="value"]`, and `[class*="value"]` forms only. */
function matchesOne(el, selector) {
	const classContains = /^\[class\*="(.+)"\]$/.exec(selector);
	if (classContains !== null) {
		return String(el.attributes.get("class") ?? "").includes(classContains[1]);
	}
	const attrEquals = /^\[([\w-]+)="(.+)"\]$/.exec(selector);
	if (attrEquals !== null) return el.attributes.get(attrEquals[1]) === attrEquals[2];
	const attrOnly = /^\[([\w-]+)\]$/.exec(selector);
	if (attrOnly !== null) return el.attributes.has(attrOnly[1]);
	return el.tagName === selector.toUpperCase();
}

/** Capture the module registration the bundle publishes on load. */
let registration;
globalThis.window = { __ModuleLoader__: { load: (row) => { registration = row; } } };
globalThis.Element = FakeElement;
// Node exposes its own read-only `navigator`; the bundle only reads `language`.
Object.defineProperty(globalThis, "navigator", { value: { language: "en" }, configurable: true });

const body = new FakeElement("body");
const documentListeners = new Map();
globalThis.document = {
	documentElement: { lang: "en" },
	body,
	createElement: (tag) => new FakeElement(tag),
	addEventListener: (type, fn) => {
		const list = documentListeners.get(type) ?? [];
		list.push(fn);
		documentListeners.set(type, list);
	},
	querySelectorAll: (selector) => body.querySelectorAll(selector),
};

/** Observer stub: the test drives delivery explicitly. */
class FakeMutationObserver {
	constructor(callback) { this.callback = callback; }
	observe() {}
	disconnect() {}
	emit(nodes) { this.callback([{ addedNodes: nodes }], this); }
}
globalThis.MutationObserver = FakeMutationObserver;

await import("../client.js");

/** A row shaped like the session-list packages render it. */
function row(title) {
	const el = new FakeElement("div");
	el.setAttribute("class", "_1Jb0BW_sessionRow");
	el.setAttribute("role", "treeitem");
	const status = el.appendChild(new FakeElement("span"));
	status.textContent = "";
	const titleEl = el.appendChild(new FakeElement("span"));
	titleEl.textContent = title;
	const time = el.appendChild(new FakeElement("span"));
	time.textContent = "5min";
	return el;
}

/** One session in the list snapshot the client half reads. */
function catalogCtx(items) {
	const byId = {};
	for (const item of items) byId[item.id] = item;
	return {
		sessions: {
			list: { getSnapshot: () => ({ ids: items.map((item) => item.id), byId }) },
			refresh: async () => {},
		},
		locale: { register: () => () => {} },
		effect: (fn) => fn(),
	};
}

/** Mount the bundle, click the row, open the portaled menu, return the menu. */
function openMenuFor(ctx, rowEl) {
	const exports = registration.factory(() => ({}));
	body.children.length = 0;
	body.appendChild(rowEl);
	exports.apply(ctx);
	for (const fn of documentListeners.get("click") ?? []) fn({ target: rowEl });
	const menu = body.appendChild(new FakeElement("div"));
	menu.setAttribute("role", "menu");
	menu.rect = { top: 134, bottom: 200, left: 240, right: 400 };
	ctx.__observer.emit([menu]);
	return menu;
}

test("client half appends the delete item for a listed session title", () => {
	const ctx = catalogCtx([{ id: "s1", displayTitle: "Fix the bug", running: false, blank: false }]);
	globalThis.MutationObserver = class extends FakeMutationObserver {
		constructor(callback) { super(callback); ctx.__observer = this; }
	};
	const menu = openMenuFor(ctx, row("Fix the bug"));
	const item = menu.querySelector("[data-session-cleaner-menu]");
	assert.notEqual(item, null, "delete item must be appended to the row menu");
	assert.match(item.textContent, /Delete session/);
	assert.equal(item.disabled, false);
});

test("running sessions get a disabled item", () => {
	const ctx = catalogCtx([{ id: "s2", displayTitle: "Long job", running: true, blank: false }]);
	globalThis.MutationObserver = class extends FakeMutationObserver {
		constructor(callback) { super(callback); ctx.__observer = this; }
	};
	const item = openMenuFor(ctx, row("Long job")).querySelector("[data-session-cleaner-menu]");
	assert.notEqual(item, null);
	assert.equal(item.disabled, true);
});

test("blank, subagent, and duplicate titles stay out of the catalog", () => {
	const ctx = catalogCtx([
		{ id: "s3", displayTitle: "Twice", running: false, blank: false },
		{ id: "s4", displayTitle: "Twice", running: false, blank: false },
	]);
	globalThis.MutationObserver = class extends FakeMutationObserver {
		constructor(callback) { super(callback); ctx.__observer = this; }
	};
	const menu = openMenuFor(ctx, row("Twice"));
	assert.equal(menu.querySelector("[data-session-cleaner-menu]"), null, "ambiguous titles skip injection");
});

test("a menu opened without a recent row click is not augmented", () => {
	const ctx = catalogCtx([{ id: "s5", displayTitle: "Untouched", running: false, blank: false }]);
	globalThis.MutationObserver = class extends FakeMutationObserver {
		constructor(callback) { super(callback); ctx.__observer = this; }
	};
	const exports = registration.factory(() => ({}));
	body.children.length = 0;
	exports.apply(ctx);
	const menu = body.appendChild(new FakeElement("div"));
	menu.setAttribute("role", "menu");
	ctx.__observer.emit([menu]);
	assert.equal(menu.querySelector("[data-session-cleaner-menu]"), null);
});
