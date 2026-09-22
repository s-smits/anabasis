/**
 * Controller-owned runtime primitives captured before any generated module can execute.
 *
 * Captured references keep later changes to mutable globals or builtin ESM exports from replacing
 * the functions these callers use. Checkpoint and reference-solve lifecycle code retain the
 * original controller functions. This protects only the named references; separate worker
 * processes and OS policies provide runtime isolation from generated code.
 */
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from "../meta/filesystem.ts";
import { join as nodeJoin } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { capturedJsonParse, capturedJsonStringify, capturedStructuredClone } from "../meta/json-runtime.ts";

export const trustedStructuredClone = capturedStructuredClone;
export const trustedJsonParse = capturedJsonParse;
export const trustedJsonStringify = capturedJsonStringify;
export const trustedExecPath = runtimeProcess.execPath;
export const trustedSpawn = Bun.spawn;

export const trustedExistsSync = nodeExistsSync;
export const trustedReadFileSync = nodeReadFileSync;
export const trustedJoin = nodeJoin;
