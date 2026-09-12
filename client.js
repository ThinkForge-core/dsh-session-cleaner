// dsh-session-cleaner client half: a "delete" item appended to the sidebar
// session row ⋮ menu (v1.0.0; the v0.2.0 header button was removed).
// Loaded by the web app's module loader as /plugins/dsh-session-cleaner/client.js.
//
// The row ⋮ menu is rendered by whichever session-list package the profile
// mounts (the stock one or a drop-in replacement such as
// dsh-multiroot-workspace) with a hardcoded item list and no public slot, so
// the client half augments the opened menu in the DOM: it watches for
// [role="menu"], pairs it with its session row ([role="treeitem"], with a
// click-capture fallback), resolves the session id by matching the row title
// against the injected sessions service list snapshot, and appends a
// danger-styled delete item. Ambiguous titles skip injection for safety;
// running sessions get a disabled item.
window.__ModuleLoader__.load({
	id: "dsh-session-cleaner",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const NS = "sessionCleaner";
		const zh = {
			delete: "删除此会话",
			confirm: "确定删除此会话？删除后不可恢复。",
			failed: "删除失败：",
			running: "会话正在运行，无法删除"
		};
		const en = {
			delete: "Delete session",
			confirm: "Delete this session? This cannot be undone.",
			failed: "Delete failed: ",
			running: "Session is running and cannot be deleted"
		};

		const inject = ["sessions", "locale"];

		const log = (...args) => {
			try {
				console.debug("[dsh-session-cleaner]", ...args);
			} catch {
				/* console unavailable */
			}
		};

		// ------------------------------------------------------------- row ⋮ menu item

		const MENU_MARKER = "data-session-cleaner-menu";

		/** POST the session delete endpoint; throws with the server's message on failure. */
		async function deleteSessionViaApi(sessionId) {
			const res = await fetch("/api-ext/session.delete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId })
			});
			const body = await res.json().catch(() => ({}));
			if (!body.ok) throw new Error(body.error?.message ?? "delete failed");
			return body.value;
		}

		/** Current UI language, used for the DOM-injected menu item text. */
		function uiLang() {
			const lang = document.documentElement.lang || navigator.language || "en";
			return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
		}

		/**
		 * Build the visible session catalog (row title -> [{id, running}]) from
		 * the injected sessions service. Its list snapshot is the same source the
		 * sidebar rows render titles from, so resolving a row by its rendered
		 * title needs no wire call and survives endpoint renames.
		 */
		function sessionCatalog(ctx) {
			const state = ctx.sessions.list.getSnapshot();
			const catalog = new Map();
			for (const id of state.ids) {
				const item = state.byId[id];
				if (item === undefined || item.blank || item.origin === "subagent") continue;
				const title = item.displayTitle;
				if (typeof title !== "string" || title === "") continue;
				if (!catalog.has(title)) catalog.set(title, []);
				catalog.get(title).push({ id: item.id, running: item.running === true });
			}
			log("catalog:", catalog.size, "titles");
			return catalog;
		}

		/** Resolve the row's session: the row's title text must match exactly one session. */
		function resolveSession(rowEl, catalog) {
			const spans = rowEl.querySelectorAll("span");
			for (const span of spans) {
				const text = span.textContent?.trim() ?? "";
				if (text === "") continue;
				const entries = catalog.get(text);
				if (entries !== undefined && entries.length === 1) return entries[0];
			}
			return undefined;
		}

		/** Append the delete item to an open row menu. */
		function augmentMenu(menuEl, rowEl, catalog, ctx) {
			if (menuEl.querySelector(`[${MENU_MARKER}]`) !== null) return;
			const session = resolveSession(rowEl, catalog);
			if (session === undefined) {
				log("skip: cannot resolve session for row", rowEl);
				return;
			}
			log("augment menu for", session.id, session.running ? "(running)" : "");
			const lang = uiLang();
			const dict = lang === "zh" ? zh : en;
			const running = session.running === true;
			const item = document.createElement("button");
			item.type = "button";
			item.setAttribute("role", "menuitem");
			item.setAttribute(MENU_MARKER, "1");
			item.textContent = "🗑 " + dict.delete;
			item.title = running ? dict.running : dict.delete;
			item.disabled = running;
			item.style.cssText = [
				"display:flex",
				"align-items:center",
				"gap:8px",
				"width:100%",
				"padding:6px 12px",
				"border:none",
				"background:none",
				"color:var(--dsw-alias-danger, #e5484d)",
				"font:inherit",
				"font-size:13px",
				"text-align:left",
				"cursor:" + (running ? "default" : "pointer"),
				"opacity:" + (running ? "0.45" : "1"),
				"border-top:1px solid var(--dsw-alias-hairline, rgba(128,128,128,.25))",
				"margin-top:4px"
			].join(";");
			item.addEventListener("mouseenter", () => {
				if (!running) item.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))";
			});
			item.addEventListener("mouseleave", () => {
				item.style.background = "none";
			});
			item.addEventListener("click", async (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (running) return;
				if (!window.confirm(dict.confirm)) return;
				try {
					await deleteSessionViaApi(session.id);
					log("deleted", session.id);
					await ctx.sessions.refresh();
				} catch (error) {
					window.alert(dict.failed + (error instanceof Error ? error.message : String(error)));
				}
			});
			menuEl.appendChild(item);
		}

		/** Rectangle distance between two DOM rects (0 when they overlap/touch). */
		function rectDistance(a, b) {
			const dx = Math.max(0, a.left - b.right, b.left - a.right);
			const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
			return Math.hypot(dx, dy);
		}

		/** Install the ⋮ menu augmentation. */
		function installRowMenuAugmentation(ctx) {
			// The row ⋮ menu is rendered in a PORTAL (Menu portal: true), so it is
			// never inside the session row. Record the last session-row click
			// (tree rows use role="treeitem"; flat rows carry the hashed
			// *sessionRow class) and pair an opened menu with that row only when
			// the click was recent AND the menu is geometrically adjacent — other
			// popups (model/permission selectors) fail both checks.
			let lastRowClick = null;
			document.addEventListener(
				"click",
				(event) => {
					const target = event.target;
					if (target instanceof Element) {
						const row = target.closest('[role="treeitem"], [class*="sessionRow"]');
						if (row !== null) lastRowClick = { row, at: Date.now() };
					}
				},
				true,
			);

			const rowForMenu = (menuEl) => {
				const inline = menuEl.closest('[role="treeitem"], [class*="sessionRow"]');
				if (inline !== null) return { row: inline, source: "inline" };
				const hit = lastRowClick;
				if (hit === null) return null;
				if (Date.now() - hit.at > 1500) return null;
				const dist = rectDistance(menuEl.getBoundingClientRect(), hit.row.getBoundingClientRect());
				if (dist > 80) return null;
				return { row: hit.row, source: "portal" };
			};

			const maybeAugment = (menuEl) => {
				const match = rowForMenu(menuEl);
				if (match === null) {
					log("skip: menu not associated with a session row", menuEl);
					return;
				}
				let catalog;
				try {
					catalog = sessionCatalog(ctx);
				} catch (error) {
					log("catalog failed:", String(error?.message ?? error));
					return;
				}
				augmentMenu(menuEl, match.row, catalog, ctx);
			};
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (node.nodeType !== 1) continue;
						if (node.matches?.('[role="menu"]') === true) maybeAugment(node);
						node.querySelectorAll?.('[role="menu"]').forEach(maybeAugment);
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });
			document.querySelectorAll('[role="menu"]').forEach(maybeAugment);
			log("menu observer installed");
			ctx.effect(() => () => observer.disconnect(), "session-cleaner: menu observer");
		}

		// ---------------------------------------------------------------------- entry

		function apply(ctx) {
			log("apply");
			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-cleaner: locale");
				installRowMenuAugmentation(ctx);
			} catch (error) {
				log("menu augmentation failed:", String(error?.message ?? error));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
