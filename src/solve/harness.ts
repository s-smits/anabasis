/**
 * A v1 Built Harness state, opened for a v2 solve: its guide, its tool kinds, its tool tree, and
 * its domain tools as pi tools whose every call runs one-shot under the command wall.
 *
 * The state is v1's on-disk format (harness-builder-v4 at 7af7315): `agent/BUILT_AGENTS.md`,
 * `agent/tools-spec.json`, `agent/tools.ts` exporting `createDomainHarness`, and `.toolchain/`.
 * `agent/config.yaml` is never read: the host owns every limit a solve runs under (plan exit test
 * 4), so a harness's own figures for turns, minutes or command seconds change nothing.
 *
 * Departure from v1: harness tools keep no state across calls in v2, each call runs alone under the
 * command wall. v1 loaded the factory once into a long-lived confined worker that held the solve's
 * DraftStore (generated-tool-worker.ts); here every call, and the one listing before them, is a
 * fresh `bun` over the bundled module in the command's own folder, which is removed when it ends,
 * so stdout is the only channel back. A call names no timeout, so it runs for the condition's
 * shell default, where v1 gave a request 30 s (generated-tool-worker-process.ts:75). What the bundle sees in place of `@ana/agent-bundle` and
 * pi-ai, and the departures there, are in `harness-shim.ts`.
 *
 * Two more departures, of 2026-10-09. `presets` names pi's coding tools, any of `read`, `bash`,
 * `edit` and `write`, where v1's named its own `files` and `shell` (`coding-tools.ts`). And the
 * answer is no tool's: a state need declare no artifact-writer, and one that does has it listed
 * and not served (`harnessTools`, `answer.ts`).
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { AGENT_DIR, GENERATED_TOOLS_FILE, GUIDE_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { sha256OfFile } from "../meta/digest.ts";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { type JsonValue, asRecord, isRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { capturedExecPath } from "../meta/process.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { shellQuote } from "../verify/solve-command-isolation.ts";
import { CODING_TOOLS } from "./coding-tools.ts";
import { type CommandWall, runWalled } from "./command.ts";
import { DRAFT_TOOL } from "./harness-shim.ts";
import { type PublicTask, publicView } from "./prompt.ts";

type ToolKind = "reader" | "advisor" | "artifact-writer";

export interface Harness {
  /** `agent/BUILT_AGENTS.md` as written, untrimmed; null when the state has none. */
  readonly guide: string | null;
  readonly presets: readonly string[];
  /** Each declared domain tool's kind, from `agent/tools-spec.json`. */
  readonly kinds: ReadonlyMap<string, ToolKind>;
  /** `.toolchain`, for the wall's `toolTree`; null when the state has none. */
  readonly toolTree: string | null;
  /** `agent/tools.ts` bundled into one self-contained ESM module over `harness-shim.ts`. */
  readonly module: string;
  /** sha256 over everything the solver-visible tools depend on: module, spec, guide and the tool
   *  tree's files, so a tool tree changed under an unchanged module changes it (v1's row G7). */
  readonly digest: string;
}

/** A tool's result as the shim's `call` returns it (v1's `Evidence`, define-tool.ts:13). */
interface Evidence {
  text: string;
  details?: JsonValue;
  terminate?: boolean;
}

/** One listed tool, as the caller prints it: the factory's own row, functions dropped. */
interface ToolRow {
  name: string;
  label: string;
  description: string;
  /** The TypeBox schema printed as JSON, which is the JSON Schema pi validates against. */
  parameters: TSchema;
  executionMode?: "sequential" | "parallel";
}

const KINDS: ReadonlySet<string> = new Set(["reader", "advisor", "artifact-writer"]);
/** The names a solver's tools already hold, whatever the harness: pi's coding tools and `submit`. */
const HOST_TOOLS: readonly string[] = [...CODING_TOOLS, "submit"];
const SHIM = Bun.fileURLToPath(new URL("./harness-shim.ts", import.meta.url));
/** The host's own source and installed packages, which the shim imports from. */
const HOST_ROOTS = [dirname(dirname(SHIM)), join(dirname(dirname(dirname(SHIM))), "node_modules")];
const MARKER = "@@ana-harness-result@@";
/** The tail of a call's output kept for the result line and an error's context; a tool printing
 *  without end is cut by the command's timeout, not by the host's memory. */
const OUTPUT_TAIL_BYTES = 8 * 1024 * 1024;

/**
 * What runs inside the wall: read `input.json`, load the factory, and print one marker line with
 * the listing, the tool's evidence or the error, last on stdout. Fixed text, never composed from
 * the harness, and plain JavaScript because it runs where nothing of this repository is readable.
 * The brand and the "must return tools" refusals are v1's (built-starter.ts:446-448, :558). The
 * signal `run` receives never fires: the host's abort reaches the call by killing its process tree.
 */
const CALLER = `import { readFileSync } from "node:fs";
const out = (value) => process.stdout.write("\\n${MARKER}" + JSON.stringify(value) + "\\n");
try {
  const input = JSON.parse(readFileSync("input.json", "utf8"));
  const { createDomainHarness } = await import("./harness.mjs");
  const tools = createDomainHarness(input.task)?.tools;
  if (!Array.isArray(tools)) throw new Error("createDomainHarness must return tools");
  if (tools.some((tool) => tool?.[Symbol.for(${capturedJsonStringify(DRAFT_TOOL.description)})] !== true))
    throw new Error("createDomainHarness tools must be created with defineDraftTool");
  if (input.name === null) {
    out({ tools: tools.map(({ name, label, description, parameters, executionMode }) => ({ name, label, description, parameters, executionMode })) });
  } else {
    const tool = tools.find((candidate) => candidate.name === input.name);
    if (tool === undefined) throw new Error(\`createDomainHarness has no tool "\${input.name}"\`);
    const { text, details, terminate } = await tool.call(input.params, new AbortController().signal);
    out({ result: { text, details, terminate } });
  }
} catch (error) {
  out({ error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
`;

/** Bun writes each bundled file's path, relative to where the host was started, on a comment line
 *  of its own. The digest leaves those lines out: with them, one harness had another digest in every
 *  directory it was copied to and from every directory the host was run in, and a condition names
 *  its harness by this digest. The module that runs keeps them. */
const BUNDLED_PATH = /^\/\/ .+\.(?:[cm]?[jt]sx?|json)$/gm;

/** A harness's module as its digest reads it: without the path comments, and with the harness's own
 *  directory, which Bun writes out whole wherever a bundled CommonJS file reads `__dirname` or
 *  `__filename`, replaced by one name. Otherwise a harness with such a package had one digest where
 *  it was edited, another where it was frozen and a third where it was kept. */
function located(module: string, dir: string): string {
  const places = [...new Set([realpathSync(dir), resolve(dir)])].sort((a, b) => b.length - a.length);
  return places
    .reduce((text, place) => text.replaceAll(place, "<harness>"), module)
    .replace(BUNDLED_PATH, "");
}

/**
 * The guide a kept harness state holds, as a solver under it read it, or null where the state holds
 * none. For a reader of a solve that has the state's folder and no use for its tools. Read only
 * where it is a file of the state's own: a state is kept with its links as they were, and a guide
 * linked to a host file is refused where the harness is opened (`openHarness`), so it is not read
 * here either.
 */
export function guideOf(dir: string): string | null {
  const file = join(dir, `${AGENT_DIR}${GUIDE_FILE}`);
  return existsSync(file) && lstatSync(file).isFile() ? readFileSync(file, "utf8") : null;
}

export async function openHarness(dir: string): Promise<Harness> {
  // The three files the host reads by name are the harness's own: a guide or a spec linked to a host
  // file would be read here, outside every wall, and handed to the solver.
  const root = realpathSync(dir);
  const guideName = `${AGENT_DIR}${GUIDE_FILE}`;
  for (const name of [guideName, TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE]) {
    const file = join(dir, name);
    if (existsSync(file) && !containsPath(realpathSync(file), root)) {
      throw new Error(`${name} links outside the harness`);
    }
  }
  const guideFile = join(dir, guideName);
  const guide = existsSync(guideFile) ? await Bun.file(guideFile).text() : null;
  const spec = capturedJsonParse(await Bun.file(join(dir, TOOLS_SPEC_FILE)).text());
  const fields = asRecord(spec);
  const presets = Array.isArray(fields?.presets) && fields.presets.every(isString) ? fields.presets : null;
  const declared = Array.isArray(fields?.tools) ? fields.tools : null;
  if (presets === null || declared === null) {
    throw new Error(`${TOOLS_SPEC_FILE} needs presets and tools lists`);
  }
  const kinds = new Map<string, ToolKind>();
  for (const row of declared) {
    if (!isRecord(row) || !isString(row.name) || !isString(row.kind) || !KINDS.has(row.kind)) {
      throw new Error(`${TOOLS_SPEC_FILE} row ${capturedJsonStringify(row)} needs a name and a kind`);
    }
    // SAFETY: KINDS just admitted the kind.
    kinds.set(row.name, row.kind as ToolKind);
  }
  // A solver is given one tool under each name, and these are pi's and the host's.
  const taken = [...kinds.keys()].filter((name) => HOST_TOOLS.includes(name));
  if (taken.length > 0) {
    throw new Error(
      `${TOOLS_SPEC_FILE} names a tool ${taken.join(", ")}: ${HOST_TOOLS.join(", ")} are the host's own`,
    );
  }
  const module = await bundle(join(dir, GENERATED_TOOLS_FILE));
  const toolchain = resolve(dir, ".toolchain");
  const toolTree = existsSync(toolchain) ? toolchain : null;
  const tree = toolTree === null ? null : keptTreeContent(toolTree);
  return {
    guide,
    presets,
    kinds,
    toolTree,
    module,
    digest: hashJsonValue({ module: located(module, dir), spec, guide, tree }),
  };
}

/**
 * Every path under `dir`, sorted, hidden ones too, a link listed but never entered. Bun's recursive
 * `readdirSync` enters linked directories, and a v1 harness state links its `node_modules` entries into
 * the run that built it, so one loop there ended a live solve with ELOOP before its first turn.
 */
export function pathsUnder(dir: string): string[] {
  const glob = new Bun.Glob("**");
  return [...glob.scanSync({ cwd: dir, dot: true, onlyFiles: false, followSymlinks: false })].sort();
}

/** Each entry under `dir` by path, mode and content: a file by its sha256, a link by its target. */
export function treeContent(dir: string) {
  return pathsUnder(dir).map((path) => {
    const full = join(dir, path);
    const stat = lstatSync(full);
    const content = stat.isSymbolicLink() ? readlinkSync(full) : stat.isFile() ? sha256OfFile(full) : null;
    return { path, mode: stat.mode, content };
  });
}

/** Each tool tree's content by where it really is, with the stamp it was read under. */
const TREES = new Map<string, { stamp: string; content: ReturnType<typeof treeContent> }>();

/** What a tool tree is read under: a file in it added, removed, resized, rewritten or with its mode
 *  changed changes it. It is what the runner's own moved-files check trusts (`run.ts`, `treeStamp`). */
export function toolTreeStamp(real: string): string {
  return hashJsonValue(
    pathsUnder(real).map((path) => {
      const stat = lstatSync(join(real, path));
      return [path, stat.size, stat.mtimeMs, stat.mode, stat.ino];
    }),
  );
}

/**
 * A tool tree's content, read once for as long as its stamp holds. Every solve opens its harness,
 * and a tool tree runs to thousands of files and gigabytes, so hashing it afresh each time was a
 * full read of it per solve.
 */
function keptTreeContent(toolTree: string) {
  const real = realpathSync(toolTree);
  const stamp = toolTreeStamp(real);
  const kept = TREES.get(real);
  if (kept?.stamp === stamp) return kept.content;
  const content = treeContent(real);
  TREES.set(real, { stamp, content });
  return content;
}

/**
 * v1's bundling (generated-tool-worker-process.ts:103-112), with the two imports a harness makes of
 * the host resolved to the shim, and the output kept in memory rather than in a temporary directory,
 * since every call stages it afresh.
 *
 * The bundle is built by the host, outside every wall, from files a Builder wrote. Left alone, Bun
 * runs a macro import in this process as it bundles, and inlines any file an import names, a text
 * import of a check program among them, into the module the solver's tools then run. So macros are
 * off, and every file the bundle loads must sit, links followed, inside the harness, its installed
 * packages among it, or in the host's own source and packages, which the shim imports. A package linked in from
 * elsewhere is outside it, as v1's states link theirs into the run that built them.
 *
 * The question is asked of each file as it is loaded and not of each import as it is resolved. A
 * guard on resolution has to trust some importers, an installed package's among them, and a Builder
 * writes `node_modules` under its harness: a package there importing `../../../log.jsonl` as text
 * passed such a guard, and the log, with every hidden value in it, was bundled into the solver's
 * tools. Whatever names a file, by whatever route it resolves, it is loaded here or not at all.
 */
async function bundle(entry: string): Promise<string> {
  const root = realpathSync(dirname(dirname(entry)));
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    format: "esm",
    splitting: false,
    sourcemap: "none",
    // SAFETY: Bun 1.4.2 takes `macros: false` and fails a build that imports one, though its types do
    // not declare the option; `test/harness-tools.test.ts` fails if a later Bun stops honouring it.
    ...({ macros: false } as object),
    throw: false,
    plugins: [
      {
        name: "harness-shim",
        setup(build) {
          build.onResolve({ filter: /^(@ana\/agent-bundle|@earendil-works\/pi-ai)$/ }, () => ({
            path: SHIM,
          }));
          build.onLoad({ filter: /.*/ }, ({ path }) => {
            const file = realpathSync(path);
            if ([root, ...HOST_ROOTS].some((own) => containsPath(file, own))) return undefined;
            throw new Error(
              `an import reaches ${basename(file)}, which is outside the harness: its tools are built from its own files and installed packages`,
            );
          });
        },
      },
    ],
  });
  const [output] = result.outputs;
  if (!result.success || output === undefined || result.outputs.length !== 1) {
    throw new Error(`harness bundle failed: ${result.logs.map((log) => log.message).join("; ")}`);
  }
  return await output.text();
}

/**
 * The harness's domain tools for one task, in the factory's order, after one walled listing. The
 * name check is v1's (built-starter.ts:449-460).
 *
 * An artifact-writer is listed and not served. Until 2026-10-09 a harness had to declare one, the
 * host bound it to the answer format, and its arguments were the answer; three of four Sol Builders
 * on 2026-10-08 froze a harness without one, and every solve under each ended with no answer. The
 * answer is now a file the host reads at `submit` (`answer.ts`), so no harness carries the answer's
 * path and none can break it. A harness kept before then still declares its writer, and opens.
 */
export async function harnessTools(
  harness: Harness,
  task: PublicTask,
  wall: CommandWall,
): Promise<AgentTool[]> {
  const view = publicView(task);
  const call = <T>(name: string | null, params: unknown, signal?: AbortSignal) =>
    callHarness<T>({ harness, wall, input: { task: view, name, params }, signal });
  const { tools: rows } = await call<{ tools: ToolRow[] }>(null, null);
  const actual = rows.map(({ name }) => name).sort();
  const expected = [...harness.kinds.keys()].sort();
  if (capturedJsonStringify(actual) !== capturedJsonStringify(expected)) {
    throw new Error(
      `domain tool mismatch: generated [${actual.join(", ")}], recorded [${expected.join(", ")}]`,
    );
  }
  return rows
    .filter(({ name }) => harness.kinds.get(name) !== "artifact-writer")
    .map(
      (row): AgentTool => ({
        name: row.name,
        label: row.label,
        description: row.description,
        parameters: row.parameters,
        ...keyIfDefined("executionMode", row.executionMode),
        execute: async (_toolCallId, params, signal) => {
          const { result } = await call<{ result: Evidence }>(row.name, params, signal);
          return {
            content: [{ type: "text", text: result.text }],
            details: result.details ?? null,
            ...keyIfDefined("terminate", result.terminate),
          } satisfies AgentToolResult<JsonValue>;
        },
      }),
    );
}

/** One walled run of the caller: the listing when `name` is null, otherwise one tool call. Returns
 *  the marker line's value, or throws the harness's own error message. */
async function callHarness<T>(run: {
  harness: Harness;
  wall: CommandWall;
  input: { task: PublicTask; name: string | null; params: unknown };
  signal?: AbortSignal | undefined;
}): Promise<T> {
  const chunks: Buffer[] = [];
  let held = 0;
  const { exitCode } = await runWalled(run.wall, `${shellQuote(capturedExecPath)} caller.mjs`, {
    onData: (data) => {
      chunks.push(data);
      held += data.length;
      while (held - (chunks[0]?.length ?? 0) > OUTPUT_TAIL_BYTES) held -= chunks.shift()?.length ?? 0;
    },
    signal: run.signal,
    stage: (into) => {
      writeFileSync(join(into, "harness.mjs"), run.harness.module);
      writeFileSync(join(into, "caller.mjs"), CALLER);
      writeFileSync(join(into, "input.json"), capturedJsonStringify(run.input));
    },
  });
  const text = Buffer.concat(chunks).toString("utf8");
  const at = text.lastIndexOf(`\n${MARKER}`);
  const line = at < 0 ? null : (text.slice(at + MARKER.length + 1).split("\n")[0] ?? "");
  const reply = line === null ? null : parseJsonAs<T & { error?: JsonValue }>(line);
  if (reply !== null && isString(reply.error)) throw new Error(reply.error);
  if (reply === null || exitCode !== 0) {
    throw new Error(`harness call exited ${String(exitCode)} without a result: ${text.slice(-2000)}`);
  }
  return reply;
}
