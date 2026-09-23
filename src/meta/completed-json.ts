import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "./filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "./json-runtime.ts";
import type { JsonValue } from "./json-shape.ts";
import { runtimeProcess } from "./process.ts";
import { errorMessage } from "./runtime-values.ts";

/**
 * Publish bytes at `path` atomically: write beside the target, then rename onto it.
 *
 * A reader never sees a half-written file, because the rename is the only moment the name changes
 * what it points at. The temporary carries the pid and the millisecond so that two writers do not
 * meet, and `wx` refuses rather than overwriting if they do anyway.
 *
 * Two other files wrote this out themselves — the operator backend selection and the Builder prose
 * sidecar — and both cleaned up in `finally` rather than `catch`, which unlinks a path the
 * successful rename has already taken away and then swallows the ENOENT that follows. Neither
 * publishes JSON in the shape `writeCompleted` does: one adds a trailing newline, the other writes
 * JSONL, which is why the atomic part lives here on its own.
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
 * The JSON in `path`. A missing or damaged file throws, exactly as reading and parsing it by hand
 * would. It is the one owner of the `capturedJsonParse(readFileSync(path, "utf8"))` that call sites
 * and skill scripts otherwise each write out for themselves.
 */
export function readJsonFile(path: string): JsonValue {
  return capturedJsonParse(readFileSync(path, "utf8"));
}

/**
 * The JSON in `path`, or null when it is missing, unreadable or not JSON. It is for evidence that
 * may legitimately be absent, where a damaged file may be read the same way as an absent one. A
 * caller that must tell damage from absence uses `readJsonFile` behind its own `existsSync`, or
 * `readCompleted` below.
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
 * any `T` because the evidence records written this way are interfaces, and TypeScript does not
 * treat an interface as `JsonValue` even when every one of its fields is JSON.
 */
export function writeJsonFile<T>(path: string, value: T): void {
  writeFileSync(path, `${capturedJsonStringify(value, null, 2)}\n`);
}

/** Atomic publication for controller-owned JSON state. */
export function writeCompleted(path: string, value: JsonValue): void {
  writeAtomic(path, capturedJsonStringify(value, null, 2));
}

/** Read one completed array record, refusing damage instead of letting it become a silent fresh
 *  start. The records read this way are the controller's own memory — the epoch list, the project
 *  registry, the recorded reviews — where a file returned as null reads as "nothing has happened
 *  yet", and the run then repeats work it has already paid for. The repair sentence travels with the
 *  refusal because the person who meets it is looking at a file, not at this function. */
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
