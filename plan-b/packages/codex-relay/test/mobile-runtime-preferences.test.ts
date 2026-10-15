import { describe, expect, it } from "vitest";
import type { RuntimePreferences } from "../src/api-schema.js";

import { runtimePreferencesForWorkspace } from "../../../apps/mobile/src/lib/runtime-preferences.js";

describe("mobile runtime preferences", () => {
  it("uses pending workspace selections before global defaults", () => {
    const fallback: RuntimePreferences = {
      model: "global-model",
      serviceTier: "priority",
      reasoningEffort: "medium",
      runtimeMode: "default",
    };
    const pending: RuntimePreferences = {
      model: "pending-model",
      serviceTier: "priority",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    };

    expect(runtimePreferencesForWorkspace(pending, fallback)).toEqual(pending);
  });

  it("uses global defaults when workspace has no override", () => {
    const fallback: RuntimePreferences = {
      model: "global-model",
      serviceTier: "priority",
      reasoningEffort: "medium",
      runtimeMode: "default",
    };

    expect(runtimePreferencesForWorkspace(undefined, fallback)).toEqual(fallback);
  });

  it("uses workspace preferences as one workspace-scoped selection", () => {
    const fallback: RuntimePreferences = {
      model: "global-model",
      serviceTier: "priority",
      reasoningEffort: "medium",
      runtimeMode: "default",
    };

    expect(runtimePreferencesForWorkspace({ runtimeMode: "auto" }, fallback)).toEqual({
      runtimeMode: "auto",
    });
  });

  it("uses workspace model and reasoning instead of stale thread-scoped values", () => {
    const fallback: RuntimePreferences = {
      model: "global-model",
      serviceTier: "priority",
      reasoningEffort: "medium",
      runtimeMode: "default",
    };
    const workspace: RuntimePreferences = {
      model: "workspace-model",
      serviceTier: "priority",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    };

    expect(runtimePreferencesForWorkspace(workspace, fallback)).toEqual({
      model: "workspace-model",
      serviceTier: "priority",
      reasoningEffort: "high",
      runtimeMode: "full-access",
    });
  });
});
