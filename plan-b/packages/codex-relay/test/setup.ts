// Modified for Codex Anywhere (2026); see the repository NOTICE.
import { vi } from "vitest";

const stores = new Map<string, Map<string, string | number>>();

vi.mock("react-native-mmkv", () => ({
  createMMKV(options?: { id?: string }) {
    const id = options?.id ?? "default";
    let store = stores.get(id);
    if (!store) {
      store = new Map();
      stores.set(id, store);
    }

    return {
      getString(key: string) {
        const value = store.get(key);
        return typeof value === "string" ? value : undefined;
      },
      getNumber(key: string) {
        const value = store.get(key);
        return typeof value === "number" ? value : undefined;
      },
      clearAll() {
        store.clear();
      },
      remove(key: string) {
        store.delete(key);
      },
      set(key: string, value: string | number) {
        store.set(key, value);
      },
    };
  },
}));
