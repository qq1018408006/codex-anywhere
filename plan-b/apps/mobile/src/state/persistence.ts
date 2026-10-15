import type {
  Change,
  Observable,
  ObservablePersistLocal,
  PersistMetadata,
  PersistOptionsLocal,
} from "@legendapp/state";
import { internal, setAtPath } from "@legendapp/state";
import { configureObservablePersistence, persistObservable } from "@legendapp/state/persist";
import { createMMKV, type MMKV } from "react-native-mmkv";

const localStateStorageId = "codex-relay-local-state";
let isConfigured = false;

export function persistLocalObservable<T>(state$: Observable<T>, name: string) {
  configureLocalObservablePersistence();
  return persistObservable(state$, {
    local: {
      name,
      mmkv: {
        id: localStateStorageId,
      },
    },
  });
}

function configureLocalObservablePersistence() {
  if (isConfigured) {
    return;
  }

  configureObservablePersistence({
    pluginLocal: ObservablePersistNitroMMKV,
  });
  isConfigured = true;
}

const defaultStorageKey = Symbol("default");
const metadataSuffix = "__m";

class ObservablePersistNitroMMKV implements ObservablePersistLocal {
  private data: Record<string, object | undefined> = {};
  private storages = new Map<symbol | string, MMKV>([
    [
      defaultStorageKey,
      createMMKV({
        id: localStateStorageId,
      }),
    ],
  ]);

  getTable<T = unknown>(table: string, config: PersistOptionsLocal, init: object): T {
    const storage = this.getStorage(config);
    if (this.data[table] === undefined) {
      try {
        const value = storage.getString(table);
        this.data[table] = value ? internal.safeParse(value) : init;
      } catch {
        this.data[table] = init;
      }
    }
    return this.data[table] as T;
  }

  getMetadata(table: string, config: PersistOptionsLocal): PersistMetadata {
    return this.getTable(table + metadataSuffix, config, {});
  }

  set(table: string, changes: Change[], config: PersistOptionsLocal) {
    if (!this.data[table]) {
      this.data[table] = {};
    }

    for (const change of changes) {
      this.data[table] = setAtPath(
        this.data[table],
        change.path,
        change.pathTypes,
        change.valueAtPath,
      );
    }
    this.save(table, config);
  }

  setMetadata(table: string, metadata: PersistMetadata, config: PersistOptionsLocal) {
    this.setValue(table + metadataSuffix, metadata, config);
  }

  deleteTable(table: string, config: PersistOptionsLocal) {
    delete this.data[table];
    this.getStorage(config).remove(table);
  }

  deleteMetadata(table: string, config: PersistOptionsLocal) {
    this.deleteTable(table + metadataSuffix, config);
  }

  private setValue(table: string, value: object, config: PersistOptionsLocal) {
    this.data[table] = value;
    this.save(table, config);
  }

  private save(table: string, config: PersistOptionsLocal) {
    const value = this.data[table];
    if (value === undefined) {
      this.getStorage(config).remove(table);
      return;
    }

    this.getStorage(config).set(table, internal.safeStringify(value));
  }

  private getStorage(config: PersistOptionsLocal) {
    if (!config.mmkv) {
      return this.storages.get(defaultStorageKey)!;
    }

    const key = JSON.stringify(config.mmkv);
    let storage = this.storages.get(key);
    if (!storage) {
      storage = createMMKV(config.mmkv);
      this.storages.set(key, storage);
    }
    return storage;
  }
}
