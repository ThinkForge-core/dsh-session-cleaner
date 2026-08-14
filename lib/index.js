// dsh-session-cleaner — delete sessions from a running DeepSeek Harness web runtime.
//
// Registers one HTTP route on the webServer service:
//   POST /api-ext/session.delete   body: { "sessionId": "session-..." }
//
// Deletion is safe and irreversible:
//   1. refuses sessions that still have an attached agent (running or idle);
//   2. detaches the session from the live SessionStore (the in-memory registry
//      that keeps "ghost" rows visible after the files are gone);
//   3. removes the session from every workspace record;
//   4. deletes the on-disk artifact directory under $DSH_HOME/sessions.
//
// The response mirrors the host's JSON envelope:
//   { "ok": true,  "value": { "detached": true, "workspaces": 1, "files": 1 } }
//   { "ok": false, "error": { "code": "refused", "message": "..." } }

import { access, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-session-cleaner";

export const inject = ["webServer", "workspaceRegistry", "sessions", "agents"];

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function sessionsRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

async function readJsonBody(req, limit = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

/** Detach the session from the live SessionStore entry registry, if present. */
function detachLiveStore(sessions, sessionId) {
  // `store` is the public Map of live entries; each entry exposes the detach
  // disposer returned by SessionStore.enter(). Calling it removes the entry
  // and emits session/disposed. Reaching the entry through the store Map is
  // the same path the store itself uses; guarded for older/future versions.
  const entry = sessions?.store?.get?.(sessionId);
  if (entry?.detach === undefined) return false;
  entry.detach();
  return true;
}

/** Remove the session id from every workspace record that lists it. */
async function detachWorkspaces(workspaceRegistry, sessionId) {
  if (workspaceRegistry?.list === undefined) return 0;
  let removed = 0;
  for (const ws of workspaceRegistry.list()) {
    // `sessionIds` is a getter on the workspace entity (already filtered to
    // sessions whose stored cwd matches the workspace path).
    const ids = ws?.sessionIds;
    if (!Array.isArray(ids) || !ids.includes(sessionId)) continue;
    await ws.detachSession?.(sessionId);
    removed += 1;
  }
  return removed;
}

/** Delete the session's artifact directory under every project dir. */
async function removeArtifacts(sessionId) {
  const root = sessionsRoot();
  let removed = 0;
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return 0; // root absent — nothing to remove
  }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = join(root, proj.name, sessionId);
    try {
      await access(dir);
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // absent (or already removed) — not this session's directory
    }
  }
  return removed;
}

export function apply(ctx) {
  const { webServer, workspaceRegistry, sessions, agents } = ctx;

  webServer.register({
    kind: "exact",
    path: "/api-ext/session.delete",
    handler: async (req, res) => {
      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        return sendJson(res, {
          ok: false,
          error: { code: "bad-request", message: String(error?.message ?? error) },
        });
      }
      const sessionId = payload?.sessionId;
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        return sendJson(res, {
          ok: false,
          error: { code: "bad-request", message: "missing or invalid sessionId" },
        });
      }

      try {
        // Guard: a RUNNING agent means a turn is in flight — never tear that
        // down. An IDLE agent (the session was opened in the web UI) is
        // disposed first through its own fiber, which tears the agent and its
        // session lifecycle down in order, then deletion proceeds.
        const agent = agents?.get?.(sessionId);
        if (agent !== undefined && agent.status === "running") {
          return sendJson(res, {
            ok: false,
            error: {
              code: "refused",
              message: `session "${sessionId}" is running; stop it before deleting`,
            },
          });
        }
        if (agent !== undefined) {
          const stopped = await disposeAgentFiber(agent);
          if (!stopped) {
            return sendJson(res, {
              ok: false,
              error: {
                code: "refused",
                message: `session "${sessionId}" has an attached agent that could not be stopped`,
              },
            });
          }
        }

        const detached = detachLiveStore(sessions, sessionId);
        const workspaces = await detachWorkspaces(workspaceRegistry, sessionId);
        const files = await removeArtifacts(sessionId);

        return sendJson(res, {
          ok: true,
          value: { detached, workspaces, files },
        });
      } catch (error) {
        ctx.logger.warn(
          `dsh-session-cleaner: delete ${sessionId} failed: ${String(error?.message ?? error)}`,
        );
        return sendJson(res, {
          ok: false,
          error: { code: "internal", message: String(error?.message ?? error) },
        });
      }
    },
  });
}

/**
 * Dispose an idle agent's fiber (the Agent exposes its owning Context, whose
 * disposal runs the agent-loop effect cleanup — including the ordered teardown
 * of the agent and its session attachment).
 * @returns true when the fiber was disposed.
 */
async function disposeAgentFiber(agent) {
  const fiber = agent?.ctx;
  if (fiber?.dispose === undefined) return false;
  try {
    const result = fiber.dispose();
    if (result !== undefined && typeof result.then === "function") await result;
    return true;
  } catch {
    return false;
  }
}

// Internals exported for unit tests (not part of the public surface).
export { detachLiveStore, detachWorkspaces, disposeAgentFiber, removeArtifacts };
