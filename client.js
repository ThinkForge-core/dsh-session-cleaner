// dsh-session-cleaner client half: a "delete" item appended to the sidebar
// session row ⋮ menu (v1.0.0; the v0.2.0 header button was removed), plus a
// delete button of its own on rows that render no menu (v1.0.4).
// Loaded by the web app's module loader as /plugins/dsh-session-cleaner/client.js.
//
// The row ⋮ menu is rendered by whichever session-list package the profile
// mounts (the stock one or a drop-in replacement such as
// dsh-multiroot-workspace) with a hardcoded item list and no public slot, so
// the client half augments the opened menu in the DOM: it watches for
// [role="menu"], pairs it with its session row ([role="treeitem"], with a
// click-capture fallback), resolves the session, and appends a danger-styled
// delete item. Resolution prefers the row's own `data-session-id` contract
// (published by dsh-multiroot-workspace), which is the only reliable handle on
// a blank row — a session whose log never got written and whose rendered title
// is a shared placeholder; when the attribute is absent it falls back to
// matching the row title against the injected sessions service list snapshot,
// where ambiguous titles skip injection for safety. Running sessions get a
// disabled item.
//
// A blank row renders NO menu at all (dsh-multiroot-workspace hides the row
// verbs on a contentless placeholder), so for a session row that carries a
// `data-session-id` but no actions menu the client half injects its own 🗑
// button into the row. That closes the one gap a menu-only design cannot: a
// session that failed to start is the row most likely to need deleting, and it
// was the one row with no menu to append to.
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
		// Rows whose package renders no actions menu at all (a blank "New session"
		// row hides its verbs) get a delete button of our own, marked by this.
		const ROW_BUTTON_MARKER = "data-session-cleaner-row";

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

		/** Confirm, delete, refresh — the one flow behind both entry points. */
		async function deleteSession(sessionId, ctx, dict) {
			if (!window.confirm(dict.confirm)) return;
			try {
				await deleteSessionViaApi(sessionId);
				log("deleted", sessionId);
				await ctx.sessions.refresh();
			} catch (error) {
				window.alert(dict.failed + (error instanceof Error ? error.message : String(error)));
			}
		}

		/** Current UI language, used for the DOM-injected menu item text. */
		function uiLang() {
			const lang = document.documentElement.lang || navigator.language || "en";
			return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
		}

		/**
		 * Build the visible session catalog from the injected sessions service.
		 * Its list snapshot is the same source the sidebar rows render titles
		 * from, so resolving a row by its rendered title needs no wire call and
		 * survives endpoint renames.
		 *
		 * Two indexes are returned:
		 *   - `byId`: every listed session id (INCLUDING blank ones) -> {id, running}.
		 *     Blank sessions — a row whose log never got written (a session that
		 *     failed to start) — are exactly the rows a user wants gone, and they
		 *     are the ones whose rendered title is a shared placeholder, so the id
		 *     index is the only reliable handle on them.
		 *   - `catalog`: rendered title -> [{id, running}], the fallback for rows
		 *     that carry no `data-session-id` (e.g. a sidebar package that does
		 *     not publish the id contract).
		 */
		function sessionCatalog(ctx) {
			const state = ctx.sessions.list.getSnapshot();
			const catalog = new Map();
			const byId = new Map();
			for (const id of state.ids) {
				const item = state.byId[id];
				if (item === undefined || item.origin === "subagent") continue;
				const entry = { id: item.id, running: item.running === true };
				byId.set(item.id, entry);
				const title = item.displayTitle;
				if (item.blank || typeof title !== "string" || title === "") continue;
				if (!catalog.has(title)) catalog.set(title, []);
				catalog.get(title).push(entry);
			}
			log("catalog:", byId.size, "sessions,", catalog.size, "titles");
			return { catalog, byId };
		}

		/**
		 * Resolve the row's session. The stable path is the rows' own
		 * `data-session-id` contract (published by dsh-multiroot-workspace): it
		 * names the session exactly, works for blank rows whose rendered title is
		 * a shared placeholder, and needs no uniqueness check. When the attribute
		 * is absent, fall back to matching the row's title text against exactly
		 * one listed session.
		 */
		function resolveSession(rowEl, index) {
			const id = rowEl.getAttribute("data-session-id");
			if (typeof id === "string" && id !== "") {
				// A live row can outrun the list snapshot; the server refuses a
				// running session anyway, so an unknown id is safe to offer.
				return index.byId.get(id) ?? { id, running: false };
			}
			const spans = rowEl.querySelectorAll("span");
			for (const span of spans) {
				const text = span.textContent?.trim() ?? "";
				if (text === "") continue;
				const entries = index.catalog.get(text);
				if (entries !== undefined && entries.length === 1) return entries[0];
			}
			return undefined;
		}

		/** Append the delete item to an open row menu. */
		function augmentMenu(menuEl, rowEl, index, ctx) {
			if (menuEl.querySelector(`[${MENU_MARKER}]`) !== null) return;
			const session = resolveSession(rowEl, index);
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
				await deleteSession(session.id, ctx, dict);
			});
			menuEl.appendChild(item);
		}

		/**
		 * Give a session row a delete button of its own when the sidebar renders no
		 * actions menu for it. This is the blank-row case: dsh-multiroot-workspace
		 * hides the ⋮ on a "New session" placeholder (nothing to rename/fork/archive
		 * yet), so there is no menu for {@link augmentMenu} to append to — and a
		 * session that never started is exactly the one a user wants to remove. The
		 * row's `data-session-id` is the only reliable identity there, since every
		 * blank row renders the same placeholder title.
		 */
		function ensureRowDeleteButton(rowEl, ctx) {
			if (rowEl.querySelector(`[${ROW_BUTTON_MARKER}]`) !== null) return;
			// A row that already renders its actions menu goes through the menu path.
			if (rowEl.querySelector('[class*="rowActions"]') !== null) return;
			const sessionId = rowEl.getAttribute("data-session-id");
			if (typeof sessionId !== "string" || sessionId === "") return;
			const dict = uiLang() === "zh" ? zh : en;
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute(ROW_BUTTON_MARKER, "1");
			button.setAttribute("aria-label", dict.delete);
			button.title = dict.delete;
			button.textContent = "🗑";
			button.style.cssText = [
				"flex:none",
				"display:inline-flex",
				"align-items:center",
				"justify-content:center",
				"width:20px",
				"height:20px",
				"padding:0",
				"border:none",
				"border-radius:4px",
				"background:none",
				"color:var(--dsw-alias-label-tertiary, #9aa0a6)",
				"font-size:12px",
				"line-height:1",
				"cursor:pointer",
				"opacity:0"
			].join(";");
			// Match the ⋮ reveal: the button shows on row hover/focus, not before.
			button.addEventListener("mouseenter", () => {
				button.style.color = "var(--dsw-alias-danger, #e5484d)";
			});
			button.addEventListener("mouseleave", () => {
				button.style.color = "var(--dsw-alias-label-tertiary, #9aa0a6)";
			});
			rowEl.addEventListener("mouseenter", () => { button.style.opacity = "1"; });
			rowEl.addEventListener("mouseleave", () => { button.style.opacity = "0"; });
			button.addEventListener("mousedown", (event) => { event.stopPropagation(); });
			button.addEventListener("click", async (event) => {
				event.preventDefault();
				event.stopPropagation();
				await deleteSession(sessionId, ctx, dict);
			});
			rowEl.appendChild(button);
			log("row delete button for", sessionId);
		}

		/** Ensure every session row without an actions menu carries a delete button. */
		function sweepRowDeleteButtons(ctx) {
			let rows;
			try {
				rows = document.querySelectorAll("[data-session-id]");
			} catch (error) {
				log("row sweep failed:", String(error?.message ?? error));
				return;
			}
			for (const row of rows) ensureRowDeleteButton(row, ctx);
		}

		/** Rectangle distance between two DOM rects (0 when they overlap/touch). */
		function rectDistance(a, b) {
			const dx = Math.max(0, a.left - b.right, b.left - a.right);
			const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
			return Math.hypot(dx, dy);
		}

		/** Install the ⋮ menu augmentation and the blank-row delete button. */
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
				let index;
				try {
					index = sessionCatalog(ctx);
				} catch (error) {
					log("catalog failed:", String(error?.message ?? error));
					return;
				}
				augmentMenu(menuEl, match.row, index, ctx);
			};
			const observer = new MutationObserver((mutations) => {
				let added = false;
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (node.nodeType !== 1) continue;
						added = true;
						if (node.matches?.('[role="menu"]') === true) maybeAugment(node);
						node.querySelectorAll?.('[role="menu"]').forEach(maybeAugment);
					}
				}
				// React re-renders a row (and drops our button with it) on every
				// list/status change; re-ensure on any insertion. The marker guard
				// in ensureRowDeleteButton stops our own append from looping.
				if (added) sweepRowDeleteButtons(ctx);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			document.querySelectorAll('[role="menu"]').forEach(maybeAugment);
			sweepRowDeleteButtons(ctx);
			log("menu and row-button observer installed");
			ctx.effect(() => () => observer.disconnect(), "session-cleaner: row observer");
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
