import { expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildSessionRows } from "../../../apps/mobile/src/components/chat/thread-drawer-rows.js";
import type { ThreadSummary } from "../src/api-schema.js";

const nativeThread = (id: string, extra = {}) => ({
  id,
  name: id,
  parentThreadId: null,
  preview: id,
  cwd: "/tmp",
  source: "cli",
  createdAt: 1,
  updatedAt: 2,
  status: { type: "idle" },
  modelProvider: "openai",
  ...extra,
});

it("preserves native cursors and resolves structured subagent parents without reading history", async () => {
  const parent = nativeThread("parent");
  const child = nativeThread("child", {
    source: { subAgent: { thread_spawn: { parent_thread_id: "parent" } } },
  });
  const listThreadsPage = vi.fn<
    ({
      cursor,
    }: {
      cursor?: string;
    }) => Promise<{ data: ReturnType<typeof nativeThread>[]; nextCursor: string | null }>
  >(async ({ cursor }) =>
    cursor
      ? { data: [nativeThread("older")], nextCursor: null }
      : { data: [child], nextCursor: "native-next-page" },
  );
  const readThread = vi.fn<() => Promise<typeof parent>>(async () => parent);
  const app = createApp({
    appServer: {
      listThreadsPage,
      readThread,
      onNotification: () => () => undefined,
      onRequest: () => () => undefined,
    } as never,
  });
  const firstResponse = await app.request("/v1/threads?limit=40");
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first.nextCursor).toBe("native-next-page");
  expect(first.threads).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "child", parentThreadId: "parent", source: "subAgent" }),
      expect.objectContaining({ id: "parent" }),
    ]),
  );
  expect(readThread).toHaveBeenCalledWith("parent", { includeTurns: false });
  const older = await (await app.request("/v1/threads?limit=40&cursor=native-next-page")).json();
  expect(listThreadsPage).toHaveBeenLastCalledWith({ limit: 40, cursor: "native-next-page" });
  expect(older.nextCursor).toBeNull();
  expect(older.threads.map((thread: { id: string }) => thread.id)).toEqual(["older"]);
});

const summary = (id: string, parentThreadId?: string): ThreadSummary => ({
  id,
  parentThreadId,
  title: id,
  messageCount: 0,
  state: "idle",
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
});

it("collapses descendants under their parent and keeps unrelated exec sessions in a closed group", () => {
  const threads = [
    summary("parent"),
    summary("child", "parent"),
    summary("nested", "child"),
    { ...summary("exec-worker"), source: "exec" },
  ];
  const closed = buildSessionRows(threads);
  expect(closed.filter((row) => row.kind === "thread").map((row) => row.thread.id)).toEqual([
    "parent",
  ]);
  expect(closed.find((row) => row.kind === "agent-group")).toMatchObject({
    count: 1,
    expanded: false,
  });
  const opened = buildSessionRows(threads, [], false, {
    "children:parent": true,
    "children:child": true,
  });
  expect(
    opened.filter((row) => row.kind === "thread").map((row) => [row.thread.id, row.depth]),
  ).toEqual([
    ["parent", 0],
    ["child", 1],
    ["nested", 2],
  ]);
  expect(buildSessionRows(threads, [], true).filter((row) => row.kind === "thread")).toHaveLength(
    4,
  );
});
