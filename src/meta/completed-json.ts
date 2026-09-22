import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "./filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "./json-runtime.ts";
import type { JsonValue } from "./json-shape.ts";
import { runtimeProcess } from "./process.ts";
import { errorMessage } from "./runtime-values.ts";

/**
 * Publish bytes at `path` atomically: write beside the target, then rename onto it.
 *
 * A reader never sees a half-written file, because the rename is the only moment the name changes
 * what it points at. The temporary carries the pid and the millisecond so two writers do not meet,
 * and `wx` refuses rather than overwriting if they do anyway.
 *
 * Two other files wrote this out — the operator backend selection and the Builder prose sidecar —
 * and both cleaned up in `finally` rather than `catch`, which unlinks a path the successful rename
 * has already taken away and swallows the resulting ENOENT. Neither is JSON in the shape
 * `writeCompleted` publishes: one adds a trailing newline, the other writes JSONL.
 */
export function writeAtomic(path: string, bytes: string): void {
  const temporary = `${path}.tmp-${runtimeProcess.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Never written; nothing to review.
    }
    throw error;
  }
}

/**
 * The JSON in `path`. A missing or damaged file throws, as reading and parsing it would.
 *
 * Seventy call sites wrote this parse of `readFileSync(path, "utf8")` out inline, and fifteen skill
 * scripts wrapped it in a local `readJson`.
 */
export function readJsonFile(path: string): JsonValue {
  return capturedJsonParse(readFileSync(path, "utf8"));
}

/**
 * The JSON in `path`, or null when it is missing, unreadable or not JSON. For evidence that may be
 * absent, where a damaged file reads the same as an absent one. Eleven of those fifteen scripts
 * carried exactly this as their own reader; a reader that must refuse damage uses `readJsonFile`
 * behind its own `existsSync`, or `readCompleted` below.
 */
export function readJsonFileOrNull(path: string): JsonValue | null {
  try {
    return readJsonFile(path);
  } catch {
    return null;
  }
}

/**
 * Indented JSON with a trailing newline: the form a person reads and a diff shows cleanly. It takes
 * what `capturedJsonStringify` takes, since the evidence records written this way are interfaces,
 * which TypeScript does not treat as `JsonValue` even when every field is JSON.
 */
export function writeJsonFile<T>(path: string, value: T): void {
  writeFileSync(path, `${capturedJsonStringify(value, null, 2)}\n`);
}

/** Atomic publication for controller-owned JSON state. */
export function writeCompleted(path: string, value: JsonValue): void {
  writeAtomic(path, capturedJsonStringify(value, null, 2));
}

/** Read one completed array record. Damage refuses instead of becoming a silent fresh start. */
export function readCompleted<T extends { schema: string }>(
  file: string,
  schema: T["schema"],
  rows: keyof T & string,
  repair: string,
): T | null {
  if (!existsSync(file)) return null;
  let parsed: T;
  try {
    parsed = parseJsonAs<T>(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: unreadable (${errorMessage(error)}) — ${repair}`, { cause: error });
  }
  if (parsed?.schema !== schema || !Array.isArray(parsed[rows])) {
    throw new Error(`${file}: not a ${schema} record — ${repair}`);
  }
  return parsed;
}
