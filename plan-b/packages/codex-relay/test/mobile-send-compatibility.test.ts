import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { AppServerTurn, AppServerTurnStartParams } from "../src/app-server.js";
import type { CodexClient } from "../src/codex.js";

async function fixture(rejectAt?: "resume" | "start") {
  const workspacePath = await mkdtemp(join(tmpdir(), "codex-relay-send-"));
  const now = Date.now() / 1000;
  const thread = {
    id: "shared-mobile-send",
    createdAt: now,
    cwd: workspacePath,
    modelProvider: "openai",
    name: "Mobile send",
    preview: "",
    source: "vscode",
    status: { type: "idle" },
    turns: [],
    updatedAt: now,
  };
  let subscribed = false;
  const unsubscribeNotifications = vi.fn<() => void>();
  const appServer = {
    onNotification: () => unsubscribeNotifications,
    onRequest: () => () => undefined,
    readThread: vi.fn<() => Promise<typeof thread>>(async () => thread),
    isThreadSubscribed: () => subscribed,
    startThread: vi.fn<() => Promise<typeof thread>>(async () => thread),
    resumeThread: vi.fn<() => Promise<typeof thread>>(async () => {
      if (rejectAt === "resume") throw new Error("Backend rejected thread/resume");
      subscribed = true;
      return thread;
    }),
    startTurn: vi.fn<(params: AppServerTurnStartParams) => Promise<AppServerTurn>>(
      async (params) => {
        if (rejectAt === "start") throw new Error("Backend rejected turn/start");
        return {
          id: "accepted-mobile-turn",
          items: [
            {
              type: "userMessage",
              id: params.clientUserMessageId ?? "accepted-user",
              clientId: params.clientUserMessageId,
              content: params.input,
            },
            { type: "agentMessage", id: "mobile-reply", text: "OK" },
          ],
          status: "completed",
          startedAt: now,
          completedAt: now,
        };
      },
    ),
  };
  const app = createApp({
    appServer: appServer as never,
    codex: {} as CodexClient,
    workspacePath,
  });
  await app.request("/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Mobile send", runtimeMode: "auto" }),
  });
  return { app, appServer, unsubscribeNotifications };
}

function streamEvents(body: string) {
  return body.split("\n\n").flatMap((frame) => {
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    return data ? [JSON.parse(data.slice(6))] : [];
  });
}

describe("shared-runtime mobile send compatibility", () => {
  it.each([undefined, "on-failure"])(
    "uses interactive approvals for Auto mode and legacy policy %s",
    async (approvalPolicy) => {
      const { app, appServer } = await fixture();
      const response = await app.request("/v1/threads/shared-mobile-send/runs/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Mobile message", runtimeMode: "auto", approvalPolicy }),
      });
      const events = streamEvents(await response.text());
      expect(appServer.startThread).toHaveBeenCalledWith(
        expect.objectContaining({ approvalPolicy: "on-request", sandbox: "workspace-write" }),
      );
      expect(appServer.resumeThread).toHaveBeenCalledWith(
        expect.objectContaining({ approvalPolicy: "on-request", sandbox: "workspace-write" }),
      );
      expect(appServer.startTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalPolicy: "on-request",
          sandboxPolicy: expect.objectContaining({ type: "workspaceWrite", networkAccess: false }),
        }),
      );
      const userEvents = events.filter((event) => event.message?.role === "user");
      expect(userEvents[0].message.state).toBe("streaming");
      expect(userEvents.some((event) => event.message.state === "completed")).toBe(true);
      expect(events.some((event) => event.type === "thread.error")).toBe(false);
    },
  );

  it.each(["resume", "start"] as const)(
    "marks the local message failed when the backend rejects %s before acceptance",
    async (rejectAt) => {
      const { app, appServer, unsubscribeNotifications } = await fixture(rejectAt);
      const response = await app.request("/v1/threads/shared-mobile-send/runs/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Rejected mobile message", runtimeMode: "auto" }),
      });
      const events = streamEvents(await response.text());
      const userEvents = events.filter((event) => event.message?.role === "user");
      expect(userEvents[0].message.state).toBe("streaming");
      expect(userEvents.at(-1).message.state).toBe("failed");
      expect(userEvents.some((event) => event.message.state === "completed")).toBe(false);
      expect(events.some((event) => event.type === "thread.error")).toBe(true);
      expect(unsubscribeNotifications).toHaveBeenCalledTimes(1);
      expect(appServer.startTurn).toHaveBeenCalledTimes(rejectAt === "resume" ? 0 : 1);
      const detail = await app.request("/v1/threads/shared-mobile-send");
      expect((await detail.json()).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "Rejected mobile message",
            state: "failed",
          }),
        ]),
      );
    },
  );
});
