import { describe, expect, it } from "vitest";

import { createRuntimePreferencesCoordinator } from "../../../apps/mobile/src/components/chat/runtime-preferences-coordinator.js";

describe("runtime preferences coordinator", () => {
  it("settles optimistic preferences independently per workspace", () => {
    // Given
    const coordinator = createRuntimePreferencesCoordinator();
    const workspaceA = coordinator.stage("/workspace/a", {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      runtimeMode: "default",
    });
    coordinator.stage("/workspace/b", {
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
      runtimeMode: "default",
    });

    // When
    const settled = coordinator.settle(workspaceA);

    // Then
    expect(settled).toBe(true);
    expect(coordinator.current("/workspace/a")).toBeUndefined();
    expect(coordinator.current("/workspace/b")).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
    });
  });

  it("keeps the newest same-workspace draft when an older request settles", () => {
    // Given
    const coordinator = createRuntimePreferencesCoordinator();
    const older = coordinator.stage("/workspace/a", {
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      runtimeMode: "default",
    });
    coordinator.stage("/workspace/a", {
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
      runtimeMode: "default",
    });

    // When
    const settled = coordinator.settle(older);

    // Then
    expect(settled).toBe(false);
    expect(coordinator.current("/workspace/a")?.reasoningEffort).toBe("ultra");
  });

  it("waits for queued preference updates before starting a status read", async () => {
    // Given
    const coordinator = createRuntimePreferencesCoordinator();
    let releaseUpdate: () => void = () => undefined;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let statusReadStarted = false;
    const update = coordinator.enqueue(() => updateGate);
    const statusRead = coordinator.afterUpdates().then(() => {
      statusReadStarted = true;
    });

    // When
    await Promise.resolve();

    // Then
    expect(statusReadStarted).toBe(false);
    releaseUpdate();
    await Promise.all([update, statusRead]);
    expect(statusReadStarted).toBe(true);
  });

  it("continues queued work after an earlier preference update rejects", async () => {
    // Given
    const coordinator = createRuntimePreferencesCoordinator();
    const failedUpdate = coordinator.enqueue(() =>
      Promise.reject(new TypeError("Preference update failed")),
    );

    // When
    const nextUpdate = coordinator.enqueue(() => Promise.resolve("saved"));

    // Then
    await expect(failedUpdate).rejects.toThrow("Preference update failed");
    await expect(nextUpdate).resolves.toBe("saved");
    await expect(coordinator.afterUpdates()).resolves.toBeUndefined();
  });
});
