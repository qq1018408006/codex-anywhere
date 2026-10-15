import { describe, expect, it } from "vitest";

import { resolveWorkspaceTerminalShell } from "../src/workspace-terminal-shell.js";

describe("resolveWorkspaceTerminalShell", () => {
  it("uses COMSPEC without login args when resolving Windows shell", () => {
    const result = resolveWorkspaceTerminalShell({
      env: {
        COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        SHELL: "/usr/bin/zsh",
      },
      platform: "win32",
    });

    expect(result).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });

  it("falls back to PowerShell without login args when Windows COMSPEC is blank", () => {
    const result = resolveWorkspaceTerminalShell({
      env: {
        COMSPEC: "",
        SHELL: "/usr/bin/zsh",
      },
      platform: "win32",
    });

    expect(result).toEqual({
      args: [],
      command: "powershell.exe",
    });
  });

  it("falls back to PowerShell without login args when Windows COMSPEC is whitespace", () => {
    const result = resolveWorkspaceTerminalShell({
      env: {
        COMSPEC: "   ",
        SHELL: "/usr/bin/zsh",
      },
      platform: "win32",
    });

    expect(result).toEqual({
      args: [],
      command: "powershell.exe",
    });
  });

  it("uses SHELL with login args when resolving POSIX shell", () => {
    const result = resolveWorkspaceTerminalShell({
      env: {
        SHELL: "/usr/bin/zsh",
      },
      platform: "darwin",
    });

    expect(result).toEqual({
      args: ["-l"],
      command: "/usr/bin/zsh",
    });
  });

  it("falls back to /bin/sh with login args when POSIX SHELL is blank", () => {
    const result = resolveWorkspaceTerminalShell({
      env: {
        SHELL: "",
      },
      platform: "linux",
    });

    expect(result).toEqual({
      args: ["-l"],
      command: "/bin/sh",
    });
  });
});
