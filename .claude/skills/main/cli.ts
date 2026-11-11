/**
 * The front the repository's command scripts share: their declared options read by production's
 * `parseArgs` (`src/meta/process.ts`), and the one-line refusal they exit through.
 *
 * The parse is strict, so a misspelled flag refuses before anything runs. A reader that looks up
 * `argv.indexOf("--run")` and ignores everything else turns `--rnu abc` into a run with no `--run`,
 * and one that takes the token after a flag as its value turns `--out --json` into an output path
 * called `--json`. Either way the script measures a condition nobody asked for and says nothing.
 * `--name=value` stays available for a value that begins with `-`, and a bare `--` ends the
 * options, so every token after it is positional. Two refusals are this file's own: an option that
 * is no list passed twice, where the platform keeps the last, and a count of positionals outside
 * the spec's.
 *
 * `--host <name>` runs any script that goes through `runCommand` on a host `ANA_HOSTS` names, by the
 * runs CLI's own transport (`scriptOn`), and writes a path under this machine's home as the same path
 * under that host's. On 28 October round 11's seats on the Linux runner were read every 15 minutes
 * through a hand-written ssh line naming the runner's tree and Bun, since `due`, `watch`, `compare`,
 * `pairs` and `stop` read only the machine they ran on.
 */
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

/**
 * The script's own name in front of its one-line diagnostic, then the exit code a caller reads.
 *
 * The throw after `exit` is unreachable in a real process and is what makes the type `never`
 * without asserting it; a test that stubs `runtimeProcess.exit` reaches it and gets an error rather
 * than a function that quietly returned.
 */
type ExitWith = (message: string, code?: number) => never;

/**
 * How one declared option is read. `abs` refuses a relative path, `int` a non-integer, and `list`
 * collects every occurrence; the rest are one value or one flag.
 */
type OptionKind = "text" | "abs" | "int" | "flag" | "list";

/** What a command's `run` returns: its exit code, or nothing for exit 0. */
type CommandResult = number | undefined | void;

interface CommandSpec {
  name: string;
  /** Printed whole for `--help`, and named after a refused argument. */
  usage: string;
  options?: Readonly<Record<string, OptionKind>>;
  positionals?: number | readonly [number, number];
}

export interface CommandArgs {
  readonly die: ExitWith;
  readonly positionals: readonly string[];
  /** The option's value, or null when it was not passed. An `abs` option comes back resolved. */
  value: (name: string) => string | null;
  /** The same value, refusing through `die` when it is absent or empty. */
  required: (name: string) => string;
  int: (name: string) => number | null;
  flag: (name: string) => boolean;
  list: (name: string) => readonly string[];
}
/** What `parseArgs` read: each option as a string, `true` for a flag or every value of a list. */
interface Parsed {
  readonly values: Readonly<Record<string, string | boolean | readonly (string | boolean)[] | undefined>>;
  readonly positionals: readonly string[];
}

/** `argv` read against `spec` by production's `parseArgs`, which throws for an unknown option, a
 *  flag given a value and a value that is missing or looks like an option. `-h` is `--help`, under
 *  which the positionals are not counted. */
export function parseCliArgs(
  argv: readonly string[],
  spec: Pick<CommandSpec, "options" | "positionals">,
): Parsed {
  const kinds = spec.options ?? {};
  const { values, positionals, tokens } = parseArgs({
    args: [...argv],
    options: {
      ...Object.fromEntries(
        Object.entries(kinds).map(([name, kind]) => [
          name,
          kind === "flag"
            ? { type: "boolean" as const }
            : { type: "string" as const, multiple: kind === "list" },
        ]),
      ),
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    tokens: true,
  });
  const names = tokens.flatMap((token) => (token.kind === "option" ? [token.name] : []));
  const twice = names.find((name, index) => kinds[name] !== "list" && names.indexOf(name) !== index);
  if (twice !== undefined) throw new TypeError(`option --${twice} may be passed only once`);
  const allowed = spec.positionals ?? 0;
  const [min, max] = isNumber(allowed) ? [allowed, allowed] : allowed;
  if (values.help !== true && (positionals.length < min || positionals.length > max)) {
    const count = min === max ? String(min) : `${String(min)} to ${String(max)}`;
    throw new TypeError(`takes ${count} positional arguments, got ${String(positionals.length)}`);
  }
  return { values, positionals };
}

/**
 * A run that ended with its own exit code and one line, as a validator's verdict does: the command
 * worked and the answer was no. Anything else a command throws exits 1 with the error's message.
 */
export class CommandFailure extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

function commandArgs(spec: CommandSpec, parsed: Parsed, die: ExitWith): CommandArgs {
  const options = spec.options ?? {};
  const kindOf = (name: string, ...allowed: OptionKind[]): OptionKind => {
    const kind = options[name];
    if (kind === undefined || !allowed.includes(kind)) {
      throw new Error(
        `${spec.name} reads --${name} as ${allowed.join(" or ")}, which its spec does not declare`,
      );
    }
    return kind;
  };
  const text = (name: string): string | undefined => {
    const raw = parsed.values[name];
    return isString(raw) ? raw : undefined;
  };
  const value = (name: string): string | null => {
    const kind = kindOf(name, "text", "abs", "int");
    const raw = text(name);
    if (raw === undefined || kind !== "abs") return raw ?? null;
    if (!isAbsolute(raw)) die(`--${name} must be an absolute path, got ${capturedJsonStringify(raw)}`);
    return resolve(raw);
  };
  return {
    die,
    positionals: parsed.positionals,
    value,
    required: (name) => {
      const found = value(name);
      if (found === null || found === "") die(`--${name} is required`);
      return found;
    },
    int: (name) => {
      kindOf(name, "int");
      const raw = text(name);
      if (raw === undefined) return null;
      if (!/^-?\d+$/.test(raw)) die(`--${name} must be an integer, got ${capturedJsonStringify(raw)}`);
      return Number(raw);
    },
    flag: (name) => {
      kindOf(name, "flag");
      return parsed.values[name] === true;
    },
    list: (name) => {
      kindOf(name, "list");
      const all = parsed.values[name];
      return Array.isArray(all) ? all.filter(isString) : [];
    },
  };
}

/** `arg` with a `from/` that opens it, opens its value after `--option=`, or follows a comma, as in
 *  `pairs <control>,<arm>` where the shell expands only the first `~`, written as `to/`. */
function rehome(arg: string, from: string, to: string): string {
  return arg
    .split(",")
    .map((part) => {
      const at = part.startsWith("--") ? part.indexOf("=") + 1 : 0;
      return part.startsWith(`${from}/`, at)
        ? `${part.slice(0, at)}${to}${part.slice(at + from.length)}`
        : part;
    })
    .join(",");
}

/** The host `--host` names before any `--`, and the other arguments with each path under `home`
 *  written `~/`, which the host's own `runCommand` reads as its home; null where none is named. */
export function hostRoute(argv: readonly string[], home: string): { host: string; args: string[] } | null {
  const end = argv.includes("--") ? argv.indexOf("--") : argv.length;
  const at = argv.slice(0, end).findIndex((token) => token === "--host" || token.startsWith("--host="));
  if (at === -1) return null;
  const token = argv[at] ?? "";
  const joined = token !== "--host";
  return {
    host: joined ? token.slice("--host=".length) : (argv[at + 1] ?? ""),
    args: argv
      .filter((_, index) => index !== at && (joined || index !== at + 1))
      .map((arg) => rehome(arg, home, "~")),
  };
}

/**
 * The whole front of a command script: strict parsing against the declared options, `--help`
 * printing the usage, one line naming the script for a refused argument (exit 2) and for a failed
 * run (exit 1, or a `CommandFailure`'s own code), and the number `run` returns as the exit code.
 * Scripts call it under `import.meta.main`, so a test importing the module runs nothing.
 * With `--host` the script runs there instead, at this tree's published commit, and its exit code is
 * this one's.
 */
export async function runCommand(
  spec: CommandSpec,
  run: (args: CommandArgs) => CommandResult | Promise<CommandResult>,
  argv: readonly string[] = Bun.argv.slice(2),
): Promise<void> {
  const die: ExitWith = (message, code = 2) => {
    console.error(`${spec.name}: ${message}`);
    runtimeProcess.exit(code);
    throw new Error("process exit returned unexpectedly");
  };
  const home = homedir();
  const route = hostRoute(argv, home);
  if (route !== null) {
    if (route.host === "") die("--host needs a host's name");
    const { scriptOn } = await import("#tools/runs/hosts.ts");
    const { hostNamed } = await import("#tools/runs/host-config.ts");
    const script = relative(join(import.meta.dir, "..", "..", ".."), Bun.main);
    try {
      runtimeProcess.exitCode = await scriptOn(hostNamed(route.host), script, route.args);
    } catch (error) {
      die(errorMessage(error), 1);
    }
    return;
  }
  let parsed: Parsed;
  try {
    parsed = parseCliArgs(
      argv.map((arg) => rehome(arg, "~", home)),
      spec,
    );
  } catch (error) {
    die(errorMessage(error).replaceAll("\n", " "));
  }
  if (parsed.values.help === true) {
    console.log(`${spec.usage}\n\n--host <name> runs it on a host ANA_HOSTS names.`);
    return;
  }
  let code: CommandResult;
  try {
    code = await run(commandArgs(spec, parsed, die));
  } catch (error) {
    die(errorMessage(error), error instanceof CommandFailure ? error.code : 1);
  }
  if (isNumber(code)) runtimeProcess.exitCode = code;
}
