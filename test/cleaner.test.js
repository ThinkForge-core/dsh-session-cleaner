// Unit tests for the dsh-session-cleaner deletion internals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detachLiveStore, detachWorkspaces, removeArtifacts } from "../lib/index.js";

test("detachLiveStore calls the entry detach disposer", () => {
  let detached = false;
  const sessions = {
    store: new Map([["session-a", { detach: () => { detached = true; } }]]),
  };
  assert.equal(detachLiveStore(sessions, "session-a"), true);
  assert.equal(detached, true);
  assert.equal(detachLiveStore(sessions, "session-missing"), false);
  assert.equal(detachLiveStore(undefined, "session-a"), false);
});

test("detachWorkspaces uses the sessionIds getter and detachSession", async () => {
  const calls = [];
  const ws = {
    get sessionIds() {
      return ["session-a", "session-b"];
    },
    async detachSession(id) {
      calls.push(id);
    },
  };
  const registry = { list: () => [ws] };
  assert.equal(await detachWorkspaces(registry, "session-a"), 1);
  assert.deepEqual(calls, ["session-a"]);
  // unknown session -> untouched
  assert.equal(await detachWorkspaces(registry, "session-x"), 0);
  assert.deepEqual(calls, ["session-a"]);
  // missing registry -> 0
  assert.equal(await detachWorkspaces(undefined, "session-a"), 0);
});

test("removeArtifacts deletes only the matching session directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-cleaner-test-"));
  const proj = join(root, "sessions", "--test--");
  await mkdir(join(proj, "session-keep"), { recursive: true });
  await mkdir(join(proj, "session-delete"), { recursive: true });
  await writeFile(join(proj, "session-delete", "session.jsonl.zstd"), "x");

  // point the module at the temp root
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = root;

  try {
    assert.equal(await removeArtifacts("session-delete"), 1);
    assert.equal(await removeArtifacts("session-delete"), 0); // idempotent
    const rest = await readdir(proj);
    assert.deepEqual(rest, ["session-keep"]);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    await rm(root, { recursive: true, force: true });
  }
});
