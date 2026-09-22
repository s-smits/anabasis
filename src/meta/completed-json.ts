import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "./filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "./json-runtime.ts";
import type { JsonValue } from "./json-shape.ts";
import { runtimeProcess } from "./process.ts";
import { errorMessage } from "./runtime-values.ts";

/**
 * Publish bytes at `path` atomically: write beside the target, then rename onto it, so a reader
 * never sees a half-written file. The temporary carries the pid and the millisecond, and `wx`
 * refuses rather than overwrite if two writers meet anyway.
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

/** The JSON in `path`. A missing or damaged file throws. */
export function readJsonFile(path: string): JsonValue {
  return capturedJsonParse(readFileSync(path, "utf8"));
}

/**
 * The JSON in `path`, or null when it is missing, unreadable or not JSON. A reader that must refuse
 * damage uses `readJsonFile` or `readCompleted` instead.
 */
export function readJsonFileOrNull(path: string): JsonValue | null {
  try {
    return readJsonFile(path);
  } catch {
    return null;
  }
}

/**
 * Indented JSON with a trailing newline. It takes any `T`, because TypeScript does not treat an
 * interface as `JsonValue` even when every field is JSON.
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
