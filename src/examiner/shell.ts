import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { TSchema } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { type Engine, engineReadRoots, pinnedEngines, type VerifierTree } from "../kernel/verify.ts";
import { read } from "../kernel/log.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "../meta/filesystem.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import {
  type CommandWall,
  INSTALLER_TOLD,
  networkReach,
  type SolveDirs,
  solveDirs,
  type Walled,
  walledBase,
} from "../tools/command.ts";
import { codingTools } from "../tools/coding.ts";
import { installedPrograms } from "../harness/programs.ts";
import { claimRoot } from "../wall/seat-root.ts";
import { shellQuote } from "../wall/isolation.ts";

const FILE_BYTES = 4_000_000;

export const FROM_FILE =
  'Any JSON value this tool takes, such as a public input, hidden values, an answer, a format or a check program, may instead be given as { "from_file": "<path>" }: a file in your home, by its path relative to the home, which the host reads and takes as if the value had been written here, a .json file as the JSON it holds and any other file as its text.';

export interface Wall extends Walled {
  readonly engines?: VerifierTree | undefined;
  readonly keep?: string | undefined;
}

export interface Walls {
  readonly shell: CommandWall;
  readonly pinned: readonly Engine[];
  readonly began: number;
  readonly keep: () => void;
}

export const examinerDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`exam-${basename(dirname(log))}-${id}`);

export async function examinerShell(shell: CommandWall | undefined, enters: string): Promise<SeatTool[]> {
  if (shell === undefined) return [];
  const network = await networkReach(shell);
  const engines = installedPrograms(shell.toolTree);
  const walls = ` The command runs in your home directory, which holds what earlier Examiner sessions of this campaign left there and is kept for the next. It can write there and $TMPDIR, which is kept for the whole session; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. It can read the host's own toolchains and public runtime roots, but no repository or private data. ${network === "unreached" ? "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be installed." : `It has network access: a package index was reached from inside the wall when this process started.${INSTALLER_TOLD[network]}`}${engines.length === 0 ? "" : ` The engines the exam's checks run are installed, and run by name: ${engines.join(", ")}. They compute; try_answer alone runs the checks on an answer.`} Nothing a command starts runs on after it returns. ${enters}.`;
  return codingTools(shell, ["bash", "read", "write"]).map((each) =>
    each.name === "bash" ? { ...each, description: `${each.description}${walls}` } : each,
  );
}

export async function inExaminerWall<T>(
  { log, id }: { readonly log: string; readonly id: string },
  wall: Wall,
  run: (walls: Walls) => Promise<T>,
): Promise<T> {
  const began = performance.now();
  const dirs = examinerDirs(log, id);
  const { engines, keep } = wall;
  const pinned = engines === undefined ? [] : pinnedEngines(engines);
  const reopened =
    engines === undefined || pinned.length === 0
      ? []
      : [
          engines.tools,
          ...engineReadRoots(
            engines.tools,
            pinned.map(({ path }) => path),
          ),
        ];
  const tree = join(dirs.kept, "engines");
  const release = await claimRoot(dirs.root);
  try {
    const base = await walledBase(dirs, { ...wall, readAllowRoots: reopened }, "an Examiner");
    for (const { name, path } of pinned) {
      const runs = join(tree, "bin", name);
      await Bun.write(runs, `#!/bin/sh\nexec ${shellQuote(path)} "$@"\n`);
      chmodSync(runs, 0o755);
    }
    const shell = {
      base,
      dirs,
      toolTree: pinned.length === 0 ? null : tree,
      limits: { shellDefaultSeconds: 120, shellMaxSeconds: 600 },
    };
    const { home } = dirs;
    const carry = { recursive: true, verbatimSymlinks: true } as const;
    if (keep !== undefined && existsSync(keep)) cpSync(keep, home, carry);
    const kept = () => {
      if (keep === undefined) return;
      rmSync(keep, { recursive: true, force: true });
      cpSync(home, keep, carry);
    };
    const result = await run({ shell, pinned, began, keep: kept });
    const ended = read(log, (kind) => kind !== "exam.finished" && kind !== "draft.finished").at(-1)?.data;
    if (!(ended?.ended === "crashed" && Number(ended.running) > 0)) kept();
    return result;
  } finally {
    await release();
  }
}

export function fromHome<Parameters extends TSchema>(
  home: string | undefined,
  definition: ToolRegistration<Parameters>,
): ToolRegistration<Parameters> {
  const expand = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(expand);
    if (isString(value) && /^\s*\{\s*"from_file"\s*:\s*"[^"\\]+"\s*\}\s*$/u.test(value)) {
      return expand(parseJsonAs<JsonValue>(value));
    }
    if (!isRecord(value)) return value;
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]?.[0] === "from_file" && isString(entries[0][1])) {
      return homeFile(home, entries[0][1]);
    }
    return Object.fromEntries(entries.map(([key, inner]) => [key, expand(inner)]));
  };
  return {
    ...definition,
    prepareArguments: (spelled) => {
      // SAFETY: a call's arguments are the JSON object the provider parsed, and a file holds JSON.
      const args = expand(spelled as JsonValue) as JsonObject;
      try {
        validateToolArguments(definition, {
          type: "toolCall",
          id: "",
          name: definition.name,
          arguments: args,
        });
      } catch (error) {
        const [faults = ""] = errorMessage(error).split("\n\nReceived arguments:");
        throw new Error(faults, { cause: error });
      }
      // SAFETY: just checked against the tool's schema, which pi checks and coerces it by again.
      return args as ReturnType<NonNullable<ToolRegistration<Parameters>["prepareArguments"]>>;
    },
  };
}

function homeFile(home: string | undefined, path: string): JsonValue {
  if (home === undefined) {
    throw new Error(`from_file names ${path}, and this session has no home: give the value inline`);
  }
  const root = realpathSync(home);
  const file = resolve(root, path);
  if (!containsPath(file, root)) {
    throw new Error(
      `from_file names ${path}, which lies outside your home: name a file under it, by its path relative to it`,
    );
  }
  if (!existsSync(file)) {
    throw new Error(`from_file names ${path}, and your home holds no such file`);
  }
  const real = realpathSync(file);
  if (!containsPath(real, root)) {
    throw new Error(`from_file names ${path}, which links outside your home: name a file under it`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) {
    throw new Error(`from_file names ${path}, which is not a regular file`);
  }
  if (stat.size > FILE_BYTES) {
    throw new Error(
      `from_file names ${path} (${String(stat.size)} bytes), over the ${String(FILE_BYTES)}-byte limit`,
    );
  }
  const text = readFileSync(real, "utf8");
  if (!/\.json$/iu.test(real)) return text;
  try {
    return parseJsonAs<JsonValue>(text);
  } catch (error) {
    throw new Error(`from_file names ${path}, which is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
