/**
 * The strict argument parser the repository's command scripts share, and the one-line refusal they
 * exit through.
 *
 * Strict means a misspelled flag refuses before anything runs. A reader that looks up
 * `argv.indexOf("--run")` and ignores everything else turns `--rnu abc` into a run with no `--run`,
 * and one that takes the token after a flag as its value turns `--out --json` into an output path
 * called `--json`. Either way the script measures a condition nobody asked for and says nothing.
 * `--name=value` stays available for a legitimate value that begins with `--`, and a bare `--`
 * ends the options, so every token after it is positional.
 */
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { isAbsolute, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

interface CliOptionSpec {
  values?: readonly string[];
  repeatable?: readonly string[];
  flags?: readonly string[];
  /** How many positional arguments are accepted, as an exact count or an inclusive `[min, max]`.
   *  Absent means none: an unexpected positional is as likely a typo as an unknown option. */
  positionals?: number | readonly [number, number];
}

interface ParsedCliArgs {
  single: ReadonlyMap<string, string>;
  repeated: ReadonlyMap<string, readonly string[]>;
  flags: ReadonlySet<string>;
  positionals: readonly string[];
}

/**
 * The script's own name in front of its one-line diagnostic, then the exit code a caller reads.
 *
 * The throw after `exit` is unreachable in a real process and is what makes the type `never`
 * without asserting it; a test that stubs `runtimeProcess.exit` reaches it and gets an error rather
 * than a function that quietly returned.
 *
 * `ExitWith` is exported because the annotation at each call site is load-bearing: TypeScript
 * narrows control flow through a call returning `never` only when the callee is a function
 * declaration or a const with an explicit type, so `const die: ExitWith = exitWith("x")` is what lets
 * `single.get("x") ?? die("--x is required")` read as `string`.
 */
export type ExitWith = (message: string, code?: number) => never;

type Collected = {
  single: Map<string, string>;
  repeated: Map<string, string[]>;
  flags: Set<string>;
};

/**
 * How one declared option is read. `abs` refuses a relative path, `int` a non-integer, and `list`
 * collects every occurrence; the rest are one value or one flag.
 */
type OptionKind = "text" | "abs" | "int" | "flag" | "list";

/** What a command's `run` returns: its exit code, or nothing for exit 0. */
export type CommandResult = number | undefined | void;

export interface CommandSpec {
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
  value(name: string): string | null;
  /** The same value, refusing through `die` when it is absent or empty. */
  required(name: string): string;
  int(name: string): number | null;
  flag(name: string): boolean;
  list(name: string): readonly string[];
}
export class CliArgumentError extends Error {}

function quoted(name: string): string {
  return capturedJsonStringify(`--${name}`);
}

/** Record one `--name` or `--name=value` token, returning how many following tokens it consumed. */
function takeOption(spec: CliOptionSpec, token: string, next: string | undefined, into: Collected): number {
  const equalsAt = token.indexOf("=");
  const name = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
  if (spec.flags?.includes(name) === true) {
    if (equalsAt !== -1) throw new CliArgumentError(`option ${quoted(name)} does not take a value`);
    if (into.flags.has(name)) throw new CliArgumentError(`option ${quoted(name)} may be passed only once`);
    into.flags.add(name);
    return 0;
  }
  const repeatable = spec.repeatable?.includes(name) === true;
  if (!repeatable && spec.values?.includes(name) !== true) {
    throw new CliArgumentError(`unknown option ${quoted(name)}`);
  }
  if (equalsAt === -1 && (next === undefined || next.startsWith("--"))) {
    throw new CliArgumentError(`option ${quoted(name)} needs a value`);
  }
  const value = equalsAt === -1 ? (next ?? "") : token.slice(equalsAt + 1);
  if (repeatable) {
    into.repeated.set(name, [...(into.repeated.get(name) ?? []), value]);
  } else if (into.single.has(name)) {
    throw new CliArgumentError(`option ${quoted(name)} may be passed only once`);
  } else {
    into.single.set(name, value);
  }
  return equalsAt === -1 ? 1 : 0;
}

function checkPositionals(spec: CliOptionSpec, positionals: readonly string[]): void {
  const allowed = spec.positionals ?? 0;
  const [min, max] = isNumber(allowed) ? [allowed, allowed] : allowed;
  if (positionals.length > max) {
    const extra = positionals[max] ?? "";
    throw new CliArgumentError(`unexpected positional argument ${capturedJsonStringify(extra)}`);
  }
  if (positionals.length < min) {
    const count = `${min === max ? "" : "at least "}${min} positional argument${min === 1 ? "" : "s"}`;
    throw new CliArgumentError(`expected ${count}`);
  }
}

/** Parse `argv` against `spec`, throwing `CliArgumentError` for anything the spec does not admit. A
 *  `-h` counts as `--help` when the spec declares that flag; any other single-dash token except the
 *  bare `-` (stdin, by convention) is refused as an unknown option. */
export function parseCliArgs(argv: readonly string[], spec: CliOptionSpec): ParsedCliArgs {
  const into: Collected = { single: new Map(), repeated: new Map(), flags: new Set() };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const token = raw === "-h" && spec.flags?.includes("help") === true ? "--help" : raw;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) index += takeOption(spec, token, argv[index + 1], into);
    else if (token.startsWith("-") && token !== "-") {
      throw new CliArgumentError(`unknown option ${capturedJsonStringify(token)}`);
    } else positionals.push(token);
  }
  if (!into.flags.has("help")) checkPositionals(spec, positionals);
  return { ...into, positionals };
}

export function exitWith(script: string): ExitWith {
  return (message: string, code = 2): never => {
    console.error(`${script}: ${message}`);
    runtimeProcess.exit(code);
    throw new Error("process exit returned unexpectedly");
  };
}

/**
 * Parse this process's arguments, refusing through `die` when the parser says they are wrong.
 *
 * The re-throw is the part a hand-written copy gets wrong: a parser fault is a defect in the script
 * and has to arrive with its stack, while a bad argument is the caller's and gets one line.
 */
export function parseOrDie(
  die: ExitWith,
  spec: CliOptionSpec,
  argv: readonly string[] = Bun.argv.slice(2),
): ParsedCliArgs {
  try {
    return parseCliArgs(argv, spec);
  } catch (error) {
    if (error instanceof CliArgumentError) die(error.message);
    throw error;
  }
}

/**
 * A subcommand in front of its own options: `thread-state summary <file> --json`. The first token
 * selects the spec the rest is parsed against, so an option one command takes is refused on a
 * command that does not.
 */
export function parseCommandOrDie(
  die: ExitWith,
  commands: Readonly<Record<string, CliOptionSpec>>,
  argv: readonly string[] = Bun.argv.slice(2),
): ParsedCliArgs & { command: string } {
  const [command = "", ...rest] = argv;
  const spec = Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (spec === undefined) {
    die(`expected one of ${Object.keys(commands).join(", ")}, got ${capturedJsonStringify(command)}`);
  }
  return { command, ...parseOrDie(die, spec, rest) };
}

/** Refuse a relative path option through the script's own `die`, and return it resolved. */
export function absoluteOption(die: ExitWith): (option: string, value: string) => string {
  return (option, value) => {
    if (!isAbsolute(value)) die(`--${option} must be an absolute path, got ${capturedJsonStringify(value)}`);
    return resolve(value);
  };
}

export function requiredOption(
  die: ExitWith,
  single: ReadonlyMap<string, string>,
): (option: string) => string {
  return (option) => {
    const value = single.get(option);
    if (value === undefined || value === "") die(`--${option} is required`);
    return value;
  };
}

/**
 * A run that ended with its own exit code and one line, as a validator's verdict does: the command
 * worked and the answer was no. Anything else a command throws exits 1 with the error's message.
 */
export class CommandFailure extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}

function kindsOf(options: Readonly<Record<string, OptionKind>>): CliOptionSpec {
  const names = (wanted: (kind: OptionKind) => boolean): string[] =>
    Object.entries(options).flatMap(([name, kind]) => (wanted(kind) ? [name] : []));
  return {
    values: names((kind) => kind === "text" || kind === "abs" || kind === "int"),
    repeatable: names((kind) => kind === "list"),
    flags: [...names((kind) => kind === "flag"), "help"],
  };
}

function commandArgs(spec: CommandSpec, parsed: ParsedCliArgs, die: ExitWith): CommandArgs {
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
  const value = (name: string): string | null => {
    const kind = kindOf(name, "text", "abs", "int");
    const raw = parsed.single.get(name);
    if (raw === undefined) return null;
    return kind === "abs" ? absoluteOption(die)(name, raw) : raw;
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
      const raw = parsed.single.get(name);
      if (raw === undefined) return null;
      if (!/^-?\d+$/.test(raw)) die(`--${name} must be an integer, got ${capturedJsonStringify(raw)}`);
      return Number(raw);
    },
    flag: (name) => {
      kindOf(name, "flag");
      return parsed.flags.has(name);
    },
    list: (name) => {
      kindOf(name, "list");
      return parsed.repeated.get(name) ?? [];
    },
  };
}

/**
 * The whole front of a command script: strict parsing against the declared options, `--help`
 * printing the usage, one line naming the script for a refused argument (exit 2) and for a failed
 * run (exit 1, or a `CommandFailure`'s own code), and the number `run` returns as the exit code.
 * Scripts call it under `import.meta.main`, so a test importing the module runs nothing.
 */
export async function runCommand(
  spec: CommandSpec,
  run: (args: CommandArgs) => CommandResult | Promise<CommandResult>,
  argv: readonly string[] = Bun.argv.slice(2),
): Promise<void> {
  const die: ExitWith = exitWith(spec.name);
  const parsed = parseOrDie(
    die,
    { ...kindsOf(spec.options ?? {}), positionals: spec.positionals ?? 0 },
    argv,
  );
  if (parsed.flags.has("help")) {
    console.log(spec.usage);
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
