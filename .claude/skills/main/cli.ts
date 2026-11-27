/**
 * Shared command-line front end for skill scripts: strict option parsing via production's
 * `parseArgs` (`src/meta/process.ts`) and uniform one-line diagnostic exits.
 */
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { isAbsolute, relative, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

export const SKILL_REPO = resolve(import.meta.dir, "..", "..", "..");

/**
 * Prints the script name and one-line diagnostic to stderr, then exits with `code`.
 */
type ExitWith = (message: string, code?: number) => never;

/**
 * `abs` requires an absolute path, `int` an integer, `number` a finite decimal number, `time` an
 * ISO-8601 date or timestamp (`YYYY-MM-DD...`, parsed with `Date.parse`), `list` collects repeated
 * occurrences, `text` takes one string, and `flag` is a boolean switch.
 */
type OptionKind = "text" | "abs" | "int" | "number" | "time" | "flag" | "list";

/** An explicit exit code, or nothing for 0. */
type CommandResult = number | undefined | void;

interface CommandSpec {
  name: string;
  usage: string;
  options?: Readonly<Record<string, OptionKind>>;
  positionals?: number | readonly [number, number];
}

export interface CommandArgs {
  readonly die: ExitWith;
  readonly positionals: readonly string[];
  /** Resolved when `abs`; `null` if omitted. */
  value: (name: string) => string | null;
  /** Exits via `die` when missing or empty. */
  required: (name: string) => string;
  int: (name: string) => number | null;
  number: (name: string) => number | null;
  time: (name: string) => number | null;
  flag: (name: string) => boolean;
  list: (name: string) => readonly string[];
}
interface Parsed {
  readonly values: Readonly<Record<string, string | boolean | readonly (string | boolean)[] | undefined>>;
  readonly positionals: readonly string[];
}

/** Rejects unknown options, missing values, duplicate non-list options and out-of-range positional
 *  counts; `-h`/`--help` bypasses the positional count. */
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
 * A command exit with its own code and one-line message, such as a negative validation verdict;
 * other uncaught errors exit 1.
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
    number: (name) => {
      kindOf(name, "number");
      const raw = text(name);
      if (raw === undefined) return null;
      const parsedNumber = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isFinite(parsedNumber)) {
        die(`--${name} must be a number, got ${capturedJsonStringify(raw)}`);
      }
      return parsedNumber;
    },
    time: (name) => {
      kindOf(name, "time");
      const raw = text(name);
      if (raw === undefined) return null;
      const parsedTime = /^\d{4}-\d{2}-\d{2}/u.test(raw) ? Date.parse(raw) : Number.NaN;
      if (Number.isNaN(parsedTime)) {
        die(`--${name} must be an ISO date or time, got ${capturedJsonStringify(raw)}`);
      }
      return parsedTime;
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

/** Rewrites leading `from/` prefixes (at the start, after `--option=`, or after commas) to `to/`,
 *  so home-relative paths translate across hosts. */
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

/** Extracts `--host` before any `--` and rewrites local home paths to `~/`, or returns `null` when
 *  `--host` is absent. */
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
 * Parses arguments against `spec`, prints usage on `--help`, exits 2 on invalid arguments and 1 (or
 * `CommandFailure.code`) on runtime failures, and forwards to `scriptOn` when `--host` is given.
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
    const script = relative(SKILL_REPO, Bun.main);
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
