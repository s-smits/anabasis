/**
 * Durable's filesystem and shell on a seat's command wall. Every operation runs durable's own
 * `NodeExecutionEnv`, its files staged beside a small worker and run inside the wall, so the
 * semantics are upstream's and the OS policy stays the only authority, for symlinks and concurrent
 * path changes too. The host only stages files under `kept` and never opens a model-named path.
 *
 * Until 22 October the worker held its own copies of every file and shell operation. Durable's
 * conformance suite (`test/walled-env-conformance.test.ts`) then found two of them wrong: a
 * command's timeout under the wall's default never fired, and a directory reader returned entries
 * removed while it paged. The readers stay on the host, as snapshots a worker took, since an open
 * descriptor cannot cross the wall; a directory reader lists again for each page, as upstream's
 * reads each entry as it pages. All operations share a queue because runWalled shares the profile
 * and leader files.
 *
 * The worker's shell is the one that reads a model's bash call, so it is `/bin/bash`, as the
 * wall's is (`stageCommandIsolation` says why); with `/bin/sh` here, process substitution still
 * failed whatever the wall ran.
 */
import {
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  ExecutionError,
  type ExecutionErrorCode,
  FileError,
  type FileErrorCode,
  type FileInfo,
  LineScanner,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputSkip,
  type TextLine,
  type TextLineReader,
} from "@earendil-works/pi-durable/env";
import { readFileSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { capturedExecPath } from "../meta/process.ts";
import { asError } from "../meta/runtime-values.ts";
import { shellQuote } from "../wall/isolation.ts";
import { type CommandWall, heldSeconds, runWalled } from "./command.ts";

type Context = Parameters<ExecutionEnv["exists"]>[1];
type Wire<T> = Result<T, { code: string; message: string; spillPath?: string }>;
type Frame<T> = { text: string; stream: "stdout" | "stderr"; skipped?: ShellOutputSkip } | { done: Wire<T> };
interface Snapshot {
  info: FileInfo;
  bytes: string;
}

const MAX_BYTES = 16 * 1024 * 1024;
const FILE_CODES = [
  "aborted",
  "not_found",
  "permission_denied",
  "not_directory",
  "is_directory",
  "invalid",
  "not_supported",
] as const satisfies readonly FileErrorCode[];
const EXEC_CODES = [
  "aborted",
  "timeout",
  "shell_unavailable",
  "spawn_error",
  "callback_error",
] as const satisfies readonly ExecutionErrorCode[];
const QUEUES = new WeakMap<CommandWall, Promise<void>>();
const ENV_DIR = dirname(Bun.fileURLToPath(import.meta.resolve("@earendil-works/pi-durable/env")));
const ENV_FILES = ["decode.js", "index.js", "line-scan.js", "node-watch.js", "node.js"];
let envSources: readonly (readonly [string, string])[] | undefined;

// This program and its request are staged under kept; model files cannot replace either. It runs
// one operation of durable's environment, streams a command's output, and ends with the result.
const WORKER = String.raw`
import { readFileSync, writeSync } from "node:fs";
import { NodeExecutionEnv } from "./node.js";
const { op, args, cwd, max } = JSON.parse(readFileSync("request", "utf8"));
const send = (frame) => {
  const data = Buffer.from(JSON.stringify(frame) + "\n");
  for (let offset = 0; offset < data.length;) offset += writeSync(1, data, offset, data.length - offset);
};
const env = new NodeExecutionEnv({ cwd, shellPath: "/bin/bash" });
const context = {};
const tooLarge = { ok: false, error: { code: "invalid", message: "File exceeds the 16 MiB read bound; read parts with exec" } };
const snapshot = async (path, options) => {
  const opened = await env.openBinaryReader(path, options, context);
  if (!opened.ok) return opened;
  try {
    const info = await opened.value.info(context);
    if (!info.ok) return info;
    if (info.value.size > max) return tooLarge;
    const bytes = await opened.value.read(0, info.value.size, context);
    return bytes.ok ? { ok: true, value: { info: info.value, bytes: Buffer.from(bytes.value).toString("base64") } } : bytes;
  } finally {
    await opened.value.close(context);
  }
};
const lines = async (path) => {
  const opened = await env.openTextLineReader(path, context);
  if (!opened.ok) return opened;
  try {
    const value = [];
    for (let size = 0; size <= max;) {
      const line = await opened.value.readLine(context);
      if (!line.ok) return line;
      if (line.value === undefined) return { ok: true, value };
      value.push(line.value);
      size += line.value.text.length;
    }
    return tooLarge;
  } finally {
    await opened.value.close(context);
  }
};
const run = () => {
  switch (op) {
    case "snapshot": return snapshot(...args);
    case "lines": return lines(...args);
    case "writeFile": case "appendFile": return env[op](args[0], readFileSync("content"), context);
    case "exec": return env.exec(args[0], { ...args[1], onOutput: (text, _context, info) => send({ text, ...info }) }, context);
    default: return env[op](...args, context);
  }
};
const result = await run().catch((error) => ({ ok: false, error }));
const { code, message, spillPath } = result.ok ? {} : result.error;
send({ done: result.ok ? result : { ok: false, error: { code: code ?? "unknown", message: String(message), ...(spillPath ? { spillPath } : {}) } } });
`;

/** The same CommandWall that codingTools takes; nothing is wired into a seat here. */
export function walledEnv(wall: CommandWall): ExecutionEnv {
  return new WalledEnv(wall);
}

class WalledEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  private readonly wall: CommandWall;
  private readonly lifetime = new AbortController();

  constructor(wall: CommandWall) {
    this.wall = wall;
    this.cwd = wall.dirs.home;
    this.id = `wall:${wall.base.policyHash}:${wall.dirs.root}`;
  }

  private path(path: string): string {
    const expanded =
      path === "~"
        ? this.wall.dirs.home
        : path.startsWith("~/")
          ? join(this.wall.dirs.home, path.slice(2))
          : path;
    return resolve(this.cwd, expanded);
  }

  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const next = (QUEUES.get(this.wall) ?? Promise.resolve()).then(work);
    QUEUES.set(
      this.wall,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return await next;
  }

  private signal(context: Context): AbortSignal {
    return context.abortSignal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([context.abortSignal, this.lifetime.signal]);
  }

  /** Runs `op` of durable's environment in a worker on the wall, with each output frame to `onText`. */
  private async call<T>(
    op: string,
    args: unknown[],
    context: Context,
    extra: {
      content?: string | Uint8Array | undefined;
      timeout?: number;
      onText?: (frame: Extract<Frame<T>, { text: string }>) => void;
    } = {},
  ): Promise<Wire<T>> {
    const signal = this.signal(context);
    return await this.serial<Wire<T>>(async () => {
      if (signal.aborted) return { ok: false, error: { code: "aborted", message: "aborted" } };
      envSources ??= ENV_FILES.map((name) => [name, readFileSync(join(ENV_DIR, name), "utf8")] as const);
      const sources = envSources;
      const bounded = new AbortController();
      let pending = "";
      let done: Wire<T> | undefined;
      let failure: Error | undefined;
      try {
        await runWalled(
          this.wall,
          `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 ${shellQuote(capturedExecPath)} --no-env-file worker.mjs`,
          {
            signal: AbortSignal.any([signal, bounded.signal]),
            timeout: extra.timeout,
            stage: (into) => {
              writeFileSync(join(into, "worker.mjs"), WORKER);
              for (const [name, source] of sources) writeFileSync(join(into, name), source);
              writeFileSync(
                join(into, "request"),
                capturedJsonStringify({ op, args, cwd: this.cwd, max: MAX_BYTES }),
              );
              if (extra.content !== undefined) writeFileSync(join(into, "content"), extra.content);
            },
            onData: (data) => {
              if (bounded.signal.aborted) return;
              pending += data.toString("utf8");
              try {
                for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n")) {
                  const frame = parseJsonAs<Frame<T>>(pending.slice(0, end));
                  pending = pending.slice(end + 1);
                  if ("done" in frame) done = frame.done;
                  else extra.onText?.(frame);
                }
                if (pending.length > MAX_BYTES * 2) {
                  throw new Error("A worker frame exceeds the transport bound");
                }
              } catch (error) {
                failure = asError(error);
                bounded.abort();
              }
            },
          },
        );
      } catch (error) {
        failure ??= asError(error);
      }
      if (done !== undefined && failure === undefined) return done;
      const cause = failure ?? new Error("The worker ended without a result");
      return { ok: false, error: { code: codeOf(cause, signal), message: cause.message } };
    });
  }

  private async file<T>(
    op: string,
    path: string,
    args: unknown[],
    context: Context,
    content?: string | Uint8Array,
  ): Promise<Result<T, FileError>> {
    const absolute = this.path(path);
    const result = await this.call<T>(op, [absolute, ...args], context, { content });
    return result.ok ? result : { ok: false, error: fileError(result.error, absolute) };
  }

  private async snapshot(
    path: string,
    noFollow: boolean | undefined,
    context: Context,
  ): Promise<Result<{ info: FileInfo; bytes: Buffer }, FileError>> {
    const result = await this.file<Snapshot>("snapshot", path, [{ noFollow }], context);
    return result.ok
      ? { ok: true, value: { info: result.value.info, bytes: Buffer.from(result.value.bytes, "base64") } }
      : result;
  }

  async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.signal(context).aborted
      ? { ok: false, error: new FileError("aborted", "aborted") }
      : { ok: true, value: this.path(path) };
  }

  async joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    return this.signal(context).aborted
      ? { ok: false, error: new FileError("aborted", "aborted") }
      : { ok: true, value: join(...parts) };
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const result = await this.snapshot(path, undefined, context);
    return result.ok ? { ok: true, value: result.value.bytes } : result;
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const result = await this.readBinaryFile(path, context);
    // As Node's `utf8`, which durable's own reads with: a byte order mark stays in the text.
    return result.ok
      ? { ok: true, value: new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.value) }
      : result;
  }

  async openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>> {
    const result = await this.snapshot(path, options?.noFollow, context);
    if (!result.ok) return result;
    const { info, bytes } = result.value;
    let closed = false;
    const failure = (ctx: Context): Result<never, FileError> | undefined =>
      closed
        ? { ok: false, error: new FileError("invalid", "Reader is closed", path) }
        : this.signal(ctx).aborted
          ? { ok: false, error: new FileError("aborted", "aborted", path) }
          : undefined;
    return {
      ok: true,
      value: {
        info: async (ctx) => failure(ctx) ?? { ok: true, value: info },
        read: async (offset, length, ctx) =>
          failure(ctx) ??
          (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
            ? { ok: false, error: new FileError("invalid", "Invalid offset or length", path) }
            : { ok: true, value: Uint8Array.from(bytes.subarray(offset, offset + length)) }),
        scanLines: async (range, ctx) => {
          const refused = failure(ctx);
          if (refused !== undefined) return refused;
          try {
            const scanner = new LineScanner(range.startLine, range.endLine);
            scanner.push(bytes);
            return { ok: true, value: scanner.finish() };
          } catch (cause) {
            return { ok: false, error: new FileError("invalid", "Invalid line range", path, asError(cause)) };
          }
        },
        close: async () => {
          closed = true;
        },
      },
    };
  }

  async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    const result = await this.file<TextLine[]>("lines", path, [], context);
    if (!result.ok) return result;
    const lines = result.value;
    let index = 0;
    let closed = false;
    return {
      ok: true,
      value: {
        readLine: async (ctx) => {
          if (this.signal(ctx).aborted) {
            return { ok: false, error: new FileError("aborted", "aborted", path) };
          }
          if (closed) return { ok: false, error: new FileError("invalid", "Reader is closed", path) };
          return { ok: true, value: lines[index++] };
        },
        close: async () => {
          closed = true;
        },
      },
    };
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    return await this.file("readTextLines", path, [options ?? {}], context);
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return await this.file("writeFile", path, [], context, content);
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return await this.file("appendFile", path, [], context, content);
  }

  async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    return await this.file("truncateFile", path, [size], context);
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    return await this.file("flushFile", path, [], context);
  }

  async renameFile(
    sourcePath: string,
    destinationPath: string,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return await this.file("renameFile", sourcePath, [this.path(destinationPath)], context);
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return await this.file("fileInfo", path, [], context);
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return await this.file("listDir", path, [], context);
  }

  async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    const listed = await this.listDir(path, context);
    if (!listed.ok) return listed;
    const names = listed.value.map((entry) => entry.name);
    let index = 0;
    let closed = false;
    return {
      ok: true,
      value: {
        next: async (maxEntries, ctx) => {
          if (this.signal(ctx).aborted) {
            return { ok: false, error: new FileError("aborted", "aborted", path) };
          }
          if (closed || !Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
            return { ok: false, error: new FileError("invalid", "Closed reader or invalid page size", path) };
          }
          if (index >= names.length) return { ok: true, value: { entries: [], done: true } };
          // An entry removed since the reader opened is no longer part of the listing.
          const now = await this.listDir(path, ctx);
          if (!now.ok) return now;
          const present = new Map(now.value.map((entry) => [entry.name, entry]));
          const entries: FileInfo[] = [];
          for (; index < names.length && entries.length < maxEntries; index++) {
            const entry = present.get(names[index] ?? "");
            if (entry !== undefined) entries.push(entry);
          }
          return { ok: true, value: { entries, done: index >= names.length } };
        },
        close: async () => {
          closed = true;
        },
      },
    };
  }

  async watch(): ReturnType<ExecutionEnv["watch"]> {
    return { ok: false, error: new FileError("not_supported", "The command wall has no persistent watcher") };
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return await this.file("canonicalPath", path, [], context);
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    return await this.file("exists", path, [], context);
  }

  async createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return await this.file("createDir", path, [options ?? {}], context);
  }

  async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return await this.file("remove", path, [options ?? {}], context);
  }

  /** A temporary path in the seat's `TMPDIR`, which durable's environment takes for `tmpdir()`. */
  private async temp(op: string, args: unknown[], context: Context): Promise<Result<string, FileError>> {
    const result = await this.call<string>(op, args, context);
    return result.ok ? result : { ok: false, error: fileError(result.error) };
  }

  async createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>> {
    return await this.temp("createTempDir", prefix === undefined ? [] : [prefix], context);
  }

  async createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    return await this.temp("createTempFile", [options ?? {}], context);
  }

  /**
   * A command held to the timeout it names, or the wall's default, at most the wall's maximum and
   * cut near the solve's end (`heldSeconds`). Durable's own timer in the worker ends it there, so a
   * timeout still reports the output it spilled, and runWalled's bound a second later is the
   * backstop. The bash tool raises a shorter request to the default before it gets here.
   */
  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const { onOutput, ...rest } = options ?? {};
    const asked = Math.min(
      rest.timeout ?? this.wall.limits.shellDefaultSeconds,
      this.wall.limits.shellMaxSeconds,
    );
    const timeout = Math.min(asked, heldSeconds(asked, this.wall).seconds);
    let callbackError: Error | undefined;
    const outer = new AbortController();
    const result = await this.call<ShellExecResult>(
      "exec",
      [
        isString(command) ? command : [...command],
        { ...rest, cwd: this.path(rest.cwd ?? this.cwd), timeout },
      ],
      { ...context, abortSignal: AbortSignal.any([this.signal(context), outer.signal]) },
      {
        timeout: timeout + 1,
        onText: ({ text, ...info }) => {
          if (callbackError !== undefined) return;
          try {
            onOutput?.(text, context, info);
          } catch (error) {
            callbackError = asError(error);
            outer.abort();
          }
        },
      },
    );
    if (callbackError !== undefined) {
      return { ok: false, error: new ExecutionError("callback_error", callbackError.message, callbackError) };
    }
    if (result.ok) return result;
    const code = EXEC_CODES.find((known) => known === result.error.code) ?? "unknown";
    const failure = new ExecutionError(code, result.error.message);
    if (result.error.spillPath !== undefined) failure.spillPath = result.error.spillPath;
    return { ok: false, error: failure };
  }

  async cleanup(): Promise<void> {
    this.lifetime.abort();
    await QUEUES.get(this.wall);
  }
}

/** A failure outside durable's own result: the wall's bound, an abort, or a broken worker. */
function codeOf(cause: Error, signal: AbortSignal): "aborted" | "timeout" | "unknown" {
  if (signal.aborted) return "aborted";
  return cause.message.startsWith("timeout:") ? "timeout" : "unknown";
}

/** A file operation's failure as durable names it; any other code, such as the wall's timeout, is `unknown`. */
function fileError(error: { code: string; message: string }, path?: string): FileError {
  return new FileError(FILE_CODES.find((known) => known === error.code) ?? "unknown", error.message, path);
}
