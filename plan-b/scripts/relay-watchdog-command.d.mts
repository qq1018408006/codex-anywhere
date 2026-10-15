export function relayServiceCommand(cliArgs: string[]): {
  command: string;
  args: string[];
};

export function relayHealthUrl(env?: Record<string, string | undefined>): string;

export function isRelayHealthy(
  fetchImpl: (
    url: string,
    init: { method: "GET" },
  ) => Promise<{ json: () => Promise<unknown>; ok: boolean }>,
  url: string,
): Promise<boolean>;
