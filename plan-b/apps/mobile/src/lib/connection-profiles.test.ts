import { beforeEach, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => new Map<string, Map<string, string | number>>());
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-mmkv", () => ({
  createMMKV: ({ id }: { id: string }) => {
    const values = stores.get(id) ?? new Map<string, string | number>();
    stores.set(id, values);
    return {
      getString: (key: string) => values.get(key) as string | undefined,
      getNumber: (key: string) => values.get(key) as number | undefined,
      set: (key: string, value: string | number) => values.set(key, value),
      remove: (key: string) => values.delete(key),
      clearAll: () => values.clear(),
    };
  },
}));

import {
  codexRelayStorage,
  getCodexRelayServerUrl,
  setCodexRelayServerUrl,
} from "./codex-relay-server-url-storage";
import {
  activateConnection,
  getConnectionProfiles,
  saveActiveConnection,
  saveConnectionProfile,
} from "./connection-profiles";
import { encryptRequestPayload } from "./secure-transport";

beforeEach(() => {
  for (const values of stores.values()) values.clear();
  codexRelayStorage.set("codex-relay.client-token", "existing-token");
  setCodexRelayServerUrl("http://192.168.1.11:8787");
  const legacy = stores.get("codex-relay-secure")!;
  legacy.set("key-epoch", 7);
  legacy.set("mobile-to-server-key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  legacy.set("server-to-mobile-key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  legacy.set("next-mobile-counter", 12);
});

it("keeps existing pairing when editing its address to a public endpoint", () => {
  const [current] = getConnectionProfiles();
  const edited = saveConnectionProfile({
    id: current.id,
    name: "家里",
    serverUrl: "https://relay.example.com/",
  });
  activateConnection(edited.id);
  expect(getCodexRelayServerUrl()).toBe("https://relay.example.com");
  expect(codexRelayStorage.getString("codex-relay.client-token")).toBe("existing-token");
  encryptRequestPayload({ text: "test" });
  expect(stores.get(`codex-relay-secure-${current.id}`)?.get("next-mobile-counter")).toBe(13);
});

it("restores each backend's own token and encryption counter when switching back", () => {
  const [first] = getConnectionProfiles();
  encryptRequestPayload({ text: "before switch" });
  const second = saveConnectionProfile({
    name: "另一个 runtime",
    serverUrl: "http://10.0.0.2:9000",
  });
  activateConnection(second.id);
  expect(codexRelayStorage.getString("codex-relay.client-token")).toBeUndefined();
  codexRelayStorage.set("codex-relay.client-token", "other-token");
  saveActiveConnection();
  activateConnection(first.id);
  expect(codexRelayStorage.getString("codex-relay.client-token")).toBe("existing-token");
  encryptRequestPayload({ text: "after switch" });
  expect(stores.get(`codex-relay-secure-${first.id}`)?.get("next-mobile-counter")).toBe(14);
  activateConnection(second.id);
  expect(codexRelayStorage.getString("codex-relay.client-token")).toBe("other-token");
});
