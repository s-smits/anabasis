/** Private epoch-review inputs: core files first, plus only receipt-bound verifier entry points. */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "../meta/filesystem.ts";
import { isAbsolute, join, relative, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { sha256 } from "../meta/digest.ts";
import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { type JsonValue, isString } from "../meta/json-shape.ts";
import { BUILDER_OWNED, ownerWritableFiles, routableOwner } from "../author/feedback-routing.ts";
import { readRecordedBatteryRecord } from "../truth/battery-record.ts";
import { verifierEnvironmentHashOfTools } from "../truth/verifier-environment.ts";
import { TOOL_ID_RE } from "../verify/tool-inventory.ts";
import type { ToolEntry, VerifierExecutionEvidence } from "../verify/verifier-port.ts";
import { type ReaderTool, readerParameters, readerToolText } from "./review-reader.ts";
import { errorMessage } from "../meta/runtime-values.ts";

// Coverage counts host-returned text, not proof of model consumption.
const READ_CHARS_TOTAL = 4_000_000;
// Native Claude answers a 60,000-character page with an oversized-result error, so the page has to
// be small enough that the transport delivers it at all.
const READ_CHARS_PER_CALL = 16_000;
const INVENTORY_MAX_FILES = 400;
const SKIP_DIRS = new Set(["node_modules", ".git", ".toolchain", "runs", "scratch", "dist"]);
const CORE_FILES = [...BUILDER_OWNED].filter(routableOwner).flatMap(ownerWritableFiles);
export interface ReviewInventory {
  files: string[];
  truncated: boolean;
  missing: string[];
}

export type ReviewVerifierEvidence = {
  /** Null means no trusted execution identity; a known no-tool run has a non-null identity. */
  identity: string | null;
  tools: Record<string, Pick<ToolEntry, keyof ToolEntry>>;
  unavailable: string | null;
};

/** The bytes behind one path or verifier alias, and the pages of them read_source returned. */
interface DeliveredSource {
  path: string;
  digest: string;
  length: number;
  pages: Array<{ start: number; text: string }>;
}

/** Pages arrive in order from offset 0 and stay separate, so a quote cannot bridge an unread gap. A
 *  refusal changes nothing. Changed bytes start a new record; the old one certifies nothing. `reads`
 *  is the delivery log recorded as evidence. */
export interface SourceReadState {
  reads: string[];
  readChars: number;
  refused: number;
  delivered: DeliveredSource[];
}

const isDigest = (value: unknown): value is string => isString(value) && /^[0-9a-f]{64}$/.test(value);

/** The files a review may read: the core contract first, then the rest of the tree. The order is
 *  the rule -- a cap must never crowd the core contract out of a review, nor silently reduce the
 *  denominator the review reports against -- and the core contract is a handful of fixed paths
 *  well under the cap, so only the walk can meet it. A cap that refuses any path marks the whole
 *  inventory truncated so the review states the limit instead of reading past it. */
export function reviewInventory(root: string): ReviewInventory {
  const files = new Set<string>();
  const missing: string[] = [];
  /** False once the cap refuses a path. The walk below stops on that return value rather than
   *  read a flag afterwards, so there is one place the cap can be observed. */
  const add = (path: string): boolean => {
    if (files.has(path)) return true;
    if (files.size >= INVENTORY_MAX_FILES) return false;
    files.add(path);
    return true;
  };
  for (const path of CORE_FILES) {
    try {
      if (lstatSync(join(root, path)).isFile()) {
        add(path);
      } else {
        missing.push(path);
      }
    } catch {
      missing.push(path);
    }
  }
  /** False once a descendant met the cap, which unwinds the recursion to the first caller. */
  const walk = (dir: string): boolean => {
    if (!existsSync(dir)) return true;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort(compareCodeUnits);
    } catch {
      missing.push(relative(root, dir) || ".");
      return true;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const abs = join(dir, entry);
      try {
        const stat = lstatSync(abs);
        if (stat.isDirectory()) {
          if (!walk(abs)) return false;
        } else if (stat.isFile() && !add(relative(root, abs))) return false;
      } catch {
        missing.push(relative(root, abs));
      }
    }
    return true;
  };
  // Walked before `files` is spread, since an object literal evaluates its properties in order.
  const truncated = !walk(root);
  return { files: [...files], truncated, missing };
}

/** Only complete installed-tool provenance can grant a source read. */
function recordedTool(id: string, value: JsonValue): Omit<ToolEntry, "id" | "path"> {
  const tool = plainRecord(value);
  if (
    !TOOL_ID_RE.test(id) ||
    !isDigest(tool?.digest) ||
    (tool.source !== "host" && tool.source !== "workspace-toolchain") ||
    (tool.kind !== "script" && tool.kind !== "binary") ||
    (tool.interpreter !== null && !isString(tool.interpreter))
  ) {
    throw new Error(`recorded verifier tool ${id} has incomplete provenance`);
  }
  return { digest: tool.digest, source: tool.source, kind: tool.kind, interpreter: tool.interpreter };
}

function boundCommand(
  id: string,
  tool: Omit<ToolEntry, "id" | "path">,
  row: VerifierExecutionEvidence,
): string {
  if (
    !isString(row.command) ||
    !isAbsolute(row.command) ||
    row.toolDigest !== tool.digest ||
    row.toolSource !== tool.source ||
    row.toolKind !== tool.kind
  ) {
    throw new Error(`recorded verifier tool ${id} disagrees with its execution receipt`);
  }
  return row.command;
}

/** The alias-keyed entry points the recorded receipts grant. The binding is required in both
 *  directions: a declared tool without an executed receipt agreeing with its provenance grants
 *  nothing, and an executed receipt the tool summary does not declare refuses the whole evidence,
 *  because a review may read only what a receipt binds. */
function verifierSources(tools: Record<string, JsonValue>, evidence: readonly VerifierExecutionEvidence[]) {
  const sources: Record<string, ToolEntry> = {};
  for (const [id, value] of Object.entries(tools).sort(([a], [b]) => compareCodeUnits(a, b))) {
    const tool = recordedTool(id, value);
    const receipts = evidence.filter((row) => row?.outcome === "executed" && row.toolId === id);
    if (receipts.length === 0) throw new Error(`recorded verifier tool ${id} has no bound execution`);
    for (const row of receipts) {
      const command = boundCommand(id, tool, row);
      const alias = `verifier:${id}:${hashJsonValue({ path: command, digest: tool.digest }).slice(0, 16)}`;
      sources[alias] = {
        id,
        path: command,
        digest: tool.digest,
        source: tool.source,
        kind: tool.kind,
        interpreter: tool.interpreter,
      };
    }
  }
  const undeclared = evidence.find(
    (row) => row?.outcome === "executed" && row.toolSource !== "cell" && !Object.hasOwn(tools, row.toolId),
  );
  if (undeclared !== undefined) throw new Error("executed verifier receipt is missing from the tool summary");
  return sources;
}

/** Recorded receipts, never today's PATH or an authored tool list, grant these exact file reads. */
export function reviewVerifierEvidence(root: string, runId: string): ReviewVerifierEvidence {
  try {
    const battery = readRecordedBatteryRecord(join(root, "runs", runId), runId);
    const execution = plainRecord(battery.execution);
    const tools = plainRecord(execution?.tools);
    const environmentHash = execution?.verifierEnvironmentHash;
    if (
      tools === null ||
      (environmentHash !== null && !isDigest(environmentHash)) ||
      !Array.isArray(battery.executionEvidence) ||
      !Array.isArray(execution?.executed)
    ) {
      throw new Error("recorded verifier execution identity or receipts are missing");
    }
    const sources = verifierSources(tools, battery.executionEvidence);
    if (environmentHash !== verifierEnvironmentHashOfTools(battery.execution.tools)) {
      throw new Error("recorded verifier environment digest disagrees with its tools");
    }
    if (Object.keys(sources).length > INVENTORY_MAX_FILES) {
      throw new Error("recorded verifier inventory exceeds the review limit");
    }
    return { identity: hashJsonValue({ environmentHash, sources }), tools: sources, unavailable: null };
  } catch (error) {
    return {
      identity: null,
      tools: {},
      unavailable: `Verifier evidence unavailable: ${errorMessage(error)}`.slice(0, 400),
    };
  }
}

export function deliveredSource(state: SourceReadState, path: string) {
  const record = state.delivered.findLast((entry) => entry.path === path);
  return {
    record,
    complete: record?.pages.some((page) => page.start + page.text.length === record.length) ?? false,
  };
}

function sourceText(root: string, path: string, tools: Readonly<Record<string, ToolEntry>>): string {
  const tool = Object.hasOwn(tools, path) ? tools[path] : undefined;
  if (tool !== undefined) {
    // Check the bytes that will actually be returned, including after a symlink or file swap.
    if (!statSync(tool.path).isFile()) throw new Error("recorded verifier entry point is not a regular file");
    const bytes = readFileSync(tool.path);
    if (sha256(bytes) !== tool.digest) throw new Error("recorded verifier executable bytes changed");
    const provenance = `Recorded verifier ${tool.id}: ${tool.source}, ${tool.kind}, sha256 ${tool.digest}, interpreter ${tool.interpreter ?? "none"}.`;
    return tool.kind === "binary"
      ? `${provenance}\nBinary entry point: source is unavailable through this reader. Identity is not proof of an independent domain algorithm.`
      : `${provenance}\nEntry-point source only; imported dependencies are not covered by this read.\n\n${new TextDecoder("utf-8", { fatal: true }).decode(bytes)}`;
  }
  const abs = resolve(join(root, path));
  if (isAbsolute(path) || !containsPath(abs, resolve(root))) {
    throw new Error("path escapes the measured tree");
  }
  const canonical = realpathSync(abs);
  if (!containsPath(canonical, realpathSync(root))) throw new Error("path escapes the measured tree");
  if (!statSync(canonical).isFile()) throw new Error("path is not a regular file");
  return readFileSync(canonical, "utf8");
}

/** The next page of `whole` from `offset`, recorded on `record`, with its continuation note. */
function deliver(state: SourceReadState, record: DeliveredSource, whole: string, offset: number): string {
  let text = whole.slice(offset, offset + Math.min(READ_CHARS_PER_CALL, READ_CHARS_TOTAL - state.readChars));
  if (text.length > 1 && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  record.pages.push({ start: offset, text });
  state.reads.push(record.path);
  state.readChars += text.length;
  const remaining = whole.length - offset - text.length;
  return remaining === 0
    ? text
    : `${text}\n\n(${remaining} character${remaining === 1 ? " remains" : "s remain"}${state.readChars >= READ_CHARS_TOTAL ? ", but the review's read budget is spent" : "; call again to continue"}.)`;
}

/** `texts` holds entries whose bytes the controller already has in hand rather than on disk, such as
 *  what a rehearsal's solver submitted; each is read under its name like any other entry. */
export function readSourceTool(
  root: string,
  inventory: ReadonlySet<string>,
  state: SourceReadState,
  tools: Readonly<Record<string, ToolEntry>>,
  texts: ReadonlyMap<string, string>,
): ReaderTool {
  const reply = (text: string) => Promise.resolve(readerToolText(text));
  const refuse = (why: string) => {
    state.refused += 1;
    return reply(`refused: ${why}`);
  };
  /**
   * One entry's next page, or why it gave none. `unreadable` separates an entry that yields no
   * bytes at all -- outside the tree, not a regular file, a recorded verifier tool whose bytes or
   * path moved, source that is not UTF-8 -- from one whose pages were merely invalidated by a
   * change and which the next call reads again from the start.
   *
   * The automatic scan walks past an unreadable entry and delivers the next one. It used to pick
   * the first incomplete entry blind, so one undeliverable entry refused every parameterless call
   * for the rest of the review: the reviewer spent its whole turn budget on that refusal and read
   * nothing at all.
   */
  const page = (
    path: string,
    reread: boolean,
    label: boolean,
  ): { text: string } | { why: string; unreadable: boolean } => {
    let whole: string;
    try {
      whole = texts.get(path) ?? sourceText(root, path, tools);
    } catch (error) {
      return { why: String(error), unreadable: true };
    }
    const digest = sha256(whole);
    let { record } = deliveredSource(state, path);
    if (record?.digest !== digest) {
      const stale = (record?.pages.length ?? 0) > 0;
      record = { path, digest, length: whole.length, pages: [] };
      state.delivered.push(record);
      if (stale) {
        return {
          why: `${path} changed since its pages were delivered; they no longer describe it, and the next call reads it from the start`,
          unreadable: false,
        };
      }
    }
    const last = reread ? undefined : record.pages.at(-1);
    const offset = last === undefined ? 0 : last.start + last.text.length;
    if (last !== undefined && offset === whole.length) {
      return {
        text: `${path} is already completely delivered (${whole.length} character${whole.length === 1 ? "" : "s"}). Pass reread: true beside the path to read it again from the start.`,
      };
    }
    return { text: (label ? `${path} (offset ${offset}):\n\n` : "") + deliver(state, record, whole, offset) };
  };
  return {
    name: "read_source",
    label: "Read measured source or a recorded verifier entry point",
    description: `Read measured source at most ${READ_CHARS_PER_CALL} characters per call, within a total budget of ${READ_CHARS_TOTAL}. Verifier scripts are checked against their recorded digest; binaries return provenance only.`,
    parameters: readerParameters({
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description:
            "A path or verifier alias exactly as the inventory lists it; omit to read the next unread page. Each call continues the path, and a completely delivered file returns a note.",
        },
        reread: {
          type: "boolean",
          description: "true beside path: read that file again from its first page.",
        },
      },
    }),
    execute: (_id: string, { path: named, reread, ...rest }: Record<string, JsonValue>) => {
      if (
        Object.keys(rest).length > 0 ||
        (reread !== undefined && (named === undefined || reread !== true))
      ) {
        return refuse(
          "only path and reread: true beside it are accepted; omit both to read the next unread page",
        );
      }
      if (named !== undefined) {
        if (!isString(named)) return refuse("path names an inventory entry, as a string");
        if (!inventory.has(named)) return refuse(`${named} is not in the inventory`);
        if (state.readChars >= READ_CHARS_TOTAL) return refuse("the review's read budget is spent");
        const read = page(named, reread === true, false);
        return "why" in read ? refuse(read.why) : reply(read.text);
      }
      const candidates = [...inventory].filter((entry) => !deliveredSource(state, entry).complete);
      if (candidates.length === 0) {
        return reply(
          "No unread source remains in the offered inventory. Weigh the evidence and finish your synthesis; inventory limits still apply.",
        );
      }
      if (state.readChars >= READ_CHARS_TOTAL) return refuse("the review's read budget is spent");
      const skipped: string[] = [];
      for (const candidate of candidates) {
        const read = page(candidate, false, true);
        if (!("why" in read)) return reply(read.text);
        if (!read.unreadable) return refuse(read.why);
        skipped.push(candidate);
      }
      return refuse(
        `no unread entry could be delivered; ${skipped.length} remain unreadable (${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ", …" : ""}). Weigh the evidence you have and finish your synthesis.`,
      );
    },
  };
}

/** Partial inspection is useful evidence, but cannot suppress the next review of this condition. */
export function reviewCoverage(
  inventory: ReviewInventory,
  verifier: ReviewVerifierEvidence,
  state: SourceReadState,
) {
  const paths = [...inventory.files, ...Object.keys(verifier.tools)];
  const missing = [...inventory.missing, ...paths.filter((path) => !deliveredSource(state, path).complete)];
  return {
    files: paths.length,
    opened: new Set(state.reads).size,
    chars: state.readChars,
    complete: !inventory.truncated && missing.length === 0 && verifier.unavailable === null,
    truncated: inventory.truncated,
    missing,
  };
}
