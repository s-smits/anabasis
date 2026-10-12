/**
 * A solver's coding tools: pi coding-agent's own four, `read`, `bash`, `edit` and `write`, as pi
 * releases them (`vendor/pi-coding-agent/core/tools/`, pi's `createCodingToolDefinitions`). Their
 * names, descriptions, parameters and prompt lines are pi's and are read from pi's definitions, so
 * they move with the vendored pi. A harness selects among them by name (`agent/tools-spec.json`,
 * `presets`).
 *
 * What v2 adds is where they act. pi's tools take the operations they are made of, and every one
 * here is a command behind the command wall (`runWalled`): the wall decides what a file tool may
 * read and write exactly as it decides for a command, and nothing of a file is opened by the host's
 * own process but the bytes a walled command printed. The four share one working directory, the
 * solve's home, as pi's share theirs.
 *
 * Departures from pi, each for the wall:
 * - `bash`'s `timeout` has a default and a maximum, the condition's, where pi's has neither. Its
 *   schema says so, and a command the limit cut is told what the host would have allowed.
 * - `~` in a file tool's path is the solve's home, as the solver's shell has it. pi expands it to
 *   the home of the user it runs as, which here is the host's.
 * - A file is read whole only up to 16 MiB: pi reads any file into its own memory, which here is
 *   the host's, outside the disk cap and every other limit.
 * - Every tool runs one call at a time: a command's end ends whatever still works on the solve's
 *   volume (`command.ts`), so two at once would end each other.
 *
 * The file tools are there because a solver with `bash` alone wrote its files through the shell:
 * in the Starter solves of six campaigns the commands that wrote a file by heredoc held most of what
 * a solver typed (`docs/transfer.md`).
 */
import { type TSchema, Type } from "typebox";
import type { ToolDefinition } from "../../vendor/pi-coding-agent/core/extensions/types.ts";
import { createBashToolDefinition } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { createEditToolDefinition } from "../../vendor/pi-coding-agent/core/tools/edit.ts";
import { createReadToolDefinition } from "../../vendor/pi-coding-agent/core/tools/read.ts";
import { createWriteToolDefinition } from "../../vendor/pi-coding-agent/core/tools/write.ts";
import { detectSupportedImageMimeType } from "../../vendor/pi-coding-agent/utils/mime.ts";
import { existsSync, readdirSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { asError } from "../meta/runtime-values.ts";
import { shellQuote } from "../verify/solve-command-isolation.ts";
import { type CommandWall, heldSeconds, runWalled } from "./command.ts";

/** pi's coding tools, in the order pi lists them. */
export const CODING_TOOLS = ["read", "bash", "edit", "write"] as const;
type CodingTool = (typeof CODING_TOOLS)[number];

/** A tool as pi defines one: an agent tool with the lines it adds to the system prompt, its
 *  arguments typed by `Parameters`. */
export type SolverTool<Parameters extends TSchema = TSchema> = ToolDefinition<Parameters>;

/** One walled command with its output whole, which is what a file tool's operations are made of. */
export type WallExec = (
  command: string,
  options?: { readonly stage?: (into: string) => void; readonly signal?: AbortSignal | undefined },
) => Promise<{ exitCode: number | null; output: Buffer }>;

/** The most of a file the file tools read whole. */
const READ_MAX_BYTES = 16 * 1024 * 1024;
/** What pi reads of a file to tell an image by (`utils/mime.ts`, `IMAGE_TYPE_SNIFF_BYTES`). */
const SNIFF_BYTES = 4100;
const MISSING = 44;
const DENIED = 45;
/** What a command cut for the solve's end is told, in place of what its own limit would allow. */
const NEAR_END =
  "\n\nThe command was cut because the solve's time is nearly up, so that its result reaches you while you can still act on it.";
/** The folder in the home a long output is handed into. */
const LONG_OUTPUT = ".shell-output";

type ShellLimits = CommandWall["limits"];

/**
 * The coding tools a harness's presets select, in pi's order. `shell` is what an older kept harness
 * asks for, and means what it meant: bash alone. Any other name is refused, here
 * for a solve and at the Builder's freeze before a practice solve is spent on the answer.
 */
export function selectedCodingTools(presets: readonly string[]): CodingTool[] {
  const named = presets.map((preset) => (preset === "shell" ? "bash" : preset));
  const served: readonly string[] = CODING_TOOLS;
  const other = named.filter((name) => !served.includes(name));
  if (other.length > 0) {
    throw new Error(
      `a solve serves pi's coding tools as presets (${CODING_TOOLS.join(", ")}), not ${other.join(", ")}`,
    );
  }
  return CODING_TOOLS.filter((name) => named.includes(name));
}

/** A wall's commands as the file tools and `submit` run them: started in the command's own folder,
 *  beside what was staged for it, and their output kept whole. Each prints a bounded number of
 *  bytes, so the host holds no more than that. */
export function wallExec(wall: CommandWall): WallExec {
  return async (command, options = {}) => {
    const chunks: Buffer[] = [];
    const { exitCode } = await runWalled(wall, command, { ...options, onData: (data) => chunks.push(data) });
    return { exitCode, output: Buffer.concat(chunks) };
  };
}

/** The selected tools on one solve's wall, in pi's order. */
export function codingTools(wall: CommandWall, selected: readonly CodingTool[]): SolverTool[] {
  const tools = [bashTool(wall), ...fileTools(wall.dirs.home, wallExec(wall))];
  return CODING_TOOLS.flatMap((name) =>
    selected.includes(name) ? tools.filter((tool) => tool.name === name) : [],
  );
}

/**
 * pi's `read`, `edit` and `write` over `home`, their file operations done by `exec`. pi's
 * definition is built for each call, on operations that carry the call's own abort signal: pi hands
 * its operations no signal, and a read of a pipe nobody writes would otherwise outlast its solve.
 */
export function fileTools(home: string, exec: WallExec): SolverTool[] {
  const built = (signal?: AbortSignal) => {
    const operations = fileOperations((command, options = {}) => exec(command, { ...options, signal }));
    return [
      createReadToolDefinition(home, { operations: operations.read }),
      createEditToolDefinition(home, { operations: operations.edit }),
      createWriteToolDefinition(home, { operations: operations.write }),
    ];
  };
  return built().map(
    (definition, index): SolverTool => ({
      ...definition,
      executionMode: "sequential",
      execute: async (callId, params, signal, onUpdate, ctx) => {
        // SAFETY: each of the three tools declares a `path` string, and pi validated the arguments.
        const given = params as { path: string };
        const { path } = given;
        const inHome = path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
        // SAFETY: `built` returns the same three definitions in the same order every time.
        const tool = built(signal)[index] as SolverTool;
        return await tool.execute(callId, { ...given, path: inHome }, signal, onUpdate, ctx);
      },
    }),
  );
}

/**
 * What pi's file tools are made of, each a walled command. A file's bytes travel beside the command
 * and never in it: a write stages them for the command, which starts beside a copy of them
 * (`runWalled`), and a read is the command's output. Absolute paths only, as pi resolves them
 * before it calls.
 */
function fileOperations(exec: WallExec) {
  const said = (output: Buffer, otherwise: string) => output.toString("utf8").trim() || otherwise;
  // pi's tools pass a missing file's error on as Node gave it, and pi's edit prints its code.
  const refused = (code: string, what: string, path: string) =>
    Object.assign(new Error(`${code}: ${what}, access '${path}'`), { code });
  const access = (writable: boolean) => async (path: string) => {
    const file = shellQuote(path);
    const { exitCode } = await exec(
      `[ -e ${file} ] || exit ${String(MISSING)}; [ -r ${file} ]${writable ? ` && [ -w ${file} ]` : ""} || exit ${String(DENIED)}`,
    );
    if (exitCode === MISSING) throw refused("ENOENT", "no such file or directory", path);
    if (exitCode !== 0) throw refused("EACCES", "permission denied", path);
  };
  const head = async (path: string, bytes: number) => {
    const { exitCode, output } = await exec(`head -c ${String(bytes)} ${shellQuote(path)}`);
    if (exitCode !== 0) throw new Error(said(output, `${path} could not be read`));
    return output;
  };
  const readFile = async (path: string) => {
    const bytes = await head(path, READ_MAX_BYTES + 1);
    if (bytes.length > READ_MAX_BYTES) {
      throw new Error(
        `${path} is larger than 16 MiB, the most the file tools read: read part of it with bash (head, tail, sed -n)`,
      );
    }
    return bytes;
  };
  const writeFile = async (path: string, content: string) => {
    const { exitCode, output } = await exec(`cat content > ${shellQuote(path)}`, {
      stage: (into) => writeFileSync(join(into, "content"), content, "utf8"),
    });
    if (exitCode !== 0) throw new Error(said(output, `${path} could not be written`));
  };
  return {
    read: {
      access: access(false),
      readFile,
      detectImageMimeType: async (path: string) =>
        detectSupportedImageMimeType(await head(path, SNIFF_BYTES)),
    },
    edit: { access: access(true), readFile, writeFile },
    write: {
      writeFile,
      mkdir: async (dir: string) => {
        const { exitCode, output } = await exec(`mkdir -p ${shellQuote(dir)}`);
        if (exitCode !== 0) throw new Error(said(output, `${dir} could not be made`));
      },
    },
  };
}

/** What the host would have allowed, appended to a command its own limit cut: time left to ask
 *  for, an ask above the maximum, or the maximum already in hand. It says what the limit is and
 *  not what to do about it, which is the solver's to decide. */
function timeoutClause(
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: ShellLimits,
): string {
  if (seconds < shellMaxSeconds) {
    return `\n\nThe host allows ${String(shellMaxSeconds)} s for one command, and ${String(shellDefaultSeconds)} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${String(asked)} s is above the ${String(shellMaxSeconds)} s the host allows one command, so it ran as ${String(seconds)} s, the most there is.`;
  }
  return `\n\nThat is the whole ${String(shellMaxSeconds)} s the host allows one command.`;
}

/**
 * Hands the long outputs pi kept under `kept` into the home, each by one walled command, and
 * returns every file's path as pi's notice names it beside the path the solver can read it at.
 *
 * pi writes a long output whole to a file, from the host's own process, and names the file in its
 * notice. Written straight into the home, under `.shell-output`, it would follow a link a command
 * had made of that name to wherever the link led: a file of a solver's choosing, outside every
 * wall. So pi writes under the seat's `kept`,
 * which is on the capped volume and which no command can write, and a command of its own copies
 * the file into the home, where the wall decides what a link may reach.
 */
async function handIn(wall: CommandWall, kept: string, signal?: AbortSignal): Promise<[string, string][]> {
  const handed: [string, string][] = [];
  for (const name of existsSync(kept) ? readdirSync(kept) : []) {
    const from = join(kept, name);
    const shown = `$HOME/${LONG_OUTPUT}`;
    const moved = await runWalled(wall, `mkdir -p "${shown}" && cp ${shellQuote(from)} "${shown}/"`, {
      onData: () => undefined,
      signal,
    }).then(
      ({ exitCode }) => exitCode === 0,
      () => false,
    );
    rmSync(from, { force: true });
    handed.push([from, moved ? join(wall.dirs.home, LONG_OUTPUT, name) : "(not kept)"]);
  }
  return handed;
}

/**
 * pi's `bash` on a wall, started in the wall's home. The result is pi's own; only a cut by the
 * command's limit gains a clause, and "this limit cut it" is read from the backend's `timeout:`
 * error, not from output text a command could print. An abort reaches pi as `aborted` and gains
 * nothing. A Builder's shell is this one, on its own session's wall (`src/builder/tools.ts`).
 */
export function bashTool(wall: CommandWall): SolverTool {
  const { limits } = wall;
  const { home } = wall.dirs;
  const kept = join(wall.dirs.kept, "long-output");
  // Session variables are off because the wall's environment replaces pi's.
  const options = { exposeSessionEnvironment: false, tempDir: kept };
  const pi = createBashToolDefinition(home, options);
  return {
    ...pi,
    parameters: Type.Object({
      command: pi.parameters.properties.command,
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds: ${String(limits.shellDefaultSeconds)} when omitted, at most ${String(limits.shellMaxSeconds)}; a value outside that range runs at the nearest end of it`,
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (callId, params, signal, onUpdate, ctx) => {
      const { command, timeout } =
        /* SAFETY: the registered schema requires `command` and makes `timeout` optional, and pi validates arguments against it before this runs. */ params as {
          command: string;
          timeout?: number;
        };
      // The limits, and the solve's own end where that comes first (`heldSeconds`).
      const { asked, seconds, nearEnd } = heldSeconds(timeout, wall);
      let cut = false;
      const shell = createBashToolDefinition(home, {
        ...options,
        operations: {
          // pi names the tool's working directory, which is the home the wall starts the command in.
          exec: (line, _cwd, { onData, signal: ended, timeout: held }) =>
            runWalled(wall, line, { onData, signal: ended, timeout: held }).catch((error: unknown) => {
              cut = asError(error).message.startsWith("timeout:");
              throw error;
            }),
        },
      });
      /** pi's text with each long output's file named where the solver can read it. */
      const inHome = async (text: string) =>
        (await handIn(wall, kept, signal)).reduce((said, [from, to]) => said.replaceAll(from, to), text);
      try {
        const result = await shell.execute(callId, { command, timeout: seconds }, signal, onUpdate, ctx);
        // pi's result is one text, which names the file where its output was long.
        const [first, ...rest] = result.content;
        return first?.type === "text"
          ? { ...result, content: [{ ...first, text: await inHome(first.text) }, ...rest] }
          : result;
      } catch (error) {
        const said = await inHome(asError(error).message);
        const why = nearEnd ? NEAR_END : timeoutClause(asked, seconds, limits);
        throw new Error(cut ? said + why : said, { cause: error });
      }
    },
  };
}
