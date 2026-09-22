/**
 * The Builder toolkit: seven file and shell tools under one candidate access policy. This file
 * owns tool behaviour (schemas, truncation, diffs, edit normalisation); candidate-isolation.ts
 * owns the policy and candidate-isolation-runtime.ts its execution.
 */
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";
import { isAbsolute, join, relative, resolve as resolvePath } from "../meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createPatch } from "diff";
import {
  bashDescription,
  bashEnv,
  bashKilledNotice,
  bashTimeoutMs,
  workspaceSolverBudgetNotice,
} from "./bash-install-env.ts";
import { type PathRecord, runIsolated } from "./candidate-isolation-runtime.ts";
import { type CandidateAccessPolicy, guardPath } from "./candidate-isolation.ts";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./pi-coding/edit-core.ts";
import { refuseDestructiveCommand } from "./command-guard.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
export { BUILDER_CAPABILITY_MODES } from "./capability-modes.ts";
import { withFileMutationQueue } from "./pi-coding/file-mutation-queue.ts";
import { GREP_MAX_LINE_LENGTH, formatSize, truncateHead, truncateTail } from "./pi-coding/truncate.ts";
import { spillWholeOutput, stageAndCopy } from "./tool-write.ts";
import { keyIfTruthy, keysIf } from "../meta/optional-key.ts";

type ToolResultDetails =
  | { path: string; truncation: ReturnType<typeof truncateHead> }
  | { matches: number; limit: number }
  | { count: number; limit: number }
  | { count: number; total: number }
  | { exitCode: number | null; truncation: ReturnType<typeof truncateTail> }
  | { diff: string }
  | { path: string };
type TextResult = { content: Array<{ type: "text"; text: string }>; details?: ToolResultDetails };

/** The isolation a toolkit runs under: the policy, the path record, the candidate's working
 *  directory, and the run a guard safeguard is recorded against. */
export interface BuilderIsolation {
  policy: CandidateAccessPolicy;
  record: PathRecord;
  workDir: string;
  safeguardContext?: SafeguardContext;
}

/** The JSON Schema of a tool's argument object. */
interface ToolArgumentSchema extends JsonObject {
  type: "object";
  additionalProperties: false;
  properties: JsonObject;
  required: string[];
}

function schema(properties: JsonObject, required: string[] = []): ToolArgumentSchema {
  return { type: "object", additionalProperties: false, properties, required };
}

function result(value: string, details?: ToolResultDetails): TextResult {
  return { content: [{ type: "text", text: value }], ...keyIfTruthy("details", details) };
}

function makeTool<P extends Record<string, JsonValue>>(
  spec: Omit<AgentTool, "execute"> & {
    execute: (toolCallId: string, params: P, signal?: AbortSignal) => Promise<TextResult> | TextResult;
  },
): AgentTool {
  return /* SAFETY: the same spec object, widened from its typed `execute` to the roster's entry type. */ spec as AgentTool;
}

export function createBuilderTools(isolation: BuilderIsolation): AgentTool[] {
  const { policy, record, workDir } = isolation;
  const abs = (requested: string) => (isAbsolute(requested) ? requested : resolvePath(workDir, requested));
  const rel = (path: string) => relative(workDir, path);
  const pathCard = " Relative and omitted paths start at the workspace root.";
  /** A read in the workspace cwd (a denied cwd kills children such as rg that call getcwd).
   *  Traversals treat OS refusals below an allowed root as outcomes; a single target does not. */
  const isolatedRead = (
    capability: string,
    command: string,
    args: string[],
    target: string,
    traversal = false,
  ) =>
    runIsolated(policy, record, {
      capability,
      mode: "read",
      command,
      args,
      cwd: workDir,
      paths: [target],
      ...keysIf(traversal, () => ({ osRefusalIsOutcome: true })),
    });
  /** Throws on a real traversal error: empty output with a stderr that is not an OS refusal.
   *  Refusals inside an allowed root are the isolation working. */
  const throwIfTraversalError = (
    name: string,
    outcome: { status: number | null; stdout: string; stderr: string },
  ) => {
    if (
      outcome.status !== 0 &&
      outcome.status !== 1 &&
      outcome.stdout === "" &&
      !/operation not permitted|permission denied|sandbox/i.test(outcome.stderr)
    ) {
      throw new Error(outcome.stderr.trim() || `${name} exited ${outcome.status}`);
    }
  };
  /** Re-decides every returned path: denied rows are recorded and dropped, or, for content that
   *  the OS should already have hidden, throw as a guard/OS disagreement. */
  const guardReturnedPaths = (
    capability: string,
    rows: string[],
    pathOf: (row: string) => string,
    onDeniedContent: "drop" | "throw",
  ): string[] => {
    const kept: string[] = [];
    const decided = new Map<string, boolean>();
    for (const row of rows) {
      const target = pathOf(row);
      let allowed = decided.get(target);
      if (allowed === undefined) {
        const decision = guardPath(policy, capability, "read", target);
        allowed = decision.decision === "allow";
        if (!allowed) {
          record.append({
            capability,
            mode: "read",
            policyDigest: policy.digest,
            profileDigest: null,
            requested: target,
            resolved: decision.resolved,
            decision: "deny",
            reason: decision.reason,
            enforcement: "guard-denied",
            bytes: null,
          });
          if (onDeniedContent === "throw") {
            throw new Error(
              `derivation disagreement: ${capability} returned content from a path the guard denies (${rel(target)})`,
            );
          }
        }
        decided.set(target, allowed);
      }
      if (allowed) kept.push(row);
    }
    return kept;
  };
  return [
    makeTool({
      name: "read",
      label: "read",
      description: `Read a UTF-8 file. Use offset and limit to read part of it. Long output tells you where to continue.${pathCard}`,
      parameters: schema(
        { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
        ["path"],
      ),
      async execute(_id, params: { path: string; offset?: number; limit?: number }) {
        const target = abs(params.path);
        const outcome = await isolatedRead("read", "/bin/cat", [target], target);
        if (outcome.status !== 0) throw new Error(outcome.stderr.trim() || `read exited ${outcome.status}`);
        const lines = outcome.stdout.split("\n");
        const start = Math.max(0, (params.offset ?? 1) - 1);
        if (start >= lines.length) {
          throw new Error(
            `Offset ${params.offset} is beyond end of file (${lines.length} line${lines.length === 1 ? "" : "s"} total)`,
          );
        }
        const limit = params.limit ?? 0;
        const selected = lines.slice(start, limit > 0 ? start + limit : undefined).join("\n");
        const truncation = truncateHead(selected);
        const end = start + truncation.outputLines;
        const notice =
          truncation.truncated || end < lines.length
            ? `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`
            : "";
        return result(`${truncation.content}${notice}`, { path: rel(target), truncation });
      },
    }),
    makeTool({
      name: "grep",
      label: "grep",
      description: `Search workspace files with ripgrep. Returns path:line:text rows up to the limit.${pathCard}`,
      parameters: schema(
        {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
          ignoreCase: { type: "boolean" },
          literal: { type: "boolean" },
          context: { type: "number" },
          limit: { type: "number" },
        },
        ["pattern"],
      ),
      async execute(
        _id,
        params: {
          pattern: string;
          path?: string;
          glob?: string;
          ignoreCase?: boolean;
          literal?: boolean;
          context?: number;
          limit?: number;
        },
      ) {
        const target = abs(params.path ?? ".");
        // `--with-filename --null` keeps a NUL-terminated path on every row, including single-file
        // targets and context rows, so the guard always reads a real path.
        const args = [
          "--line-number",
          "--color=never",
          "--hidden",
          "--no-heading",
          "--with-filename",
          "--null",
        ];
        if (params.ignoreCase === true) args.push("--ignore-case");
        if (params.literal === true) args.push("--fixed-strings");
        if ((params.context ?? 0) > 0) args.push("--context", String(params.context));
        if (params.glob !== undefined && params.glob !== "") args.push("--glob", params.glob);
        // `--regexp` binds the pattern as a value, so a pattern starting with `-` is not a flag.
        args.push("--regexp", params.pattern, target);
        let outcome = await isolatedRead("grep", "rg", args, target, true);
        // A pattern rg cannot parse is searched as literal text, and the result says so.
        const asText = params.literal !== true && outcome.stderr.includes("regex parse error");
        if (asText) outcome = await isolatedRead("grep", "rg", ["--fixed-strings", ...args], target, true);
        throwIfTraversalError("grep", outcome);
        const limit = Math.max(1, params.limit ?? 100);
        const rows = outcome.stdout.split("\n").filter((line) => line !== "" && line !== "--");
        const pathOf = (row: string) => row.slice(0, row.indexOf("\0"));
        const guarded = guardReturnedPaths("grep", rows, pathOf, "throw");
        const kept = guarded.slice(0, limit).map((row) => {
          const line = `${rel(pathOf(row))}${row.slice(row.indexOf("\0")).replace("\0", ":")}`;
          return line.length > GREP_MAX_LINE_LENGTH ? `${line.slice(0, GREP_MAX_LINE_LENGTH)}...` : line;
        });
        const found = kept.length > 0 ? kept.join("\n") : "No matches";
        const text = asText ? `[Not a regular expression; searched as literal text.]\n${found}` : found;
        return result(text, { matches: guarded.length, limit });
      },
    }),
    makeTool({
      name: "find",
      label: "find",
      description: `Find workspace files with a glob.${pathCard}`,
      parameters: schema(
        { pattern: { type: "string" }, path: { type: "string" }, limit: { type: "number" } },
        ["pattern"],
      ),
      async execute(_id, params: { pattern: string; path?: string; limit?: number }) {
        const target = abs(params.path ?? ".");
        const args = ["--files", "--hidden", "-g", params.pattern, target];
        const outcome = await isolatedRead("find", "rg", args, target, true);
        throwIfTraversalError("find", outcome);
        const limit = Math.max(1, params.limit ?? 1000);
        const rows = outcome.stdout.split("\n").filter((line) => line !== "");
        const kept = guardReturnedPaths("find", rows, (row) => row, "drop").slice(0, limit);
        return result(kept.length > 0 ? kept.map(rel).join("\n") : "No files found matching pattern", {
          count: kept.length,
          limit,
        });
      },
    }),
    makeTool({
      name: "ls",
      label: "ls",
      description: `List a workspace directory. Directory names end with a slash.${pathCard}`,
      parameters: schema({ path: { type: "string" }, limit: { type: "number" } }),
      async execute(_id, params: { path?: string; limit?: number }) {
        const target = abs(params.path ?? ".");
        const outcome = await isolatedRead("ls", "/bin/ls", ["-1Ap", target], target, true);
        if (outcome.status !== 0 && outcome.stdout === "") {
          throw new Error(outcome.stderr.trim() || `ls exited ${outcome.status}`);
        }
        const limit = params.limit ?? 500;
        const entries = outcome.stdout.split("\n").filter((line) => line !== "");
        const kept = guardReturnedPaths(
          "ls",
          entries,
          (entry) => join(target, entry.replace(/\/$/, "")),
          "drop",
        );
        const rows = kept.slice(0, limit);
        const notice =
          kept.length > rows.length
            ? `\n\n[${kept.length - rows.length} more entries. Use a larger limit.]`
            : "";
        return result(`${rows.length > 0 ? rows.join("\n") : "(empty directory)"}${notice}`, {
          count: rows.length,
          total: kept.length,
        });
      },
    }),
    makeTool({
      name: "bash",
      label: "bash",
      description: bashDescription(policy, pathCard),
      parameters: schema(
        { command: { type: "string" }, cwd: { type: "string" }, timeout: { type: "number" } },
        ["command"],
      ),
      async execute(_id, params: { command: string; cwd?: string; timeout?: number }, signal) {
        const cwd = params.cwd === undefined || params.cwd === "" ? workDir : abs(params.cwd);
        // Destructive command shapes stop here; the OS policy enforces file access.
        const refusal = refuseDestructiveCommand(params.command, Bun.env, isolation.safeguardContext);
        if (refusal !== null) throw new Error(refusal);
        const timeoutMs = bashTimeoutMs(params.timeout);
        const startedMs = Date.now();
        const outcome = await runIsolated(policy, record, {
          capability: "bash",
          mode: "exec",
          command: "/bin/sh",
          args: ["-lc", params.command],
          cwd,
          paths: [cwd],
          env: bashEnv(workDir),
          osRefusalIsOutcome: true,
          timeoutMs,
          signal, // An aborted prompt waits for running tools, so abort kills the command.
        });
        const whole = `${outcome.stdout}${outcome.stderr}` || "(no output)";
        const tail = truncateTail(whole);
        const spilled = tail.truncated ? await spillWholeOutput(isolation, whole) : null;
        // A call that outran the solver's per-command budget says so, whatever its exit; the
        // wall itself stays BASH_TIMEOUT_MAX_MS.
        const budget = workspaceSolverBudgetNotice(workDir, Date.now() - startedMs);
        const body = `${tail.content}${spilled === null ? "" : `\n\n[Output truncated: showing the tail of ${formatSize(tail.totalBytes)}. The whole output is at ${spilled}; read it with offset and limit.]`}${budget === null ? "" : `\n\n${budget}`}`;
        if (outcome.timedOut) throw new Error(`${body}\n\n${bashKilledNotice(timeoutMs)}`);
        if (outcome.status !== null && outcome.status !== 0) {
          throw new Error(`${body}\n\nCommand exited with code ${outcome.status}`);
        }
        return result(body, { exitCode: outcome.status, truncation: tail });
      },
    }),
    makeTool({
      name: "edit",
      label: "edit",
      description: `Edit one file by replacing exact text. Each oldText value must appear once in the file.${pathCard}`,
      parameters: schema(
        {
          path: { type: "string" },
          edits: {
            type: "array",
            items: schema({ oldText: { type: "string" }, newText: { type: "string" } }, [
              "oldText",
              "newText",
            ]),
          },
        },
        ["path"],
      ),
      async execute(_id, params: { path: string; edits?: Array<{ oldText: string; newText: string }> }) {
        const target = abs(params.path);
        const edits = params.edits ?? [];
        if (edits.length === 0) throw new Error("edits must contain at least one replacement");
        return withFileMutationQueue(target, async () => {
          const current = await runIsolated(policy, record, {
            capability: "edit",
            mode: "write",
            command: "/bin/cat",
            args: [target],
            cwd: workDir,
            paths: [target],
          });
          if (current.status !== 0) {
            throw new Error(current.stderr.trim() || `edit read exited ${current.status}`);
          }
          const { bom, text: withoutBom } = stripBom(current.stdout);
          const lineEnding = detectLineEnding(withoutBom);
          const normalized = normalizeToLF(withoutBom);
          const { baseContent, newContent } = applyEditsToNormalizedContent(normalized, edits, params.path);
          await stageAndCopy(isolation, "edit", target, bom + restoreLineEndings(newContent, lineEnding));
          const diff = createPatch(params.path, baseContent, newContent, "before", "after");
          return result(`Replaced ${edits.length} block(s) in ${params.path}.`, { diff });
        });
      },
    }),
    makeTool({
      name: "write",
      label: "write",
      description: `Write a UTF-8 file. Missing parent folders are created. Use edit to change part of an existing file.${pathCard}`,
      parameters: schema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
      async execute(_id, params: { path: string; content: string }) {
        const target = abs(params.path);
        return withFileMutationQueue(target, async () => {
          await stageAndCopy(isolation, "write", target, params.content);
          return result(`wrote ${rel(target)} (${params.content.length} bytes)`, { path: rel(target) });
        });
      },
    }),
  ];
}
