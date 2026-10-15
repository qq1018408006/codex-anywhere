import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFileRuntimePreferencesStore } from "../src/preferences-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("file runtime preferences concurrency", () => {
  it("serializes concurrent workspace updates without losing entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-preferences-"));
    temporaryDirectories.push(directory);
    const store = createFileRuntimePreferencesStore(join(directory, "preferences.json"));
    const workspacePaths = Array.from({ length: 12 }, (_, index) => `/workspace-${index}`);

    const updates = workspacePaths.map((workspacePath, index) =>
      store.update(
        {
          model: `gpt-5.6-${index}`,
          runtimeMode: "default",
          workspacePath,
        },
        workspacePath,
      ),
    );

    const readDuringUpdates = store.readByWorkspacePath();
    const [preferencesByWorkspacePath] = await Promise.all([readDuringUpdates, ...updates]);
    expect(Object.keys(preferencesByWorkspacePath)).toHaveLength(workspacePaths.length);
    for (const [index, workspacePath] of workspacePaths.entries()) {
      expect(preferencesByWorkspacePath[workspacePath]?.model).toBe(`gpt-5.6-${index}`);
    }
  });

  it("preserves valid preferences when one workspace has a future reasoning effort", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-preferences-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "preferences.json");
    await writeFile(
      path,
      JSON.stringify({
        preferences: {
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          runtimeMode: "default",
        },
        runtimePreferencesByWorkspacePath: {
          "/future": {
            model: "future-model",
            reasoningEffort: "beyond-ultra",
            runtimeMode: "default",
          },
          "/valid": {
            model: "gpt-5.6-luna",
            reasoningEffort: "max",
            runtimeMode: "default",
          },
        },
      }),
    );

    const store = createFileRuntimePreferencesStore(path);

    await expect(store.read()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
    });
    await expect(store.readByWorkspacePath()).resolves.toEqual({
      "/future": {
        model: "future-model",
        reasoningEffort: "beyond-ultra",
        runtimeMode: "default",
      },
      "/valid": {
        model: "gpt-5.6-luna",
        reasoningEffort: "max",
        runtimeMode: "default",
      },
    });
  });
});
