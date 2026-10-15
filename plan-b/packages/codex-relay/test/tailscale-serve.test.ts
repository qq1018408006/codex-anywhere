import { describe, expect, it } from "vitest";

import {
  type ExecFileOptions,
  parseTailscaleServePreviewUrl,
  startTailscaleServeForPreviewUrl,
  type ExecFileResult,
  type ExecFileRunner,
} from "../src/tailscale-serve.js";

describe("parseTailscaleServePreviewUrl", () => {
  it("returns the port and normalized source URL for a Tailscale preview URL", () => {
    expect(parseTailscaleServePreviewUrl("http://100.103.76.81:3000/")).toEqual({
      port: 3000,
      sourceUrl: "http://100.103.76.81:3000/",
    });
  });

  it("rejects a local network preview URL", () => {
    expect(() => parseTailscaleServePreviewUrl("http://192.168.1.4:3000")).toThrow(
      "Preview URL must use a Tailscale 100.64.0.0/10 or .ts.net host.",
    );
  });

  it("rejects a Tailscale preview URL without an explicit port", () => {
    expect(() => parseTailscaleServePreviewUrl("http://100.103.76.81/")).toThrow(
      "Preview URL must include an explicit port.",
    );
  });
});

describe("startTailscaleServeForPreviewUrl", () => {
  it("starts Tailscale Serve for the preview port and returns the Serve URL", async () => {
    const calls: Array<{
      readonly args: readonly string[];
      readonly file: string;
      readonly options: ExecFileOptions;
    }> = [];
    const execFile: ExecFileRunner = async (file, args, options): Promise<ExecFileResult> => {
      calls.push({ args, file, options });
      return {
        stderr: "",
        stdout: "Available within your tailnet:\nhttps://device.tailnet.ts.net\n",
      };
    };

    await expect(
      startTailscaleServeForPreviewUrl({
        execFile,
        url: "http://100.103.76.81:3000/",
      }),
    ).resolves.toEqual({
      port: 3000,
      url: "https://device.tailnet.ts.net",
    });

    expect(calls).toEqual([
      {
        file: "tailscale",
        args: ["serve", "--bg", "3000"],
        options: expect.any(Object),
      },
    ]);
  });
});
