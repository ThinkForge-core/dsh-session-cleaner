// dsh-session-cleaner client half: a delete button in the conversation
// header actions slot. Loaded by the web app's module loader as
// /plugins/session-cleaner/client.js (row id = "session-cleaner").
//
// The button calls the server route POST /api-ext/session.delete and refreshes
// the session baseline on success. Sessions with a running agent are refused
// by the server (and the button is disabled while the list reports running).
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

		/**
		 * Header action button. The slot framework injects sessionId,
		 * useSessions and t; `onDeleted` comes from our register() inject.
		 */
		function DeleteSessionAction({ sessionId, useSessions, t, onDeleted }) {
			const running = useSessions((state) => state.byId[sessionId]?.running === true);
			const [busy, setBusy] = react.useState(false);
			const handle = react.useCallback(async () => {
				if (busy || running) return;
				if (!window.confirm(t("confirm"))) return;
				setBusy(true);
				try {
					const res = await fetch("/api-ext/session.delete", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId })
					});
					const body = await res.json();
					if (!body.ok) throw new Error(body.error?.message ?? "delete failed");
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

		function apply(ctx) {
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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
