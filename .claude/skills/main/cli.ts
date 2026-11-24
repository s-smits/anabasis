/**
 * Shared command-line front end for repository skill scripts: strict option parsing via
 * production's `parseArgs` (`src/meta/process.ts`) and uniform one-line diagnostic exits.
 */
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

/**
 * Prints the script name and one-line diagnostic to stderr, then exits with `code`.
 */
type ExitWith = (message: string, code?: number) => never;

/**
 * Option value kind: `abs` requires an absolute path, `int` an integer, `list` collects repeated
 * occurrences, `text` takes a single string, and `flag` a boolean switch.
 */
type OptionKind = "text" | "abs" | "int" | "flag" | "list";

/** Return value of a command's `run` callback: an explicit exit code, or `undefined`/`void` for 0. */
type CommandResult = number | undefined | void;

interface CommandSpec {
  name: string;
  /** Usage text printed for `--help` and referenced on argument errors. */
  usage: string;
  options?: Readonly<Record<string, OptionKind>>;
  positionals?: number | readonly [number, number];
}

export interface CommandArgs {
  readonly die: ExitWith;
  readonly positionals: readonly string[];
  /** Returns the option's string value (resolved when `abs`), or `null` if omitted. */
  value: (name: string) => string | null;
  /** Returns the option's non-empty value, or exits via `die` when missing or empty. */
  required: (name: string) => string;
  int: (name: string) => number | null;
  flag: (name: string) => boolean;
  list: (name: string) => readonly string[];
}
/** Raw parsed arguments from `parseArgs`: option values and positional tokens. */
interface Parsed {
  readonly values: Readonly<Record<string, string | boolean | readonly (string | boolean)[] | undefined>>;
  readonly positionals: readonly string[];
}

/** Parses `argv` against `spec` using production's `parseArgs`, rejecting unknown options, missing
 *  values, duplicate non-list options, and out-of-range positional counts (`-h`/`--help` bypasses
 *  positional count validation). */
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
 * Structured command exit carrying a specific exit code and one-line message (such as a negative
 * validation verdict). Uncaught errors of other types exit with code 1.
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

/** Rewrites leading `from/` prefixes in `arg` (at the start, after `--option=`, or after commas)
 *  to `to/` so home-relative paths translate cleanly across hosts. */
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

/** Extracts `--host` before any `--` separator and rewrites local home paths to `~/`, or returns
 *  `null` when `--host` is absent. */
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
 * Entry wrapper for skill CLI scripts: parses arguments against `spec`, prints usage on `--help`,
 * exits 2 on invalid arguments, exits 1 (or `CommandFailure.code`) on runtime failures, and
 * forwards execution via `scriptOn` when `--host` is specified.
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
