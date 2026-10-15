import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import * as pty from "@lydell/node-pty";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "../src/app-server.js";
import type { AppServerNotification } from "../src/app-server.js";
import {
  attachApprovalCode,
  completeSecurePairing,
  createSecurePairingAttempt,
  decryptResponsePayload,
  encryptRequestPayload,
} from "../../../apps/mobile/src/lib/secure-transport.js";

vi.mock("react-native-get-random-values", () => ({}));

const live = process.env.CODEX_RELAY_B_TEST === "1" ? describe : describe.skip;
const exec = promisify(execFile);
const repo = resolve(import.meta.dirname, "../../..");
const state = join(homedir(), ".local/share/codex-relay-b");
const base = process.env.CODEX_RELAY_B_TEST_URL ?? "http://127.0.0.1:8787";
const checks: Array<Record<string, unknown>> = [];

live("independent Plan B deployment", () => {
  const observer = new CodexAppServerClient({ mode: { mode: "socket", fallbackToStdio: false } });
  const notifications: AppServerNotification[] = [];
  const terminals: pty.IPty[] = [];
  const controllers: AbortController[] = [];
  let token = "";
  let cliThread = "";
  let mobileThread = "";

  async function api(path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : encryptRequestPayload(body),
    });
    const payload = decryptResponsePayload(await response.json()) as Record<string, any>;
    if (!response.ok) throw new Error(`Mobile API failed: ${JSON.stringify(payload)}`);
    return payload;
  }

  async function stream(threadId: string, body: unknown, allowInterrupted = false) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(`${base}/v1/threads/${threadId}/runs/stream`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: encryptRequestPayload(body),
    });
    expect(response.status).toBe(200);
    const events: Array<Record<string, any>> = [];
    const done = (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let boundary: number;
        while ((boundary = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data: "));
          if (data.length) {
            events.push(
              decryptResponsePayload(
                JSON.parse(data.map((line) => line.slice(6)).join("\n")),
              ) as Record<string, any>,
            );
          }
        }
      }
      const errors = events.filter((event) => event.type === "thread.error");
      if (!allowInterrupted && errors.length) throw new Error(JSON.stringify(errors));
      return events;
    })();
    // Keep teardown from turning an earlier failed assertion into an unhandled rejection.
    void done.catch(() => {});
    return { done, events, controller };
  }

  function terminal(args: string[]) {
    const terminalArgs =
      args[0] === "resume"
        ? ["resume", "--no-alt-screen", ...args.slice(1)]
        : ["--no-alt-screen", ...args];
    const process = pty.spawn(join(homedir(), ".local/bin/codex-b"), terminalArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd: repo,
      env: { ...globalThis.process.env, TERM: "xterm-256color" },
    });
    terminals.push(process);
    const output = { text: "" };
    process.onData((data) => {
      if (data.includes("\u001b[6n")) process.write("\u001b[1;1R");
      output.text += stripVTControlCharacters(data);
    });
    return { process, output };
  }

  beforeAll(async () => {
    if (process.env.CODEX_HOME !== join(state, "codex-home")) {
      throw new Error("This test must use the isolated Plan B CODEX_HOME.");
    }
    const serverState = JSON.parse(
      await readFile(join(state, "relay-state/server-state.json"), "utf8"),
    );
    const qr = new URL(serverState.pairingPayload);
    const attempt = createSecurePairingAttempt({
      serverPublicKey: qr.searchParams.get("serverPublicKey")!,
      serverUrl: base,
    });
    const response = await fetch(base + "/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Plan B desktop validation",
        secure: {
          clientEphemeralPublicKey: attempt.clientEphemeralPublicKey,
          clientNonce: attempt.clientNonce,
          protocolVersion: 1,
        },
      }),
    });
    if (response.status !== 202) throw new Error(`Pairing returned ${response.status}`);
    const pending = (await response.json()) as { approvalCode: string };
    attachApprovalCode(attempt, pending.approvalCode);
    await exec(
      process.execPath,
      [join(repo, "packages/codex-relay/dist/cli.js"), "approve", pending.approvalCode],
      { env: { ...process.env, CODEX_RELAY_HOME: join(state, "relay-state") } },
    );
    const paired = await fetch(base + "/v1/pair/" + pending.approvalCode);
    if (paired.status !== 201) throw new Error(`Pairing approval returned ${paired.status}`);
    token = completeSecurePairing(attempt, await paired.json()).clientToken;
    observer.onNotification((notification) => notifications.push(notification));
    await observer.initialize();
    checks.push({ check: "real mobile E2EE pairing and local approval", passed: true });
  }, 30_000);

  afterAll(async () => {
    for (const controller of controllers) controller.abort();
    for (const terminal of terminals) {
      try {
        terminal.kill();
      } catch {}
    }
    observer.close();
    const dir = resolve(repo, "../artifacts");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "live-validation.json"),
      JSON.stringify({ at: new Date().toISOString(), checks }, null, 2) + "\n",
    );
  });

  it("requires pairing and returns encrypted mobile API responses", async () => {
    expect((await fetch(base + "/v1/threads")).status).toBe(401);
    expect((await api("/v1/threads")).source).toBe("app-server");
    checks.push({ check: "authenticated encrypted API", passed: true });
  });

  it("discovers a new real CLI session and streams its running turn to mobile", async () => {
    const offset = notifications.length;
    const cli = terminal([]);
    await vi.waitFor(
      () => {
        const started = notifications
          .slice(offset)
          .find((notification) => notification.method === "thread/started");
        cliThread = (started?.params as { thread?: { id: string } })?.thread?.id ?? "";
        expect(cliThread).not.toBe("");
      },
      { timeout: 30_000 },
    );
    await vi.waitFor(() => expect(cli.output.text).toMatch(/[›❯]/), { timeout: 15_000 });
    cli.process.write(
      "\u001b[200~Run the shell command sleep 6, then reply with exactly CLI_B_LIVE_OK. Do not edit files.\u001b[201~",
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    cli.process.write("\r");
    let activeTurnId: string | undefined;
    await vi.waitFor(
      async () => {
        await observer.resumeThread({ threadId: cliThread, excludeTurns: true });
        const active = await observer.readThread(cliThread);
        activeTurnId = active.turns?.find((turn) => turn.status === "inProgress")?.id;
        expect(activeTurnId).toBeTruthy();
      },
      { timeout: 30_000 },
    );
    const mobile = await stream(cliThread, {});
    const events = await mobile.done;
    expect(events.some((event) => event.type === "thread.message.delta")).toBe(true);
    expect(events.some((event) => event.message?.content?.includes("CLI_B_LIVE_OK"))).toBe(true);
    expect(events.some((event) => event.message?.turnId === activeTurnId)).toBe(true);
    expect(
      (await api("/v1/threads")).threads.some((thread: { id: string }) => thread.id === cliThread),
    ).toBe(true);
    checks.push({
      check: "CLI creation -> mobile same running thread and turn",
      passed: true,
      threadId: cliThread,
      turnId: activeTurnId,
    });

    const reply = await stream(cliThread, {
      prompt: "Reply with exactly PHONE_TO_CLI_B_OK",
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
    });
    expect(
      (await reply.done).some((event) => event.message?.content?.includes("PHONE_TO_CLI_B_OK")),
    ).toBe(true);
    await vi.waitFor(() => expect(cli.output.text).toContain("PHONE_TO_CLI_B_OK"), {
      timeout: 10_000,
    });
    checks.push({
      check: "mobile writes to a still-open CLI runtime",
      passed: true,
      threadId: cliThread,
    });
  }, 180_000);

  it("allows CLI to attach to a mobile-created thread and receive new live output", async () => {
    const created = await api("/v1/threads", {
      title: "Plan B mobile validation",
      model: "gpt-6.1-sol",
    });
    const id = created.thread.id;
    mobileThread = id;
    const first = await stream(id, {
      prompt: "Reply with exactly MOBILE_B_CREATED_OK",
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
    });
    await first.done;
    const cli = terminal(["resume", id]);
    await vi.waitFor(() => expect(cli.output.text).toContain("MOBILE_B_CREATED_OK"), {
      timeout: 30_000,
    });
    const second = await stream(id, {
      prompt: "Reply with exactly MOBILE_B_CONTINUED_OK",
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
    });
    await second.done;
    await vi.waitFor(() => expect(cli.output.text).toContain("MOBILE_B_CONTINUED_OK"), {
      timeout: 10_000,
    });
    checks.push({
      check: "mobile creation -> CLI resume and subsequent live output",
      passed: true,
      threadId: id,
    });
  }, 180_000);

  it("includes mobile-created sessions in the regular Plan B resume picker", async () => {
    const name = `Plan B phone session ${mobileThread.slice(-6)}`;
    await observer.setThreadName({ threadId: mobileThread, name });
    const picker = terminal(["resume", "--all"]);
    await vi.waitFor(() => expect(picker.output.text).toContain(name), { timeout: 20_000 });
    picker.process.kill();
    checks.push({
      check: "mobile-created session appears in codex-b resume picker",
      passed: true,
      threadId: mobileThread,
    });
  }, 30_000);

  it("interrupts a real running shell command from the encrypted mobile API", async () => {
    const created = await api("/v1/threads", {
      title: "Plan B interrupt validation",
      model: "gpt-6.1-sol",
    });
    const id = created.thread.id;
    const run = await stream(
      id,
      {
        prompt:
          "Run exactly the shell command sleep 30, then reply SLEEP_FINISHED. Do not edit files.",
        model: "gpt-6.1-sol",
        reasoningEffort: "low",
        runtimeMode: "full-access",
      },
      true,
    );
    let turnId: string | undefined;
    await vi.waitFor(
      async () => {
        await observer.resumeThread({ threadId: id, excludeTurns: true });
        const thread = await observer.readThread(id);
        const turn = thread.turns?.find((item) => item.status === "inProgress");
        expect(run.events.some((event) => event.message?.kind === "commandExecution")).toBe(true);
        expect(turn).toBeTruthy();
        turnId = turn?.id;
      },
      { timeout: 30_000 },
    );
    const interrupted = await api(`/v1/threads/${id}/runs/interrupt`, {});
    expect(interrupted.thread.state).toBe("completed");
    await run.done;
    const thread = await observer.readThread(id);
    expect(thread.turns?.find((turn) => turn.id === turnId)?.status).toBe("interrupted");
    checks.push({
      check: "mobile interrupts a real running command",
      passed: true,
      threadId: id,
      turnId,
    });
  }, 60_000);

  it("restarts only the relay while preserving the loaded Codex runtime", async () => {
    const pid = async () =>
      (
        await exec("systemctl", [
          "--user",
          "show",
          "codex-relay-b-runtime.service",
          "--property=MainPID",
          "--value",
        ])
      ).stdout.trim();
    const before = await pid();
    await exec("systemctl", ["--user", "restart", "codex-relay-b.service"]);
    await vi.waitFor(async () => expect((await fetch(base + "/version")).ok).toBe(true), {
      timeout: 15_000,
    });
    expect(await pid()).toBe(before);
    expect((await observer.readThread(cliThread, { includeTurns: false })).id).toBe(cliThread);
    expect(
      (await api("/v1/threads")).threads.some((thread: { id: string }) => thread.id === cliThread),
    ).toBe(true);
    checks.push({
      check: "relay restart preserves runtime PID and live threads",
      passed: true,
      runtimePid: before,
    });
  }, 30_000);
});
