/**
 * The Builder toolkit: seven file and shell capabilities using one candidate access policy.
 * This file defines tool behaviour — schemas, truncation, diffs and edit normalisation — while
 * policy has one owner (candidate-isolation.ts) and execution one (candidate-isolation-runtime.ts):
 * guardPath decides, the OS-isolated child enforces, and the path record captures both, so a
 * disagreement between guard and operating system is observable rather than resolved inside a tool.
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
import { moreRowsNote } from "./read-window.ts";
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
import { GREP_MAX_LINE_LENGTH, truncateHead, truncateTail } from "./pi-coding/truncate.ts";
import { cutOutputNotice, spillWholeOutput, stageAndCopy } from "./tool-write.ts";
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

/** The isolation a toolkit is composed against: one policy value, one record writer, the candidate's
 *  working directory — the composer holds the binding, so the toolkit never re-derives it from rule
 *  positions — and the run whose campaign directory records a safeguard when this shell's guard
 *  gives no answer. */
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
  /** Single-target reads leave osRefusalIsOutcome unset, since a refused guard-allowed target is an
   *  isolation defect; traversal sets it, since a profile refusing files the guard never vouched for
   *  inside an allowed root is isolation bounding recursion. Children run with cwd inside the read
   *  enumeration: a deny-read cwd kills a child that calls getcwd at startup, as rg does. */
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
  /** Traversal children (rg, ls) exit non-zero when the profile refuses files inside an allowed root
   *  — "Operation not permitted" under Seatbelt, "Permission denied" under a read-only bind — and
   *  that is the isolation working. A real tool error is empty output with a non-refusal stderr. */
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
  /** Post-hoc output guard for search capabilities: every returned path is re-decided, an allowed
   *  row passes and a denied row is dropped with its own record row. Content rows from a denied path
   *  cannot occur, since the OS profile already bounded the child, so a grep hit on a denied path is
   *  a derivation disagreement and throws rather than being quietly dropped. */
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
        // `--with-filename --null` keeps the path on every row, NUL-separated: rg drops it for a
        // single-file target and a context row reads `12-text`, so the guard read `12` as a path
        // (29 sessions, 09-09 to 09-13).
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
        // `--regexp` binds the pattern as a value: a positional pattern beginning `-o` reads as a flag.
        args.push("--regexp", params.pattern, target);
        let outcome = await isolatedRead("grep", "rg", args, target, true);
        // A pattern rg cannot parse — an unbalanced `exit(12`, say — is searched as literal text.
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
        const more = moreRowsNote(guarded.length, kept.length, "row", "rows");
        const found = kept.length > 0 ? `${kept.join("\n")}${more}` : "No matches";
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
        const allowed = guardReturnedPaths("find", rows, (row) => row, "drop");
        const kept = allowed.slice(0, limit);
        const more = moreRowsNote(allowed.length, kept.length, "file", "files");
        const listed =
          kept.length > 0 ? `${kept.map(rel).join("\n")}${more}` : "No files found matching pattern";
        return result(listed, { count: kept.length, limit });
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
        const notice = moreRowsNote(kept.length, rows.length, "entry", "entries");
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
        // The Builder's shell on every backend: destructive forms stop here, the OS policy enforces files.
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
        // A call that outran the solver's own per-command budget says so, whatever its exit was;
        // the wall itself stays BASH_TIMEOUT_MAX_MS, since searching a domain is not solving a task.
        const budget = workspaceSolverBudgetNotice(workDir, Date.now() - startedMs);
        const body = `${tail.content}${tail.truncated ? `\n\n${cutOutputNotice(whole, tail, spilled, "read it with offset and limit")}` : ""}${budget === null ? "" : `\n\n${budget}`}`;
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
