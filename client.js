// dsh-session-cleaner client half:
//  1. a delete button in the conversation header actions slot (v0.2.0);
//  2. a "delete" item appended to the sidebar session row ⋮ menu (v0.2.1).
// Loaded by the web app's module loader as /plugins/dsh-session-cleaner/client.js.
//
// The row ⋮ menu is rendered by the upstream ui-workspace component with a
// hardcoded item list and no public slot, so the client half augments the
// opened menu in the DOM: it watches for [role="menu"], pairs it with its
// session row ([role="treeitem"], with a click-capture fallback), resolves the
// session id by matching the row title against the session list, and appends a
// danger-styled delete item. Ambiguous titles skip injection for safety.
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
			deleting: "删除中…",
			failed: "删除失败：",
			running: "会话正在运行，无法删除"
		};
		const en = {
			delete: "Delete session",
			confirm: "Delete this session? This cannot be undone.",
			deleting: "Deleting…",
			failed: "Delete failed: ",
			running: "Session is running and cannot be deleted"
		};

		const inject = ["slots", "sessions", "locale"];

		const log = (...args) => {
			try {
				console.debug("[dsh-session-cleaner]", ...args);
			} catch {
				/* console unavailable */
			}
		};

		// ---------------------------------------------------------------- header button

		/** Header action button (v0.2.0). */
		function DeleteSessionAction({ sessionId, useSessions, t, onDeleted }) {
			const running = useSessions((state) => state.byId[sessionId]?.running === true);
			const [busy, setBusy] = react.useState(false);
			const handle = react.useCallback(async () => {
				if (busy || running) return;
				if (!window.confirm(t("confirm"))) return;
				setBusy(true);
				try {
					await deleteSessionViaApi(sessionId);
					if (typeof onDeleted === "function") await onDeleted(sessionId);
				} catch (error) {
					window.alert(t("failed") + (error instanceof Error ? error.message : String(error)));
				} finally {
					setBusy(false);
				}
			}, [busy, running, sessionId, t, onDeleted]);
			return react.createElement("button", {
				type: "button",
				className: "dsh-session-cleaner-delete",
				onClick: handle,
				disabled: busy || running,
				title: running ? t("running") : t("delete"),
				"aria-label": t("delete"),
				style: {
					background: "none",
					border: "none",
					padding: "2px 6px",
					cursor: running || busy ? "default" : "pointer",
					fontSize: "14px",
					lineHeight: "1",
					opacity: running ? 0.4 : 0.85,
					borderRadius: "4px"
				}
			}, busy ? "…" : "🗑");
		}

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
		 * Fetch the visible session catalog (title -> [{id, running}]) through
		 * the host RPC so the injected menu item can resolve a row's session id
		 * from its title.
		 */
		async function fetchSessionCatalog() {
			const res = await fetch("/api/session.list", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId: "session-cleaner-" + Math.random().toString(36).slice(2),
					method: "session.list",
					payload: {}
				})
			});
			if (!res.ok) throw new Error("session.list HTTP " + res.status);
			const body = await res.json();
			const items = body?.result?.value?.items ?? [];
			const catalog = new Map();
			for (const item of items) {
				if (item.blank || item.origin === "subagent") continue;
				const title = item.projections?.values?.title;
				if (typeof title !== "string" || title === "") continue;
				if (!catalog.has(title)) catalog.set(title, []);
				catalog.get(title).push({ id: item.sessionId, running: item.running === true });
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

		/** Install the ⋮ menu augmentation. */
		function installRowMenuAugmentation(ctx) {
			// Last row whose ⋮ was clicked (fallback pairing for portaled menus).
			let lastRow = null;
			document.addEventListener("click", (event) => {
				const target = event.target;
				if (target instanceof Element) {
					const row = target.closest('[role="treeitem"]');
					if (row !== null) lastRow = row;
				}
			}, true);

			const maybeAugment = (menuEl) => {
				const rowEl = menuEl.closest('[role="treeitem"]') ?? lastRow;
				if (rowEl === null) {
					log("menu without row", menuEl);
					return;
				}
				fetchSessionCatalog()
					.then((c) => augmentMenu(menuEl, rowEl, c, ctx))
					.catch((error) => log("catalog failed:", String(error?.message ?? error)));
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
			// Menu augmentation first: independent of the slot machinery.
			try {
				installRowMenuAugmentation(ctx);
			} catch (error) {
				log("menu augmentation failed:", String(error?.message ?? error));
			}
			// Header action button (slot-based).
			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-cleaner: locale");
				ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "session-cleaner",
					order: 90,
					locale: NS,
					inject: () => ({
						onDeleted: async () => {
							await ctx.sessions.refresh();
						}
					})
				}, DeleteSessionAction));
			} catch (error) {
				log("header action failed:", String(error?.message ?? error));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
