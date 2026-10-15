import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppServerNotification, AppServerRequest } from "../src/app-server.js";

describe("shared runtime request routing", () => {
  it.each(["run", "attach"])(
    "does not reject another thread's approval or a CLI tool during %s streams",
    async (mode) => {
      const requests = new Set<(request: AppServerRequest) => void>();
      const notifications = new Set<(notification: AppServerNotification) => void>();
      const now = Date.now() / 1000;
      const rejectRequest = vi.fn<
        (id: number | string, code: number, message: string) => Promise<void>
      >(async () => {});
      const respondToRequest = vi.fn<(id: number | string, result: unknown) => Promise<void>>(
        async () => {},
      );
      let nextThread = 0;
      const thread = (id: string) => ({
        id,
        name: id,
        preview: id,
        cwd: process.cwd(),
        source: "appServer",
        modelProvider: "openai",
        createdAt: now,
        updatedAt: now,
        status: { type: mode === "attach" ? "active" : "idle", activeFlags: [] },
        turns: mode === "attach" ? [{ id: `turn-${id}`, status: "inProgress", items: [] }] : [],
      });
      const appServer = {
        appServerMode: "socket",
        startThread: async () => thread(`thread-${++nextThread}`),
        resumeThread: async ({ threadId }: { threadId: string }) => thread(threadId),
        readThread: async (id: string) => thread(id),
        startTurn: async ({ threadId }: { threadId: string }) => ({
          id: `turn-${threadId}`,
          items: [],
          status: "inProgress",
        }),
        onRequest(handler: (request: AppServerRequest) => void) {
          requests.add(handler);
          return () => requests.delete(handler);
        },
        onNotification(handler: (notification: AppServerNotification) => void) {
          notifications.add(handler);
          return () => notifications.delete(handler);
        },
        rejectRequest,
        respondToRequest,
      };
      const app = createApp({ appServer: appServer as never, workspacePath: process.cwd() });
      const json = { "content-type": "application/json" };
      for (const id of [1, 2]) {
        const response = await app.request("/v1/threads", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ title: `thread-${id}` }),
        });
        expect(response.status).toBe(201);
      }
      const streams = [];
      for (const id of [1, 2]) {
        const response = await app.request(`/v1/threads/thread-${id}/runs/stream`, {
          method: "POST",
          headers: json,
          body: JSON.stringify(mode === "run" ? { prompt: "test" } : {}),
        });
        expect(response.status).toBe(200);
        streams.push(response.text());
      }
      await vi.waitFor(() => expect(requests.size).toBe(2));
      for (const handler of requests) {
        handler({ id: 41, method: "item/tool/call", params: { threadId: "thread-1" } });
        handler({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "thread-1", turnId: "turn-thread-1", command: "printf approved" },
        });
      }
      expect(rejectRequest).not.toHaveBeenCalled();
      const detail = await (await app.request("/v1/threads/thread-1")).json();
      const approval = detail.messages.find((message: { details?: { approvalId?: string } }) =>
        Boolean(message.details?.approvalId),
      );
      expect(approval?.details.approvalId).toBeTruthy();
      const resolved = await app.request(`/v1/approvals/${approval.details.approvalId}`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ decision: "approve" }),
      });
      expect(resolved.status).toBe(200);
      expect(respondToRequest).toHaveBeenCalledExactlyOnceWith(42, { decision: "accept" });
      for (const handler of notifications) {
        for (const id of [1, 2]) {
          handler({
            method: "turn/completed",
            params: { threadId: `thread-${id}`, turnId: `turn-thread-${id}`, status: "completed" },
          });
        }
      }
      await Promise.all(streams);
    },
  );
});
