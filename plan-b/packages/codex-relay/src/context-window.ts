import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContextWindowUsageSchema } from "./api-schema.js";

const contextReadCandidateLimit = 128;
const contextReadScanBytes = 512 * 1024;
const threadLookupScanBytes = 512 * 1024;
const turnLookupScanBytes = 16 * 1024;

export function readLatestContextWindowUsage({
  threadId,
  turnId,
}: {
  threadId: string;
  turnId?: string;
}) {
  const rolloutPath = findRecentRolloutFileForContextRead(resolveSessionsRoot(), {
    threadId,
    turnId,
  });
  if (!rolloutPath) {
    return { rolloutPath: null, usage: null };
  }

  const stat = fs.statSync(rolloutPath);
  const result = readRolloutUsageChunk({
    endExclusive: stat.size,
    filePath: rolloutPath,
    start: Math.max(0, stat.size - contextReadScanBytes),
  });

  return {
    rolloutPath,
    usage: result.usage,
  };
}

function resolveSessionsRoot() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "sessions");
}

function findRecentRolloutFileForContextRead(
  root: string,
  { threadId = "", turnId = "" }: { threadId?: string; turnId?: string },
) {
  const candidates = collectRecentRolloutFiles(root);
  if (candidates.length === 0) {
    return null;
  }

  if (turnId) {
    for (const candidate of candidates) {
      if (rolloutFileContainsTurnId(candidate.filePath, turnId)) {
        return candidate.filePath;
      }
    }
  }

  if (threadId) {
    const filenameMatch = candidates.find(({ filePath }) =>
      path.basename(filePath).includes(threadId),
    );
    if (filenameMatch) {
      return filenameMatch.filePath;
    }

    for (const candidate of candidates) {
      if (rolloutFileContainsThreadId(candidate.filePath, threadId)) {
        return candidate.filePath;
      }
    }
  }

  return null;
}

function collectRecentRolloutFiles(root: string) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const stack = [root];
  const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        candidates.push({ filePath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      }
    }
  }

  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, contextReadCandidateLimit);
}

function rolloutFileContainsTurnId(filePath: string, turnId: string) {
  const stat = fs.statSync(filePath);
  const chunk = readFileSlice(filePath, 0, Math.min(stat.size, turnLookupScanBytes));
  return chunk.includes(`"turn_id":"${turnId}"`) || chunk.includes(`"turnId":"${turnId}"`);
}

function rolloutFileContainsThreadId(filePath: string, threadId: string) {
  const stat = fs.statSync(filePath);
  const chunk = readFileSlice(
    filePath,
    Math.max(0, stat.size - Math.min(stat.size, threadLookupScanBytes)),
    stat.size,
  );
  return (
    chunk.includes(`"thread_id":"${threadId}"`) ||
    chunk.includes(`"threadId":"${threadId}"`) ||
    chunk.includes(`"conversation_id":"${threadId}"`) ||
    chunk.includes(`"conversationId":"${threadId}"`)
  );
}

function readRolloutUsageChunk({
  filePath,
  start,
  endExclusive,
}: {
  filePath: string;
  start: number;
  endExclusive: number;
}) {
  const chunk = readFileSlice(filePath, start, endExclusive);
  const lines = chunk.split("\n");
  if (start > 0) {
    lines.shift();
  }

  let latestUsage = null;
  for (const line of lines) {
    const usage = extractContextUsageFromRolloutLine(line);
    if (usage) {
      latestUsage = usage;
    }
  }

  return { usage: latestUsage };
}

function readFileSlice(filePath: string, start: number, endExclusive: number) {
  const length = Math.max(0, endExclusive - start);
  if (length === 0) {
    return "";
  }

  const fileHandle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fileHandle, buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    fs.closeSync(fileHandle);
  }
}

function extractContextUsageFromRolloutLine(rawLine: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine.trim());
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as { payload?: unknown; type?: unknown };
  if (record.type !== "event_msg" || !record.payload || typeof record.payload !== "object") {
    return null;
  }

  const payload = record.payload as { info?: unknown; type?: unknown };
  if (payload.type !== "token_count" || !payload.info || typeof payload.info !== "object") {
    return null;
  }

  return contextUsageFromTokenCountInfo(payload.info as Record<string, unknown>);
}

function contextUsageFromTokenCountInfo(info: Record<string, unknown>) {
  const usageRoot = objectValue(
    info.last_token_usage ?? info.lastTokenUsage ?? info.total_token_usage ?? info.totalTokenUsage,
  );
  const tokenLimit = positiveInteger(
    info.model_context_window ??
      info.modelContextWindow ??
      info.context_window ??
      info.contextWindow,
  );
  if (!tokenLimit) {
    return null;
  }

  const tokensUsed =
    positiveInteger(usageRoot?.total_tokens ?? usageRoot?.totalTokens) ??
    sumPositiveIntegers([
      usageRoot?.input_tokens ?? usageRoot?.inputTokens,
      usageRoot?.output_tokens ?? usageRoot?.outputTokens,
      usageRoot?.reasoning_output_tokens ?? usageRoot?.reasoningOutputTokens,
    ]);
  if (tokensUsed === null) {
    return null;
  }

  return ContextWindowUsageSchema.parse({
    tokenLimit,
    tokensUsed: Math.min(tokensUsed, tokenLimit),
  });
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function positiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function sumPositiveIntegers(values: unknown[]) {
  let sum = 0;
  let found = false;
  for (const value of values) {
    const parsed = positiveInteger(value);
    if (parsed !== null) {
      sum += parsed;
      found = true;
    }
  }
  return found ? sum : null;
}
