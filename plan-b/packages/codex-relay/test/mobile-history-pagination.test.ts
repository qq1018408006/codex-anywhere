import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { CodexClient } from "../src/codex.js";

it("loads recent history and follows the cursor to earlier messages without gaps", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "relay-history-page-"));
  const now = Date.now() / 1000;
  const thread = {
    id: "mobile-paged-history",
    name: "Long history",
    preview: "",
    createdAt: now,
    updatedAt: now,
    cwd: workspacePath,
    modelProvider: "openai",
    source: "vscode",
    status: { type: "idle" },
    turns: [
      {
        id: "history-turn",
        status: "completed",
        items: Array.from({ length: 205 }, (_, i) => ({
          id: `history-message-${i}`,
          type: "agentMessage",
          text: `Message ${i}`,
        })),
      },
    ],
  };
  const app = createApp({
    workspacePath,
    codex: {} as CodexClient,
    appServer: {
      onNotification: () => () => undefined,
      onRequest: () => () => undefined,
      readThread: async () => thread,
    } as never,
  });
  const latest = await (await app.request(`/v1/threads/${thread.id}`)).json();
  expect(latest.messages).toHaveLength(200);
  expect(latest.messages[0].content).toBe("Message 5");
  expect(latest.thread.messageCount).toBe(205);
  const earlier = await (
    await app.request(
      `/v1/threads/${thread.id}?before=${encodeURIComponent(latest.olderMessagesCursor)}`,
    )
  ).json();
  expect(earlier.messages.map((message: { content: string }) => message.content)).toEqual([
    "Message 0",
    "Message 1",
    "Message 2",
    "Message 3",
    "Message 4",
  ]);
  expect(earlier.olderMessagesCursor).toBeNull();
});

it("reads bounded runtime item pages without loading full history, including refresh", async () => {
  const thread = {
    id: "native-paged-history",
    name: "Long native history",
    preview: "Latest message",
    createdAt: 1,
    updatedAt: 100,
    cwd: tmpdir(),
    modelProvider: "openai",
    source: "cli",
    historyMode: "paginated",
    status: { type: "idle" },
    turns: [],
  };
  const entries = Array.from({ length: 85 }, (_, index) => ({
    turnId: `turn-${Math.floor(index / 5)}`,
    item: { id: `item-${index}`, type: "agentMessage", text: `Message ${index}` },
    startedAtMs: (index + 1) * 1000,
    completedAtMs: (index + 1) * 1000 + 500,
  }));
  const readThread = vi.fn<
    (_id: string, options: { includeTurns: boolean }) => Promise<typeof thread>
  >(async (_id, options) => {
    expect(options.includeTurns).toBe(false);
    return thread;
  });
  const listThreadItems = vi.fn<
    (
      _id: string,
      options: { cursor?: string; limit: number },
    ) => Promise<{ data: typeof entries; nextCursor: string | null }>
  >(async (_id, options) => {
    const end = options.cursor ? Number(options.cursor) : entries.length;
    const start = Math.max(0, end - options.limit);
    return {
      data: entries.slice(start, end).reverse(),
      nextCursor: start > 0 ? String(start) : null,
    };
  });
  const app = createApp({
    workspacePath: tmpdir(),
    codex: {} as CodexClient,
    appServer: {
      onNotification: () => () => undefined,
      onRequest: () => () => undefined,
      readThread,
      listThreadItems,
    } as never,
  });
  const loaded: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page += 1) {
    const before = cursor ? `&before=${encodeURIComponent(cursor)}` : "";
    const response = await app.request(`/v1/threads/${thread.id}?limit=40${before}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    loaded.unshift(...data.messages.map((message: { id: string }) => message.id));
    cursor = data.olderMessagesCursor;
  }
  expect(loaded).toEqual(entries.map((entry) => entry.item.id));
  expect(cursor).toBeNull();
  expect(listThreadItems.mock.calls.map(([, options]) => options.limit)).toEqual([40, 40, 40]);
  const refresh = await (
    await app.request(`/v1/threads/${thread.id}?limit=40&refresh=true`)
  ).json();
  expect(refresh.messages).toHaveLength(40);
  expect(refresh.messages.at(-1).id).toBe("item-84");
  expect(readThread).toHaveBeenCalledTimes(4);
});
