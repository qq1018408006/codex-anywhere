export const workspaceFileContentQueryKey = (
  workspacePath: string | undefined,
  path: string | null,
) => ["codex-relay-workspace-preview-file", workspacePath ?? null, path] as const;

export const workspaceFilesQueryKeyPrefix = (workspacePath: string | undefined) =>
  ["codex-relay-workspace-preview-files", workspacePath ?? null] as const;
