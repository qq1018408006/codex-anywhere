// Modified for Codex Anywhere (2026); see the repository NOTICE.
import type { ThreadSummary } from "codex-relay/api-schema";

import { workspaceName } from "../../lib/workspace-name";

const collapsedProjectThreadCount = 5;

export type DrawerRow =
  | { id: "pinned"; kind: "pinned" }
  | { id: string; kind: "agent-group"; count: number; expanded: boolean }
  | {
      id: string;
      kind: "project";
      projectKey: string;
      title: string;
      workspacePath?: string;
    }
  | {
      id: string;
      kind: "thread";
      projectKey: string;
      thread: ThreadSummary;
      workspaceTitle?: string;
      depth?: number;
      childCount?: number;
      expanded?: boolean;
    }
  | { id: string; kind: "more"; hiddenCount: number; projectKey: string };

type ThreadGroup = {
  title: string;
  threads: ThreadSummary[];
  workspacePath?: string;
};

export function buildSessionRows(
  threads: ThreadSummary[],
  pinnedThreadIds: string[] = [],
  searching = false,
  expandedThreads: Record<string, boolean> = {},
): DrawerRow[] {
  const sortedThreads = threadsWithUniqueIds(threads).sort(
    (a, b) =>
      Date.parse(b.lastActivityAt ?? b.updatedAt) - Date.parse(a.lastActivityAt ?? a.updatedAt),
  );
  const threadsById = new Map(sortedThreads.map((thread) => [thread.id, thread]));
  const pinnedThreads = searching ? [] : pinnedThreadsForIds(pinnedThreadIds, threadsById);
  const pinnedIds = new Set(pinnedThreads.map((thread) => thread.id));
  const rowForThread = (thread: ThreadSummary) =>
    threadRow(thread, projectKeyForThread(thread), workspaceName(thread.cwd));
  if (searching) return sortedThreads.map(rowForThread);
  const children = new Map<string, ThreadSummary[]>();
  for (const thread of sortedThreads) {
    if (!thread.parentThreadId || thread.parentThreadId === thread.id) continue;
    const siblings = children.get(thread.parentThreadId) ?? [];
    siblings.push(thread);
    children.set(thread.parentThreadId, siblings);
  }
  const activity = (thread: ThreadSummary, seen = new Set<string>()): number => {
    if (seen.has(thread.id)) return 0;
    seen.add(thread.id);
    return Math.max(
      Date.parse(thread.lastActivityAt ?? thread.updatedAt),
      ...(children.get(thread.id) ?? []).map((child) => activity(child, seen)),
    );
  };
  const rows: DrawerRow[] = pinnedThreads.length ? [{ id: "pinned", kind: "pinned" }] : [];
  const visited = new Set<string>();
  const append = (thread: ThreadSummary, depth = 0) => {
    if (visited.has(thread.id)) return;
    visited.add(thread.id);
    const descendants = children.get(thread.id) ?? [];
    const expanded = expandedThreads[`children:${thread.id}`] ?? false;
    rows.push({ ...rowForThread(thread), depth, childCount: descendants.length, expanded });
    if (expanded) descendants.forEach((child) => append(child, depth + 1));
  };
  pinnedThreads.forEach((thread) => append(thread));
  const roots = sortedThreads.filter(
    (thread) =>
      !thread.parentThreadId &&
      (children.has(thread.id) || (thread.source !== "exec" && thread.source !== "subAgent")),
  );
  roots.sort((a, b) => activity(b) - activity(a));
  const rootIds = new Set(roots.map((thread) => thread.id));
  roots.forEach((thread) => {
    if (!pinnedIds.has(thread.id)) append(thread);
  });
  // Known children stay with their parent even when the parent is collapsed.
  const belongsToRoot = (thread: ThreadSummary) => {
    const seen = new Set<string>();
    let current: ThreadSummary | undefined = thread;
    while (current && !seen.has(current.id)) {
      if (rootIds.has(current.id) || pinnedIds.has(current.id)) return true;
      seen.add(current.id);
      current = current.parentThreadId ? threadsById.get(current.parentThreadId) : undefined;
    }
    return false;
  };
  const unassigned = sortedThreads.filter(
    (thread) => !visited.has(thread.id) && !belongsToRoot(thread),
  );
  if (unassigned.length) {
    const expanded = expandedThreads["unassigned-agents"] ?? false;
    rows.push({ id: "unassigned-agents", kind: "agent-group", count: unassigned.length, expanded });
    if (expanded) {
      const unassignedIds = new Set(unassigned.map((thread) => thread.id));
      unassigned
        .filter((thread) => !thread.parentThreadId || !unassignedIds.has(thread.parentThreadId))
        .forEach((thread) => append(thread, 1));
    }
  }
  return rows;
}

export function buildDrawerRows(
  threads: ThreadSummary[],
  expandedProjects: Record<string, boolean>,
  activeThreadId: string | undefined,
  pinnedThreadIds: string[] = [],
  forceExpanded = false,
): DrawerRow[] {
  const uniqueThreads = threadsWithUniqueIds(threads);
  const threadsById = new Map(uniqueThreads.map((thread) => [thread.id, thread]));
  const pinnedThreads = forceExpanded ? [] : pinnedThreadsForIds(pinnedThreadIds, threadsById);
  const pinnedThreadIdsSet = new Set(pinnedThreads.map((thread) => thread.id));
  const groups = new Map<string, ThreadGroup>();

  for (const thread of uniqueThreads) {
    const title = workspaceName(thread.cwd) ?? "codex-relay";
    const projectKey = thread.cwd ?? title;
    const group = groups.get(projectKey);
    if (group) {
      group.threads.push(thread);
    } else {
      groups.set(projectKey, { title, threads: [thread], workspacePath: thread.cwd });
    }
  }

  const rows: DrawerRow[] = [];
  if (pinnedThreads.length > 0) {
    rows.push({ id: "pinned", kind: "pinned" });
    rows.push(
      ...pinnedThreads.map((thread) =>
        threadRow(thread, projectKeyForThread(thread), workspaceName(thread.cwd) ?? "codex-relay"),
      ),
    );
  }

  for (const [projectKey, group] of groups) {
    const unpinnedThreads = forceExpanded
      ? group.threads
      : group.threads.filter((thread) => !pinnedThreadIdsSet.has(thread.id));
    const isExpanded = forceExpanded || (expandedProjects[projectKey] ?? false);
    const activeThread = activeThreadId
      ? unpinnedThreads.find((thread) => thread.id === activeThreadId)
      : undefined;
    const collapsedThreads = unpinnedThreads.slice(0, collapsedProjectThreadCount);
    const visibleThreads =
      isExpanded || !activeThread || collapsedThreads.includes(activeThread)
        ? isExpanded
          ? unpinnedThreads
          : collapsedThreads
        : [...collapsedThreads.slice(0, collapsedProjectThreadCount - 1), activeThread];
    const hiddenCount = unpinnedThreads.length - visibleThreads.length;

    rows.push({
      id: `project:${projectKey}`,
      kind: "project",
      projectKey,
      title: group.title,
      workspacePath: group.workspacePath,
    });
    rows.push(...visibleThreads.map((thread) => threadRow(thread, projectKey)));

    if (hiddenCount > 0) {
      rows.push({
        id: `more:${projectKey}`,
        kind: "more",
        hiddenCount,
        projectKey,
      });
    }
  }

  return rows;
}

function threadsWithUniqueIds(threads: ThreadSummary[]) {
  const threadIds = new Set<string>();
  return threads.filter((thread) => {
    if (threadIds.has(thread.id)) {
      return false;
    }
    threadIds.add(thread.id);
    return true;
  });
}

function pinnedThreadsForIds(pinnedThreadIds: string[], threadsById: Map<string, ThreadSummary>) {
  const pinnedIds = new Set<string>();
  const pinnedThreads: ThreadSummary[] = [];
  for (const threadId of pinnedThreadIds) {
    if (pinnedIds.has(threadId)) {
      continue;
    }
    pinnedIds.add(threadId);
    const thread = threadsById.get(threadId);
    if (thread) {
      pinnedThreads.push(thread);
    }
  }
  return pinnedThreads;
}

function projectKeyForThread(thread: ThreadSummary) {
  const title = workspaceName(thread.cwd) ?? "codex-relay";
  return thread.cwd ?? title;
}

function threadRow(
  thread: ThreadSummary,
  projectKey: string,
  workspaceTitle?: string,
): Extract<DrawerRow, { kind: "thread" }> {
  return {
    id: `thread:${thread.id}`,
    kind: "thread",
    projectKey,
    thread,
    ...(workspaceTitle ? { workspaceTitle } : {}),
  };
}
