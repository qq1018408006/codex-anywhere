import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { codexRelayDataPath } from "../src/paths.js";

describe("Codex Relay data paths", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
  });

  it("keeps data paths stable when the process cwd changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const otherCwd = await mkdtemp(join(tmpdir(), "codex-relay-cwd-"));
    vi.stubEnv("CODEX_RELAY_HOME", home);

    expect(codexRelayDataPath("preferences.json")).toBe(join(home, "preferences.json"));

    process.chdir(otherCwd);

    expect(codexRelayDataPath("preferences.json")).toBe(join(home, "preferences.json"));
  });
});
