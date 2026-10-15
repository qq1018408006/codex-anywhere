import {
  RuntimePreferencesSchema,
  UpdateRuntimePreferencesRequestSchema,
  type RuntimePreferences,
  type RuntimePreferencesByWorkspacePath,
  type UpdateRuntimePreferencesRequest,
} from "./api-schema.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const defaultRuntimePreferences: RuntimePreferences = { runtimeMode: "default" };
const PersistedRuntimePreferencesSchema = RuntimePreferencesSchema;
const RuntimePreferencesFileSchema = z.object({
  preferences: PersistedRuntimePreferencesSchema.default(defaultRuntimePreferences),
  runtimePreferencesByWorkspacePath: z
    .record(z.string().trim().min(1), PersistedRuntimePreferencesSchema)
    .default({}),
});

type RuntimePreferencesFile = z.infer<typeof RuntimePreferencesFileSchema>;

export type RuntimePreferencesStore = {
  read(workspacePath?: string): Promise<RuntimePreferences>;
  readByWorkspacePath(): Promise<RuntimePreferencesByWorkspacePath>;
  update(
    preferences: UpdateRuntimePreferencesRequest,
    workspacePath?: string,
  ): Promise<RuntimePreferences>;
};

export function createMemoryRuntimePreferencesStore(
  initial: RuntimePreferences = defaultRuntimePreferences,
): RuntimePreferencesStore {
  let current: RuntimePreferencesFile = {
    preferences: RuntimePreferencesSchema.parse(initial),
    runtimePreferencesByWorkspacePath: {},
  };
  return {
    async read(workspacePath) {
      return workspacePath
        ? (current.runtimePreferencesByWorkspacePath[workspacePath] ?? current.preferences)
        : current.preferences;
    },
    async readByWorkspacePath() {
      return current.runtimePreferencesByWorkspacePath;
    },
    async update(preferences, workspacePath) {
      current = updatePreferencesFile(current, preferences, workspacePath);
      return workspacePath
        ? (current.runtimePreferencesByWorkspacePath[workspacePath] ?? current.preferences)
        : current.preferences;
    },
  };
}

export function createFileRuntimePreferencesStore(path: string): RuntimePreferencesStore {
  let updateQueue = Promise.resolve();

  async function readPreferences() {
    try {
      return parseRuntimePreferencesFile(JSON.parse(await readFile(path, "utf8")));
    } catch {
      return RuntimePreferencesFileSchema.parse({});
    }
  }

  return {
    async read(workspacePath) {
      await updateQueue;
      const current = await readPreferences();
      return workspacePath
        ? (current.runtimePreferencesByWorkspacePath[workspacePath] ?? current.preferences)
        : current.preferences;
    },
    async readByWorkspacePath() {
      await updateQueue;
      return (await readPreferences()).runtimePreferencesByWorkspacePath;
    },
    update(preferences, workspacePath) {
      const operation = updateQueue.then(async () => {
        const next = updatePreferencesFile(await readPreferences(), preferences, workspacePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        return workspacePath
          ? (next.runtimePreferencesByWorkspacePath[workspacePath] ?? next.preferences)
          : next.preferences;
      });
      updateQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}

function parseRuntimePreferencesFile(payload: unknown) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if ("preferences" in record || "runtimePreferencesByWorkspacePath" in record) {
      return RuntimePreferencesFileSchema.parse(payload);
    }
  }

  const legacyPreferences = PersistedRuntimePreferencesSchema.safeParse(payload);
  if (legacyPreferences.success) {
    return RuntimePreferencesFileSchema.parse({
      preferences: legacyPreferences.data,
      runtimePreferencesByWorkspacePath: {},
    });
  }

  return RuntimePreferencesFileSchema.parse({});
}

function updatePreferencesFile(
  current: RuntimePreferencesFile,
  patch: UpdateRuntimePreferencesRequest,
  workspacePath: string | undefined,
) {
  if (!workspacePath) {
    return RuntimePreferencesFileSchema.parse({
      ...current,
      preferences: mergeRuntimePreferences(current.preferences, patch),
    });
  }
  return RuntimePreferencesFileSchema.parse({
    ...current,
    runtimePreferencesByWorkspacePath: {
      ...current.runtimePreferencesByWorkspacePath,
      [workspacePath]: mergeRuntimePreferences(
        current.runtimePreferencesByWorkspacePath[workspacePath] ?? current.preferences,
        patch,
      ),
    },
  });
}

function mergeRuntimePreferences(
  current: RuntimePreferences,
  patch: UpdateRuntimePreferencesRequest,
) {
  const parsedPatch = UpdateRuntimePreferencesRequestSchema.parse(patch);
  const {
    model,
    serviceTier,
    reasoningEffort,
    threadId: _threadId,
    workspacePath: _workspacePath,
    ...rest
  } = parsedPatch;
  const next = {
    ...current,
    ...rest,
    ...(model === null ? {} : { model }),
    ...(serviceTier === null ? {} : { serviceTier }),
    ...(reasoningEffort === null ? {} : { reasoningEffort }),
  };
  if (model === null) {
    delete next.model;
  }
  if (serviceTier === null) {
    delete next.serviceTier;
  }
  if (reasoningEffort === null) {
    delete next.reasoningEffort;
  }
  return RuntimePreferencesSchema.parse({
    ...next,
  });
}
