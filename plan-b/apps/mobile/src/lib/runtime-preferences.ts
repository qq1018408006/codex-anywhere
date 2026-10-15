import type { RuntimePreferences } from "codex-relay/api-schema";

export function runtimePreferencesForWorkspace(
  pending: RuntimePreferences | undefined,
  fallback: RuntimePreferences,
): RuntimePreferences {
  return pending ?? fallback;
}
